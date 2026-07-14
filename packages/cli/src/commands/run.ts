import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  LedgerWriter,
  LedgerReader,
  IntentContractSchema,
  AgentLedgerConfigSchema,
  TaskGraphSchema,
  VerificationCommandSchema,
  planWithLLM,
  planWithTogether,
  createPlan,
  runWorkerLLM,
  runWorkerTogether,
  runClaudeCodeWorker,
  verifyTask,
  createTaskWorktree,
  cleanupWorktree,
  gatherRepoContext,
  shouldRequireApproval,
  buildPriorTaskContext,
  scanPatch,
  evaluatePolicy,
  loadGovernancePolicy,
  loadEffectivePolicy,
  generateAuditReport,
  checkRiskThreshold,
  getWorktreeDiff,
  TaskScheduler,
} from "@agentledger/core";
import type { AgentLedgerConfig, AgentTask, GovernancePolicy, LedgerEvent, VerificationCommand, WorkerContext, WorkerResult } from "@agentledger/core";

const AGENTLEDGER_DIR = ".agentledger";

function colorize(text: string, code: number): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

const green = (s: string) => colorize(s, 32);
const red = (s: string) => colorize(s, 31);
const yellow = (s: string) => colorize(s, 33);
const cyan = (s: string) => colorize(s, 36);
const bold = (s: string) => colorize(s, 1);
const dim = (s: string) => colorize(s, 2);

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

function banner(msg: string) {
  log(bold(cyan(`\n═══ ${msg} ═══`)));
}

type TaskOutcome = "completed" | "failed" | "approval_required";

/**
 * Full orchestrator run loop.
 *
 * Phases:
 *   1. Load config + build IntentContract from request string
 *   2. Plan — LLM or mock planner → TaskGraph
 *   3. Execute tasks via TaskScheduler work-pool (up to `concurrency` in parallel)
 *   4. Write final RUN_COMPLETED / RUN_FAILED event
 */
export async function runRun(
  request: string,
  targetDir: string,
  opts: {
    useMockPlanner?: boolean;
    taskFile?: string;
    model?: string;
    workerModel?: string;
    provider?: "anthropic" | "together";
    /**
     * Worker backend to use for executing tasks.
     * - "claude-code" (default): spawns Claude Code CLI subprocess — uses your existing
     *   Claude Code install and auth. No API key required.
     * - "llm": direct Anthropic API calls (requires ANTHROPIC_API_KEY)
     * - "together": Together AI API (requires TOGETHER_API_KEY)
     * - "mock": deterministic mock for testing
     */
    worker?: string;
    /** Max tasks to execute in parallel. Default 1 = sequential (backward compatible). */
    concurrency?: number;
    /** Injectable worker function — overrides all worker flags when provided (used in tests) */
    workerFn?: (context: WorkerContext) => Promise<WorkerResult>;
  } = {},
): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const ledgerPath = join(root, "ledger.jsonl");
  const worktreeBaseDir = join(root, "worktrees");
  const concurrency = Math.max(1, opts.concurrency ?? 1);

  // ── Load config ──────────────────────────────────────────────────────────────
  let config: AgentLedgerConfig;
  try {
    const raw = await readFile(join(root, "config.json"), "utf8");
    config = AgentLedgerConfigSchema.parse(JSON.parse(raw));
  } catch {
    log(red("✗ No .agentledger/config.json — run `agentledger init` first"));
    process.exit(1);
  }

  const writer = new LedgerWriter(ledgerPath);
  const reader = new LedgerReader(ledgerPath);
  const runId = randomUUID();

  // ── Build intent ─────────────────────────────────────────────────────────────
  const intent = IntentContractSchema.parse({
    runId,
    goal: request,
    constraints: [],
    successCriteria: ["task completes without boundary violations", "all required commands pass"],
    riskLevel: "medium",
  });

  banner("RUN STARTING");
  log(`  Run ID : ${dim(runId)}`);
  log(`  Goal   : ${request}`);
  log(`  Target : ${targetDir}`);
  if (concurrency > 1) {
    log(`  Concurrency : ${concurrency}`);
  }

  await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type: "RUN_CREATED",
    payload: {
      goal: intent.goal,
      riskLevel: intent.riskLevel,
      operator: process.env["USER"] ?? process.env["USERNAME"] ?? "unknown",
      run_mode: "orchestrated",
    },
  });

  // ── Plan ─────────────────────────────────────────────────────────────────────
  banner("PLANNING");

  const provider = opts.provider ?? "anthropic";
  let graph;
  if (opts.taskFile) {
    log(yellow(`  Loading task graph from file: ${opts.taskFile}`));
    try {
      const raw = await readFile(opts.taskFile, "utf8");
      const parsed = JSON.parse(raw);
      const tasksArray = Array.isArray(parsed) ? parsed : parsed.tasks;
      graph = TaskGraphSchema.parse({ runId, tasks: tasksArray });
    } catch (err) {
      log(red(`  ✗ Failed to load task file: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  } else if (opts.useMockPlanner) {
    log(yellow("  Using mock planner (--mock-planner flag)"));
    graph = createPlan(intent);
  } else {
    log(dim("  Gathering repo context..."));
    const repoContext = await gatherRepoContext(targetDir);

    log(dim(`  Calling LLM planner [${provider}]...`));
    try {
      graph =
        provider === "together"
          ? await planWithTogether(intent, repoContext, opts.model)
          : await planWithLLM(intent, repoContext, opts.model);
    } catch (err) {
      log(red(`  ✗ LLM planner failed: ${err instanceof Error ? err.message : String(err)}`));
      log(yellow("  Falling back to mock planner"));
      graph = createPlan(intent);
    }
  }

  await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type: "INTENT_COMPILED",
    payload: { taskCount: graph.tasks.length, taskIds: graph.tasks.map((t) => t.taskId) },
  });

  log(green(`  ✓ Plan created — ${graph.tasks.length} task(s)`));
  for (const task of graph.tasks) {
    log(`    • ${dim(task.taskId)} ${task.title}`);
  }

  for (const task of graph.tasks) {
    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: "orchestrator",
      event_type: "TASK_CREATED",
      payload: {
        title: task.title,
        owner: task.owner,
        dependencies: task.dependencies,
        allowedFiles: task.allowedFiles,
        blockedFiles: task.blockedFiles,
      },
    });
  }

  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "tasks.json"),
    JSON.stringify(graph.tasks, null, 2) + "\n",
    "utf8",
  );

  // ── Load governance policy once (shared across tasks) ───────────────────────
  const governancePolicy: GovernancePolicy = await loadGovernancePolicy(root);

  // ── Execute tasks via work-pool ───────────────────────────────────────────────
  const scheduler = new TaskScheduler(graph.tasks);
  const completedTasks: AgentTask[] = [];
  const failedTasks: AgentTask[] = [];
  const active = new Map<string, Promise<void>>();
  let approvalRequired = false;
  let thresholdBreached = false;

  /**
   * Execute a single task end-to-end and return its outcome.
   * Never throws — all errors are caught and returned as "failed".
   */
  async function executeOneTask(task: AgentTask): Promise<TaskOutcome> {
    banner(`TASK: ${task.title}`);
    log(`  ID     : ${dim(task.taskId)}`);
    log(`  Owner  : ${task.owner}`);

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: "orchestrator",
      event_type: "TASK_ASSIGNED",
      payload: { owner: task.owner },
    });

    // Create worktree
    let handle;
    try {
      log(dim("  Creating git worktree..."));
      handle = await createTaskWorktree(targetDir, task, worktreeBaseDir);
      log(green(`  ✓ Worktree: ${handle.worktreePath}`));
    } catch (err) {
      log(red(`  ✗ Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`));
      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "TASK_FAILED",
        payload: { reason: "worktree_creation_failed" },
      });
      return "failed";
    }

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: "orchestrator",
      event_type: "WORKTREE_CREATED",
      payload: { branch: handle.branch, worktreePath: handle.worktreePath },
    });

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: "orchestrator",
      event_type: "TASK_STARTED",
      payload: { worktreePath: handle.worktreePath },
    });

    // Run LLM worker
    log(dim("  Running LLM worker..."));
    let workerResult;
    try {
      const allEvents: LedgerEvent[] = await reader.readAll();
      const priorContext = buildPriorTaskContext(allEvents, task);
      if (priorContext.length > 0) {
        log(dim(`  Prior context: ${priorContext.length} upstream task(s) injected into worker prompt`));
      }

      const context = {
        task,
        worktreePath: handle.worktreePath,
        relevantContext: {},
        allowedFiles: task.allowedFiles,
        blockedFiles: task.blockedFiles,
        allowedTools: task.allowedTools,
        outputSchema: {},
      };
      const ledgerOpts = { writer, runId, taskId: task.taskId };
      const workerType = opts.worker ?? "claude-code";
      if (opts.workerFn) {
        workerResult = await opts.workerFn(context);
      } else if (workerType === "claude-code") {
        log(dim("  Worker: Claude Code CLI"));
        workerResult = await runClaudeCodeWorker(context, {
          ...(opts.workerModel !== undefined ? { model: opts.workerModel } : {}),
        });
      } else if (workerType === "together" || provider === "together") {
        workerResult = await runWorkerTogether(context, opts.workerModel, ledgerOpts, priorContext);
      } else if (workerType === "llm") {
        workerResult = await runWorkerLLM(context, opts.workerModel, ledgerOpts, priorContext);
      } else {
        // "mock" or unknown — fall through to mock
        const { runMockWorker } = await import("@agentledger/core");
        workerResult = await runMockWorker(context);
      }
      log(green(`  ✓ Worker done — ${workerResult.filesModified.length} file(s) modified`));
      if (workerResult.toolDenials.length > 0) {
        log(yellow(`  ⚠ ${workerResult.toolDenials.length} write attempt(s) blocked in real-time:`));
        for (const d of workerResult.toolDenials) {
          log(red(`    ✗ [${d.violationType}] ${d.path}`));
        }
      }
      log(dim(`    Summary: ${workerResult.summary.slice(0, 120)}`));
    } catch (err) {
      log(red(`  ✗ Worker failed: ${err instanceof Error ? err.message : String(err)}`));
      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "TASK_FAILED",
        payload: { reason: "worker_error" },
      });
      await cleanupWorktree(targetDir, handle);
      return "failed";
    }

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: task.owner,
      event_type: "PATCH_PROPOSED",
      payload: {
        filesModified: workerResult.filesModified,
        summary: workerResult.summary,
      },
    });

    // ── Governance scan ──────────────────────────────────────────────────────
    // Effective policy = run-level merged with any per-task override
    const effectivePolicy = await loadEffectivePolicy(root, task);
    let diff = "";
    try {
      diff = await getWorktreeDiff(handle.worktreePath);
    } catch {
      log(dim("  (governance) Could not read diff — skipping patch scan"));
    }

    const patchRisks = scanPatch(diff);
    const policyDecision = evaluatePolicy(task, patchRisks, effectivePolicy);

    if (patchRisks.length > 0) {
      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "governance",
        event_type: "PATCH_RISK_DETECTED",
        payload: { risks: patchRisks, count: patchRisks.length },
      });
      log(yellow(`  ⚠ Patch scanner: ${patchRisks.length} risk(s) found`));
      for (const r of patchRisks) {
        log(red(`    [${r.severity.toUpperCase()}] ${r.category} — ${r.pattern} at ${r.filePath}:${r.lineNumber}`));
      }
    }

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: "governance",
      event_type: "POLICY_EVALUATED",
      payload: { decision: policyDecision },
    });

    if (policyDecision.action === "deny") {
      log(red(`  ✗ GOVERNANCE DENY — policy blocked this patch`));
      for (const reason of policyDecision.reasons) {
        log(red(`    • ${reason}`));
      }
      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "TASK_FAILED",
        payload: { reason: "governance_deny", policyReasons: policyDecision.reasons },
      });
      log(dim(`    Worktree preserved at: ${handle.worktreePath}`));
      return "failed";
    }

    if (policyDecision.action === "warn") {
      log(yellow(`  ⚠ GOVERNANCE WARN — proceeding with caution`));
      for (const reason of policyDecision.reasons) {
        log(yellow(`    • ${reason}`));
      }
    }

    if (policyDecision.action === "require_approval") {
      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "HUMAN_APPROVAL_REQUESTED",
        payload: {
          reasons: policyDecision.reasons,
          filesModified: workerResult.filesModified,
          summary: workerResult.summary,
          triggeredBy: "governance_policy",
        },
      });

      banner("APPROVAL REQUIRED (GOVERNANCE POLICY) — RUN PAUSED");
      log(yellow(`  Task   : ${task.title}`));
      log(yellow(`  Reasons:`));
      for (const reason of policyDecision.reasons) {
        log(`    ${yellow("•")} ${reason}`);
      }
      log(`\n  ${bold("To approve:")}  agentledger approvals approve ${runId}`);
      log(`  ${bold("To reject:")}   agentledger approvals reject ${runId}`);
      log(`  ${bold("To resume:")}   agentledger resume ${runId}`);
      log(`\n  ${yellow("Run paused.")} ID: ${dim(runId)}`);
      log(`  Worktree preserved at: ${dim(handle.worktreePath)}\n`);
      return "approval_required";
    }

    // ── Approval gate ────────────────────────────────────────────────────────
    if (config.approvalPolicy) {
      const decision = shouldRequireApproval(task, workerResult, config.approvalPolicy);
      if (decision.required) {
        await writer.appendEvent({
          event_id: LedgerWriter.createEventId(),
          run_id: runId,
          task_id: task.taskId,
          timestamp: new Date().toISOString(),
          actor: "orchestrator",
          event_type: "HUMAN_APPROVAL_REQUESTED",
          payload: {
            reasons: decision.reasons,
            filesModified: workerResult.filesModified,
            summary: workerResult.summary,
          },
        });

        banner("APPROVAL REQUIRED — RUN PAUSED");
        log(yellow(`  Task   : ${task.title}`));
        log(yellow(`  Reasons:`));
        for (const reason of decision.reasons) {
          log(`    ${yellow("•")} ${reason}`);
        }
        if (workerResult.filesModified.length > 0) {
          log(`\n  Files modified:`);
          for (const f of workerResult.filesModified) {
            log(`    ${dim("•")} ${f}`);
          }
        }
        log(`\n  Summary: ${dim(workerResult.summary.slice(0, 200))}`);
        log(`\n  ${bold("To approve:")}  agentledger approvals approve ${runId}`);
        log(`  ${bold("To reject:")}   agentledger approvals reject ${runId}`);
        log(`  ${bold("To resume:")}   agentledger resume ${runId}`);
        log(`\n  ${yellow("Run paused.")} ID: ${dim(runId)}`);
        log(`  Worktree preserved at: ${dim(handle.worktreePath)}\n`);
        return "approval_required";
      }
    }

    // Build verification command list from config
    const commands: VerificationCommand[] = Object.entries(config.verification.commands).map(
      ([name, command]) =>
        VerificationCommandSchema.parse({
          name,
          command,
          required: config.verification.required.includes(name),
        }),
    );

    log(dim("  Running verifier..."));

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: "verifier",
      event_type: "VERIFICATION_STARTED",
      payload: { commandCount: commands.length },
    });

    const verificationResult = await verifyTask(handle.worktreePath, task, commands);

    if (!verificationResult.boundaryCheck.passed) {
      for (const v of verificationResult.boundaryCheck.violations) {
        log(red(`  ✗ BOUNDARY_VIOLATION: [${v.violationType}] ${v.file}`));
        log(dim(`      ${v.message}`));

        await writer.appendEvent({
          event_id: LedgerWriter.createEventId(),
          run_id: runId,
          task_id: task.taskId,
          timestamp: new Date().toISOString(),
          actor: "verifier",
          event_type: "BOUNDARY_VIOLATION",
          payload: { violationType: v.violationType, file: v.file, message: v.message },
        });
      }
    }

    if (verificationResult.passed) {
      log(green(`  ✓ Verification PASSED`));

      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "verifier",
        event_type: "VERIFICATION_PASSED",
        payload: { filesModified: verificationResult.commandResults.length },
      });

      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "TASK_COMPLETED",
        payload: { filesModified: workerResult.filesModified },
      });

      await cleanupWorktree(targetDir, handle);
      return "completed";
    } else {
      log(red(`  ✗ Verification FAILED`));

      for (const cmd of verificationResult.commandResults) {
        if (cmd.exitCode !== 0) {
          log(red(`    ✗ ${cmd.name} (exit ${cmd.exitCode})`));
          if (cmd.stderr) {
            for (const line of cmd.stderr.trim().split("\n").slice(0, 5)) {
              log(dim(`      ${line}`));
            }
          }
        }
      }

      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "verifier",
        event_type: "VERIFICATION_FAILED",
        payload: {
          boundaryPassed: verificationResult.boundaryCheck.passed,
          commandsFailed: verificationResult.commandResults
            .filter((r) => r.exitCode !== 0)
            .map((r) => r.name),
          commandResults: verificationResult.commandResults.map((r) => ({
            name: r.name,
            exitCode: r.exitCode,
            stdout: r.stdout?.slice(0, 500),
            stderr: r.stderr?.slice(0, 500),
          })),
        },
      });

      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "TASK_FAILED",
        payload: {
          reason: verificationResult.boundaryCheck.passed
            ? "verification_commands_failed"
            : "boundary_violation",
        },
      });

      log(dim(`    Worktree preserved at: ${handle.worktreePath}`));
      return "failed";
    }
  }

  // ── Work-pool parallel loop ───────────────────────────────────────────────────
  while (!scheduler.isDone() && !approvalRequired && !thresholdBreached) {
    const ready = scheduler.getReadyTasks();

    for (const task of ready) {
      if (active.size >= concurrency) break;
      scheduler.markRunning(task.taskId);

      const p = executeOneTask(task)
        .then(async (outcome) => {
          if (outcome === "approval_required") {
            approvalRequired = true;
            return;
          }

          if (outcome === "completed") {
            completedTasks.push(task);
            scheduler.markCompleted(task.taskId);
          } else {
            failedTasks.push(task);
            scheduler.markFailed(task.taskId);
          }

          // ── Risk threshold check after each task resolves ──────────────────
          const allEvents = await reader.readAll();
          const auditReport = generateAuditReport(allEvents, runId);
          const thresholdResult = checkRiskThreshold(auditReport.riskScore.total, governancePolicy);

          if (thresholdResult !== null && thresholdResult.breached) {
            await writer.appendEvent({
              event_id: LedgerWriter.createEventId(),
              run_id: runId,
              task_id: task.taskId,
              timestamp: new Date().toISOString(),
              actor: "governance",
              event_type: "RISK_THRESHOLD_BREACHED",
              payload: {
                actualScore: thresholdResult.actualScore,
                threshold: thresholdResult.threshold,
                action: thresholdResult.action,
              },
            });

            if (thresholdResult.action === "warn") {
              log(yellow(`  ⚠ RISK THRESHOLD BREACHED (warn) — score ${thresholdResult.actualScore} > ${thresholdResult.threshold}, proceeding with caution`));
            } else {
              const label = thresholdResult.action === "abort" ? "ABORTED" : "PAUSED";
              log(red(`  ✗ RISK THRESHOLD BREACHED (${thresholdResult.action}) — score ${thresholdResult.actualScore} > ${thresholdResult.threshold}, run ${label}`));
              thresholdBreached = true;
            }
          }
        })
        .finally(() => {
          active.delete(task.taskId);
        });

      active.set(task.taskId, p);
    }

    if (active.size === 0) break; // all tasks done or deadlock guard
    await Promise.race(active.values());
  }

  // Drain any tasks still running (important when approvalRequired or thresholdBreached)
  if (active.size > 0) {
    await Promise.allSettled(active.values());
  }

  if (approvalRequired) return;

  if (thresholdBreached) {
    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      timestamp: new Date().toISOString(),
      actor: "orchestrator",
      event_type: "RUN_FAILED",
      payload: { reason: "risk_threshold_breached" },
    });
    process.exit(1);
  }

  // ── Final summary ─────────────────────────────────────────────────────────────
  banner("RUN COMPLETE");

  const overallPassed = failedTasks.length === 0;
  const summary = [
    completedTasks.length > 0 ? green(`${completedTasks.length} completed`) : null,
    failedTasks.length > 0 ? red(`${failedTasks.length} failed`) : null,
  ]
    .filter(Boolean)
    .join(dim(" · "));

  log(`  ${summary}`);
  log(`  Run ID: ${dim(runId)}`);

  await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type: overallPassed ? "RUN_COMPLETED" : "RUN_FAILED",
    payload: {
      completedTasks: completedTasks.map((t) => t.taskId),
      failedTasks: failedTasks.map((t) => t.taskId),
    },
  });

  log("");

  if (!overallPassed) {
    process.exit(1);
  }
}
