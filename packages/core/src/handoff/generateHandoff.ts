import type {
  LedgerEvent,
  HandoffDocument,
  CompletedTaskSummary,
  PendingTaskSummary,
  FailedTaskSummary,
  AwaitingApprovalSummary,
} from "../schemas/index.js";
import { replayLedger } from "../replay/replayLedger.js";

const FAILURE_EVENTS = new Set(["TASK_FAILED", "VERIFICATION_FAILED", "BOUNDARY_VIOLATION"]);

/**
 * Pure function — generates a handoff document for a run so a second
 * developer (or their agent) can understand where work left off.
 *
 * Reads PATCH_PROPOSED events for completed-task summaries and
 * HUMAN_APPROVAL_REQUESTED events for approval timestamps.
 */
export function generateHandoff(events: LedgerEvent[], runId: string): HandoffDocument {
  const state = replayLedger(events, runId);

  // Index PATCH_PROPOSED payloads by task ID (last one wins if multiple)
  const patchByTask = new Map<string, { summary: string; filesModified: string[] }>();
  // Index first approval-request timestamp by task ID
  const approvalRequestedAt = new Map<string, string>();

  for (const event of events) {
    if (event.run_id !== runId) continue;

    if (event.event_type === "PATCH_PROPOSED") {
      const taskId = resolveTaskId(event);
      if (taskId) {
        patchByTask.set(taskId, {
          summary: typeof event.payload["summary"] === "string" ? event.payload["summary"] : "",
          filesModified: Array.isArray(event.payload["filesModified"])
            ? (event.payload["filesModified"] as string[])
            : [],
        });
      }
    }

    if (event.event_type === "HUMAN_APPROVAL_REQUESTED") {
      const taskId = resolveTaskId(event);
      if (taskId && !approvalRequestedAt.has(taskId)) {
        approvalRequestedAt.set(taskId, event.timestamp);
      }
    }
  }

  const completedTasks: CompletedTaskSummary[] = [];
  const pendingTasks: PendingTaskSummary[] = [];
  const failedTasks: FailedTaskSummary[] = [];
  const awaitingApproval: AwaitingApprovalSummary[] = [];

  for (const task of state.tasks) {
    switch (task.status) {
      case "completed": {
        const patch = patchByTask.get(task.taskId);
        completedTasks.push({
          taskId: task.taskId,
          title: task.title,
          summary: patch?.summary ?? "",
          filesModified: patch?.filesModified ?? [],
        });
        break;
      }

      case "pending":
      case "assigned":
      case "running": {
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

      case "failed": {
        const failureEvent = events.find(
          (e) =>
            e.run_id === runId &&
            (e.task_id === task.taskId || resolveTaskId(e) === task.taskId) &&
            FAILURE_EVENTS.has(e.event_type),
        );
        const failureReason = failureEvent
          ? typeof failureEvent.payload["reason"] === "string"
            ? failureEvent.payload["reason"]
            : failureEvent.event_type
          : "unknown";
        failedTasks.push({
          taskId: task.taskId,
          title: task.title,
          failureReason,
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

      // awaiting_verification treated as in-flight pending
      case "awaiting_verification": {
        pendingTasks.push({
          taskId: task.taskId,
          title: task.title,
          description: task.description,
          owner: task.owner,
          blockedBy: [],
        });
        break;
      }
    }
  }

  return {
    runId,
    goal: state.goal,
    runStatus: state.status,
    completedTasks,
    pendingTasks,
    failedTasks,
    awaitingApproval,
    allFilesModified: state.filesModified,
    suggestedNextAction: buildSuggestedAction(runId, state.status, pendingTasks, failedTasks, awaitingApproval),
  };
}

function resolveTaskId(event: LedgerEvent): string | undefined {
  return (
    event.task_id ??
    (typeof event.payload["taskId"] === "string" ? event.payload["taskId"] : undefined)
  );
}

function buildSuggestedAction(
  runId: string,
  runStatus: string,
  pendingTasks: PendingTaskSummary[],
  failedTasks: FailedTaskSummary[],
  awaitingApproval: AwaitingApprovalSummary[],
): string {
  if (awaitingApproval.length > 0) {
    return `Run \`agentledger approvals approve ${runId}\` then \`agentledger resume ${runId}\` to continue.`;
  }

  if (runStatus === "completed") {
    return "Run completed successfully. No action needed.";
  }

  if (failedTasks.length > 0 && pendingTasks.length === 0) {
    return `${failedTasks.length} task(s) failed. Review with \`agentledger replay -r ${runId}\` and retry.`;
  }

  if (pendingTasks.length > 0) {
    const next = pendingTasks[0]!;
    if (next.blockedBy.length > 0) {
      return `Task "${next.title}" blocked by: ${next.blockedBy.join(", ")}. Resolve blockers first.`;
    }
    return `Run \`agentledger resume ${runId}\` to continue with task "${next.title}".`;
  }

  return `Run \`agentledger resume ${runId}\` to continue.`;
}
