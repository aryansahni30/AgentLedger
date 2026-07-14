import { readFile } from "fs/promises";
import { join } from "path";
import {
  LedgerWriter,
  LedgerReader,
  AgentLedgerConfigSchema,
  VerificationCommandSchema,
  replayLedger,
  verifyTask,
  cleanupWorktree,
  topoSort,
  runWorkerLLM,
  runWorkerTogether,
  isApproved,
  isAwaitingApproval,
} from "@agentledger/core";
import type { AgentTask, LedgerEvent, VerificationCommand, WorkerContext, WorkerResult } from "@agentledger/core";

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

/** Extracts worktree path from WORKTREE_CREATED event in the ledger */
function findWorktreePath(events: LedgerEvent[], runId: string, taskId: string): string | undefined {
  return events.find(
    (e) => e.run_id === runId && e.task_id === taskId && e.event_type === "WORKTREE_CREATED",
  )?.payload["worktreePath"] as string | undefined;
}

/** Reconstructs a partial WorkerResult from ledger events (for verification after resume) */
function reconstructWorkerResult(
  events: LedgerEvent[],
  runId: string,
  taskId: string,
  worktreeBranch: string,
): Pick<WorkerResult, "taskId" | "filesModified" | "summary" | "worktreeBranch"> {
  const patchEvent = events.find(
    (e) => e.run_id === runId && e.task_id === taskId && e.event_type === "PATCH_PROPOSED",
  );
  return {
    taskId,
    filesModified: Array.isArray(patchEvent?.payload["filesModified"])
      ? (patchEvent?.payload["filesModified"] as string[])
      : [],
    summary: typeof patchEvent?.payload["summary"] === "string"
      ? (patchEvent?.payload["summary"] as string)
      : "",
    worktreeBranch,
  };
}

/**
 * Resumes a paused run after human approval.
 *
 * Expects:
 *   1. `agentledger approvals approve <run_id>` was already called (HUMAN_APPROVAL_GRANTED in ledger)
 *   2. The worktree is still on disk (never cleaned up when pausing for approval)
 *
 * Flow:
 *   - Replay ledger to find current state
 *   - For tasks in awaiting_verification → run verifier on preserved worktree
 *   - For tasks still pending → run full worker + verify flow
 *   - Skip completed/failed tasks
 */
export async function runResume(
  runId: string,
  targetDir: string,
  opts: {
    workerModel?: string;
    provider?: "anthropic" | "together";
    workerFn?: (context: WorkerContext) => Promise<WorkerResult>;
  } = {},
): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const ledgerPath = join(root, "ledger.jsonl");
  const worktreeBaseDir = join(root, "worktrees");

  // ── Load config ───────────────────────────────────────────────────────────
  let config;
  try {
    const raw = await readFile(join(root, "config.json"), "utf8");
    config = AgentLedgerConfigSchema.parse(JSON.parse(raw));
  } catch {
    log(red("✗ No .agentledger/config.json — run `agentledger init` first"));
    process.exit(1);
  }

  // ── Load ledger + replay ──────────────────────────────────────────────────
  const reader = new LedgerReader(ledgerPath);
  const writer = new LedgerWriter(ledgerPath);

  let events;
  try {
    events = await reader.readAll();
  } catch {
    log(red(`✗ Could not read ledger at ${ledgerPath}`));
    process.exit(1);
  }

  const runEvents = events.filter((e) => e.run_id === runId);
  if (runEvents.length === 0) {
    log(red(`✗ Run ${runId} not found in ledger`));
    process.exit(1);
  }

  const runState = replayLedger(events, runId);

  if (runState.status !== "paused" && runState.status !== "executing") {
    log(red(`✗ Run ${runId} is not paused (status: ${runState.status})`));
    if (runState.status === "completed") log(dim("  Run already completed."));
    if (runState.status === "failed") log(dim("  Run ended in failure."));
    process.exit(1);
  }

  // ── Load task graph ────────────────────────────────────────────────────────
  let allTasks: AgentTask[];
  try {
    const raw = await readFile(join(root, "tasks.json"), "utf8");
    allTasks = JSON.parse(raw) as AgentTask[];
  } catch {
    log(red("✗ Could not read .agentledger/tasks.json — was this run started with `agentledger run`?"));
    process.exit(1);
  }

  banner(`RESUMING RUN ${runId.slice(0, 8)}…`);
  log(`  Status: ${yellow(runState.status)}`);
  log(`  Goal  : ${runState.goal}`);
  log(`  Tasks : ${runState.tasks.length} total`);

  const sorted = topoSort(allTasks);
  const completedTasks: AgentTask[] = [];
  const failedTasks: AgentTask[] = [];
  const provider = opts.provider ?? "anthropic";

  for (const task of sorted) {
    const taskState = runState.tasks.find((t) => t.taskId === task.taskId);
    const currentStatus = taskState?.status ?? "pending";

    if (currentStatus === "completed") {
      log(dim(`  ↷ Skipping ${task.title} (already completed)`));
      completedTasks.push(task);
      continue;
    }

    if (currentStatus === "failed") {
      log(dim(`  ↷ Skipping ${task.title} (already failed)`));
      failedTasks.push(task);
      continue;
    }

    if (currentStatus === "awaiting_approval") {
      // Not yet approved — check if approval was granted
      if (!isApproved(events, task.taskId)) {
        banner("STILL AWAITING APPROVAL");
        log(yellow(`  Task: ${task.title}`));
        if (isAwaitingApproval(events, task.taskId)) {
          log(`\n  ${bold("To approve:")}  agentledger approvals approve ${runId}`);
          log(`  ${bold("To reject:")}   agentledger approvals reject ${runId}`);
        }
        return;
      }
      // Approval granted — fall through to awaiting_verification handling below
    }

    banner(`TASK: ${task.title}`);
    log(`  ID     : ${dim(task.taskId)}`);
    log(`  Status : ${currentStatus}`);

    // ── Case 1: approved, needs verification on preserved worktree ───────────
    if (currentStatus === "awaiting_approval" || currentStatus === "awaiting_verification") {
      const worktreePath = findWorktreePath(events, runId, task.taskId);
      const worktreeBranch = (
        events.find(
          (e) => e.run_id === runId && e.task_id === task.taskId && e.event_type === "WORKTREE_CREATED",
        )?.payload["branch"] as string | undefined
      ) ?? task.taskId;

      if (!worktreePath) {
        log(red(`  ✗ Worktree path not found in ledger for task ${task.taskId}`));
        failedTasks.push(task);
        await writer.appendEvent({
          event_id: LedgerWriter.createEventId(),
          run_id: runId,
          task_id: task.taskId,
          timestamp: new Date().toISOString(),
          actor: "orchestrator",
          event_type: "TASK_FAILED",
          payload: { reason: "worktree_not_found_on_resume" },
        });
        continue;
      }

      const partialResult = reconstructWorkerResult(events, runId, task.taskId, worktreeBranch);
      log(dim(`  Worktree: ${worktreePath}`));
      log(dim(`  Running verifier on preserved worktree...`));

      const commands: VerificationCommand[] = Object.entries(config.verification.commands).map(
        ([name, command]) =>
          VerificationCommandSchema.parse({
            name,
            command,
            required: config.verification.required.includes(name),
          }),
      );

      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "verifier",
        event_type: "VERIFICATION_STARTED",
        payload: { commandCount: commands.length, resumedFrom: "approval" },
      });

      const verificationResult = await verifyTask(worktreePath, task, commands);

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
          payload: { filesModified: partialResult.filesModified },
        });
        completedTasks.push(task);
        await cleanupWorktree(targetDir, { taskId: task.taskId, branch: worktreeBranch, worktreePath });
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
        failedTasks.push(task);
        log(dim(`  Worktree preserved at: ${worktreePath}`));
      }
      continue;
    }

    // ── Case 2: task not yet started — run full worker + verify ──────────────
    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: "orchestrator",
      event_type: "TASK_ASSIGNED",
      payload: { owner: task.owner },
    });

    let handle;
    try {
      log(dim("  Creating git worktree..."));
      handle = await import("@agentledger/core").then((m) =>
        m.createTaskWorktree(targetDir, task, worktreeBaseDir),
      );
      log(green(`  ✓ Worktree: ${handle.worktreePath}`));
    } catch (err) {
      log(red(`  ✗ Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`));
      failedTasks.push(task);
      await writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: runId,
        task_id: task.taskId,
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "TASK_FAILED",
        payload: { reason: "worktree_creation_failed" },
      });
      continue;
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

    log(dim("  Running LLM worker..."));
    let workerResult: WorkerResult;
    try {
      const context: WorkerContext = {
        task,
        worktreePath: handle.worktreePath,
        relevantContext: {},
        allowedFiles: task.allowedFiles,
        blockedFiles: task.blockedFiles,
        allowedTools: task.allowedTools,
        outputSchema: {},
      };
      if (opts.workerFn) {
        workerResult = await opts.workerFn(context);
      } else {
        workerResult =
          provider === "together"
            ? await runWorkerTogether(context, opts.workerModel)
            : await runWorkerLLM(context, opts.workerModel);
      }
      log(green(`  ✓ Worker done — ${workerResult.filesModified.length} file(s) modified`));
    } catch (err) {
      log(red(`  ✗ Worker failed: ${err instanceof Error ? err.message : String(err)}`));
      failedTasks.push(task);
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
      continue;
    }

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: runId,
      task_id: task.taskId,
      timestamp: new Date().toISOString(),
      actor: task.owner,
      event_type: "PATCH_PROPOSED",
      payload: { filesModified: workerResult.filesModified, summary: workerResult.summary },
    });

    // No approval re-check on resume for newly started tasks (policy may have changed)
    // Run verifier directly

    const commands: VerificationCommand[] = Object.entries(config.verification.commands).map(
      ([name, command]) =>
        VerificationCommandSchema.parse({
          name,
          command,
          required: config.verification.required.includes(name),
        }),
    );

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
        payload: {},
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
      completedTasks.push(task);
      await cleanupWorktree(targetDir, handle);
    } else {
      log(red(`  ✗ Verification FAILED`));
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
      failedTasks.push(task);
      log(dim(`  Worktree preserved at: ${handle.worktreePath}`));
    }
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  banner("RESUME COMPLETE");

  const overallPassed = failedTasks.length === 0;
  const summary = [
    completedTasks.length > 0 ? green(`${completedTasks.length} completed`) : null,
    failedTasks.length > 0 ? red(`${failedTasks.length} failed`) : null,
  ]
    .filter(Boolean)
    .join(dim(" · "));

  log(`  ${summary}`);
  log(`  Run ID: ${dim(runId)}\n`);

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

  if (!overallPassed) {
    process.exit(1);
  }
}
