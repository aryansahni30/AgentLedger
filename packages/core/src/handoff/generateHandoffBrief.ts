import type {
  LedgerEvent,
  HandoffBrief,
  FailureReason,
  FailureContext,
  FailedTaskDetail,
  FileInventory,
  UnresolvedRisk,
  ResumptionGuidance,
  CompletedTaskSummary,
  PendingTaskSummary,
  AwaitingApprovalSummary,
  RunStatus,
  PatchRiskCategory,
  PatchRiskSeverity,
} from "../schemas/index.js";
import { HandoffBriefSchema } from "../schemas/index.js";
import { replayLedger } from "../replay/replayLedger.js";

// ─── Failure classification ───────────────────────────────────────────────────

function resolveTaskId(event: LedgerEvent): string | undefined {
  return (
    event.task_id ??
    (typeof event.payload["taskId"] === "string" ? event.payload["taskId"] : undefined)
  );
}

/**
 * Scans a task's events in chronological order and returns the first
 * recognisable failure cause plus any structured context extracted from
 * that event's payload.
 */
function classifyFailure(
  taskId: string,
  runEvents: LedgerEvent[],
): { reason: FailureReason; context?: FailureContext } {
  const taskEvents = runEvents
    .filter((e) => resolveTaskId(e) === taskId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const event of taskEvents) {
    switch (event.event_type) {
      case "BOUNDARY_VIOLATION":
        return {
          reason: "boundary_violation",
          context: {
            violatedFile:
              typeof event.payload["file"] === "string" ? event.payload["file"] : undefined,
            violationType:
              typeof event.payload["violationType"] === "string"
                ? event.payload["violationType"]
                : undefined,
            detail:
              typeof event.payload["message"] === "string"
                ? event.payload["message"]
                : undefined,
          },
        };

      case "VERIFICATION_FAILED":
        return {
          reason: "verification_failed",
          context: {
            exitCode:
              typeof event.payload["exitCode"] === "number"
                ? event.payload["exitCode"]
                : undefined,
            detail:
              typeof event.payload["reason"] === "string"
                ? event.payload["reason"]
                : undefined,
          },
        };

      case "HUMAN_APPROVAL_REJECTED":
        return { reason: "human_approval_rejected" };

      case "POLICY_EVALUATED": {
        if (event.payload["action"] === "deny") {
          const reasons = Array.isArray(event.payload["reasons"])
            ? (event.payload["reasons"] as string[]).join("; ")
            : undefined;
          return {
            reason: "governance_denied",
            context: { detail: reasons },
          };
        }
        break;
      }

      case "TOOL_DENIED":
        return {
          reason: "tool_denial",
          context: {
            toolName:
              typeof event.payload["toolName"] === "string"
                ? event.payload["toolName"]
                : undefined,
            violationType:
              typeof event.payload["violationType"] === "string"
                ? event.payload["violationType"]
                : undefined,
          },
        };

      case "PATCH_PROPOSED": {
        const summary = event.payload["summary"];
        if (
          typeof summary === "string" &&
          summary.toLowerCase().includes("max tool calls")
        ) {
          return {
            reason: "tool_call_limit_exceeded",
            context: { detail: summary },
          };
        }
        break;
      }
    }
  }

  return { reason: "unknown" };
}

// ─── File inventory ───────────────────────────────────────────────────────────

function buildFileInventory(
  runEvents: LedgerEvent[],
  completedTaskIds: Set<string>,
): FileInventory {
  const mergedFiles: string[] = [];
  const worktreeFiles: string[] = [];

  for (const event of runEvents) {
    if (event.event_type !== "PATCH_PROPOSED") continue;

    const taskId = resolveTaskId(event);
    const files = Array.isArray(event.payload["filesModified"])
      ? (event.payload["filesModified"] as string[])
      : [];

    const isCompleted = taskId !== undefined && completedTaskIds.has(taskId);
    const target = isCompleted ? mergedFiles : worktreeFiles;

    for (const f of files) {
      if (!target.includes(f)) target.push(f);
    }
  }

  const allFiles = [...new Set([...mergedFiles, ...worktreeFiles])];
  return { mergedFiles, worktreeFiles, allFiles };
}

// ─── Unresolved risks ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { critical: 3, high: 2, medium: 1 };

function extractUnresolvedRisks(
  runEvents: LedgerEvent[],
  completedTaskIds: Set<string>,
): UnresolvedRisk[] {
  const risks: UnresolvedRisk[] = [];

  for (const event of runEvents) {
    if (event.event_type !== "PATCH_RISK_DETECTED") continue;

    const taskId = resolveTaskId(event);
    if (taskId !== undefined && completedTaskIds.has(taskId)) continue;

    const rawRisks = Array.isArray(event.payload["risks"]) ? event.payload["risks"] : [];
    for (const r of rawRisks) {
      if (typeof r !== "object" || r === null) continue;
      const rec = r as Record<string, unknown>;
      risks.push({
        taskId: taskId ?? "unknown",
        category: rec["category"] as PatchRiskCategory,
        severity: rec["severity"] as PatchRiskSeverity,
        filePath: typeof rec["filePath"] === "string" ? rec["filePath"] : "",
        pattern: typeof rec["pattern"] === "string" ? rec["pattern"] : "",
      });
    }
  }

  return risks
    .sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0))
    .slice(0, 5);
}

// ─── Resumption guidance ─────────────────────────────────────────────────────

function buildResumptionGuidance(
  runId: string,
  runStatus: RunStatus,
  awaitingApproval: AwaitingApprovalSummary[],
  failedTasks: FailedTaskDetail[],
  pendingTasks: PendingTaskSummary[],
  inProgressTasks: PendingTaskSummary[],
): ResumptionGuidance {
  if (runStatus === "completed") {
    return {
      action: "run_completed",
      command: `agentledger ledger view`,
      detail: "Run completed. No action needed.",
    };
  }

  if (awaitingApproval.length > 0) {
    return {
      action: "approve_pending",
      targetTaskId: awaitingApproval[0]!.taskId,
      command: `agentledger approvals approve ${runId}`,
      detail: `${awaitingApproval.length} task(s) awaiting approval. Approve to unblock.`,
    };
  }

  if (failedTasks.length > 0) {
    const first = failedTasks[0]!;
    const noRemainingWork = inProgressTasks.length === 0 && pendingTasks.length === 0;
    if (noRemainingWork) {
      return {
        action: "investigate_failure",
        targetTaskId: first.taskId,
        command: `agentledger audit -r ${runId}`,
        detail: `${failedTasks.length} task(s) failed (first: ${first.reason}). Review audit before retrying.`,
      };
    }
    return {
      action: "retry_failed_task",
      targetTaskId: first.taskId,
      command: `agentledger resume ${runId}`,
      detail: `Task "${first.taskId}" failed (${first.reason}). Fix issue and retry.`,
    };
  }

  const readyNow = pendingTasks.filter((t) => t.blockedBy.length === 0);
  if (readyNow.length > 0 || inProgressTasks.length > 0) {
    return {
      action: "resume_run",
      targetTaskId: readyNow[0]?.taskId ?? inProgressTasks[0]?.taskId,
      command: `agentledger resume ${runId}`,
      detail: `${readyNow.length + inProgressTasks.length} task(s) ready. Resume to continue.`,
    };
  }

  return {
    action: "investigate_failure",
    command: `agentledger audit -r ${runId}`,
    detail: "Run in unknown state. Review audit report.",
  };
}

// ─── Context summary ─────────────────────────────────────────────────────────

const MAX_SUMMARY_CHARS = 2000;

function buildContextSummary(
  runId: string,
  goal: string,
  runStatus: RunStatus,
  operator: string | undefined,
  completedTasks: CompletedTaskSummary[],
  failedTasks: FailedTaskDetail[],
  inProgressTasks: PendingTaskSummary[],
  pendingTasks: PendingTaskSummary[],
  awaitingApproval: AwaitingApprovalSummary[],
  unresolvedRisks: UnresolvedRisk[],
  guidance: ResumptionGuidance,
): string {
  const lines: string[] = [];

  lines.push(`RUN ${runId} [${runStatus.toUpperCase()}]`);
  lines.push(`GOAL: ${goal}`);
  if (operator) {
    lines.push(`STARTED BY: ${operator}`);
  }

  if (completedTasks.length > 0) {
    lines.push("");
    lines.push("COMPLETED:");
    for (const t of completedTasks) {
      const files = t.filesModified.length > 0 ? ` \u2192 ${t.filesModified.join(", ")}` : "";
      lines.push(`  \u2713 ${t.taskId}: ${t.title}${files}`);
    }
  }

  if (failedTasks.length > 0) {
    lines.push("");
    lines.push("FAILED:");
    for (const t of failedTasks) {
      const ctxPart = t.context?.violatedFile
        ? ` (${t.context.violatedFile})`
        : t.context?.detail
          ? ` (${t.context.detail.slice(0, 60)})`
          : "";
      lines.push(`  \u2717 ${t.taskId}: ${t.title} [${t.reason}${ctxPart}]`);
    }
  }

  if (awaitingApproval.length > 0) {
    lines.push("");
    lines.push("AWAITING APPROVAL:");
    for (const t of awaitingApproval) {
      lines.push(`  \u23f3 ${t.taskId}: ${t.title}`);
    }
  }

  if (inProgressTasks.length > 0) {
    lines.push("");
    lines.push("IN PROGRESS:");
    for (const t of inProgressTasks) {
      lines.push(`  \u21ba ${t.taskId}: ${t.title}`);
    }
  }

  if (pendingTasks.length > 0) {
    lines.push("");
    lines.push("PENDING:");
    for (const t of pendingTasks) {
      const state = t.blockedBy.length > 0 ? `[blocked: ${t.blockedBy.join(", ")}]` : "[ready]";
      lines.push(`  \u2192 ${t.taskId}: ${t.title} ${state}`);
    }
  }

  if (unresolvedRisks.length > 0) {
    lines.push("");
    lines.push("UNRESOLVED RISKS:");
    for (const r of unresolvedRisks) {
      lines.push(`  \u26a0 ${r.severity}/${r.category} in ${r.filePath} [${r.pattern}]`);
    }
  }

  lines.push("");
  lines.push(`NEXT: ${guidance.detail}`);
  lines.push(`CMD: ${guidance.command}`);

  return lines.join("\n").slice(0, MAX_SUMMARY_CHARS);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pure function — generates a HandoffBrief for a given run from ledger events.
 *
 * Richer than HandoffDocument: classifies failure reasons into a typed enum,
 * builds a file inventory (merged vs worktree), surfaces unresolved governance
 * risks, and produces a contextSummary string formatted for pasting directly
 * into a new agent's context window.
 */
export function generateHandoffBrief(events: LedgerEvent[], runId: string): HandoffBrief {
  const state = replayLedger(events, runId);
  const runEvents = events.filter((e) => e.run_id === runId);

  // Index approval-request timestamps by task ID (first request wins)
  const approvalRequestedAt = new Map<string, string>();
  for (const event of runEvents) {
    if (event.event_type === "HUMAN_APPROVAL_REQUESTED") {
      const taskId = resolveTaskId(event);
      if (taskId && !approvalRequestedAt.has(taskId)) {
        approvalRequestedAt.set(taskId, event.timestamp);
      }
    }
  }

  // Index PATCH_PROPOSED files by task ID (last event wins — most recent patch)
  const patchFilesByTask = new Map<string, string[]>();
  for (const event of runEvents) {
    if (event.event_type === "PATCH_PROPOSED") {
      const taskId = resolveTaskId(event);
      if (taskId) {
        patchFilesByTask.set(
          taskId,
          Array.isArray(event.payload["filesModified"])
            ? (event.payload["filesModified"] as string[])
            : [],
        );
      }
    }
  }

  const completedTasks: CompletedTaskSummary[] = [];
  const failedTasks: FailedTaskDetail[] = [];
  const inProgressTasks: PendingTaskSummary[] = [];
  const pendingTasks: PendingTaskSummary[] = [];
  const awaitingApproval: AwaitingApprovalSummary[] = [];

  const completedTaskIds = new Set<string>();

  for (const task of state.tasks) {
    switch (task.status) {
      case "completed": {
        completedTaskIds.add(task.taskId);
        completedTasks.push({
          taskId: task.taskId,
          title: task.title,
          summary: "",
          filesModified: patchFilesByTask.get(task.taskId) ?? [],
        });
        break;
      }

      case "failed": {
        const { reason, context } = classifyFailure(task.taskId, runEvents);
        failedTasks.push({
          taskId: task.taskId,
          title: task.title,
          reason,
          context,
          attemptedFiles: patchFilesByTask.get(task.taskId) ?? [],
        });
        break;
      }

      case "awaiting_approval": {
        awaitingApproval.push({
          taskId: task.taskId,
          title: task.title,
          requestedAt: approvalRequestedAt.get(task.taskId) ?? task.taskId,
        });
        break;
      }

      case "running":
      case "awaiting_verification": {
        inProgressTasks.push({
          taskId: task.taskId,
          title: task.title,
          description: task.description,
          owner: task.owner,
          blockedBy: [],
        });
        break;
      }

      case "pending":
      case "assigned": {
        const blockedBy = task.dependencies.filter((depId) => {
          const dep = state.tasks.find((t) => t.taskId === depId);
          return !dep || dep.status !== "completed";
        });
        pendingTasks.push({
          taskId: task.taskId,
          title: task.title,
          description: task.description,
          owner: task.owner,
          blockedBy,
        });
        break;
      }
    }
  }

  const fileInventory = buildFileInventory(runEvents, completedTaskIds);
  const unresolvedRisks = extractUnresolvedRisks(runEvents, completedTaskIds);
  const resumptionGuidance = buildResumptionGuidance(
    runId,
    state.status,
    awaitingApproval,
    failedTasks,
    pendingTasks,
    inProgressTasks,
  );
  const contextSummary = buildContextSummary(
    runId,
    state.goal,
    state.status,
    state.operator,
    completedTasks,
    failedTasks,
    inProgressTasks,
    pendingTasks,
    awaitingApproval,
    unresolvedRisks,
    resumptionGuidance,
  );

  return HandoffBriefSchema.parse({
    generatedAt: new Date().toISOString(),
    runId,
    goal: state.goal,
    operator: state.operator,
    runStatus: state.status,
    completedTasks,
    failedTasks,
    inProgressTasks,
    pendingTasks,
    awaitingApproval,
    fileInventory,
    unresolvedRisks,
    resumptionGuidance,
    contextSummary,
  });
}
