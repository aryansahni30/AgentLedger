import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  LedgerWriter,
  IntentContractSchema,
  AgentLedgerConfigSchema,
  TaskGraphSchema,
  VerificationCommandSchema,
  planWithLLM,
  planWithTogether,
  createPlan,
  runWorkerLLM,
  runWorkerTogether,
  verifyTask,
  createTaskWorktree,
  cleanupWorktree,
  topoSort,
  gatherRepoContext,
} from "@agentledger/core";
import type { AgentTask, VerificationCommand } from "@agentledger/core";

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

/**
 * Full orchestrator run loop.
 *
 * Phases:
 *   1. Load config + build IntentContract from request string
 *   2. Plan — LLM or mock planner → TaskGraph
 *   3. For each task (topo-sorted):
 *        a. Create git worktree
 *        b. Run LLM worker inside worktree
 *        c. Run verifier (boundary + commands)
 *        d. Log result events to ledger
 *        e. Cleanup worktree on success; leave it on failure for inspection
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
  } = {},
): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const ledgerPath = join(root, "ledger.jsonl");
  const worktreeBaseDir = join(root, "worktrees");

  // ── Load config ──────────────────────────────────────────────────────────────
  let config;
  try {
    const raw = await readFile(join(root, "config.json"), "utf8");
    config = AgentLedgerConfigSchema.parse(JSON.parse(raw));
  } catch {
    log(red("✗ No .agentledger/config.json — run `agentledger init` first"));
    process.exit(1);
  }

  const writer = new LedgerWriter(ledgerPath);
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

  await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type: "RUN_CREATED",
    payload: { goal: intent.goal, riskLevel: intent.riskLevel },
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
      // Support both a full TaskGraph { tasks: [...] } and a bare array of tasks
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

  // Emit TASK_CREATED events
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

  // Persist task graph for CLI introspection
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "tasks.json"),
    JSON.stringify(graph.tasks, null, 2) + "\n",
    "utf8",
  );

  // ── Execute tasks ─────────────────────────────────────────────────────────────
  const sorted = topoSort(graph.tasks);
  const completedTasks: AgentTask[] = [];
  const failedTasks: AgentTask[] = [];

  for (const task of sorted) {
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

    // Run LLM worker
    log(dim("  Running LLM worker..."));
    let workerResult;
    try {
      const context = {
        task,
        worktreePath: handle.worktreePath,
        relevantContext: {},
        allowedFiles: task.allowedFiles,
        blockedFiles: task.blockedFiles,
        allowedTools: task.allowedTools,
        outputSchema: {},
      };
      workerResult =
        provider === "together"
          ? await runWorkerTogether(context, opts.workerModel)
          : await runWorkerLLM(context, opts.workerModel);
      log(green(`  ✓ Worker done — ${workerResult.filesModified.length} file(s) modified`));
      log(dim(`    Summary: ${workerResult.summary.slice(0, 120)}`));
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
      payload: {
        filesModified: workerResult.filesModified,
        summary: workerResult.summary,
      },
    });

    // Build verification command list from config
    const commands: VerificationCommand[] = Object.entries(config.verification.commands).map(
      ([name, command]) =>
        VerificationCommandSchema.parse({
          name,
          command,
          required: config.verification.required.includes(name),
        }),
    );

    // Run verifier
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

      completedTasks.push(task);
      await cleanupWorktree(targetDir, handle);
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

      failedTasks.push(task);
      // Leave worktree on failure for inspection
      log(dim(`    Worktree preserved at: ${handle.worktreePath}`));
    }
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
