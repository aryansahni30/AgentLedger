import { join } from "path";
import { LedgerReader, replayLedger, RunReplayError } from "@agentledger/core";
import type { RunState } from "@agentledger/core";

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

const STATUS_COLOR: Record<string, (s: string) => string> = {
  created: dim,
  planning: yellow,
  executing: cyan,
  verifying: yellow,
  completed: green,
  failed: red,
};

const TASK_STATUS_COLOR: Record<string, (s: string) => string> = {
  pending: dim,
  assigned: yellow,
  running: cyan,
  awaiting_verification: yellow,
  completed: green,
  failed: red,
};

function fmtStatus(status: string, colorMap: Record<string, (s: string) => string>): string {
  const fn = colorMap[status] ?? ((s: string) => s);
  return fn(status);
}

function printRunState(state: RunState): void {
  const statusFn = STATUS_COLOR[state.status] ?? ((s: string) => s);

  console.log();
  console.log(bold(`Run: ${state.runId}`));
  console.log(`  ${dim("status:")}  ${statusFn(state.status)}`);
  console.log(`  ${dim("goal:")}    ${state.goal || dim("(none)")}`);
  if (state.startedAt) {
    console.log(`  ${dim("started:")} ${state.startedAt}`);
  }
  if (state.completedAt) {
    console.log(`  ${dim("ended:")}   ${state.completedAt}`);
  }

  if (state.filesModified.length > 0) {
    console.log();
    console.log(dim("  Files modified:"));
    for (const f of state.filesModified) {
      console.log(`    ${dim("·")} ${f}`);
    }
  }

  if (state.tasks.length > 0) {
    console.log();
    console.log(dim("  Tasks:"));
    for (const task of state.tasks) {
      const taskStatusFn = TASK_STATUS_COLOR[task.status] ?? ((s: string) => s);
      console.log(
        `    ${taskStatusFn("●")} ${bold(task.taskId)} — ${fmtStatus(task.status, TASK_STATUS_COLOR)}`,
      );
      console.log(`      ${dim(task.title)}`);
    }
  } else {
    console.log();
    console.log(dim("  (no tasks)"));
  }

  console.log();
}

/**
 * Reconstructs run state from the ledger event log.
 *
 * Usage: agentledger replay [--run <runId>] [--dir <path>] [--no-verify-chain]
 */
export async function runReplay(
  targetDir: string,
  opts: { runId?: string; verifyChain?: boolean } = {},
): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const ledgerPath = join(root, "ledger.jsonl");
  const reader = new LedgerReader(ledgerPath);

  // Optionally verify hash chain integrity first
  if (opts.verifyChain !== false) {
    const chainResult = await reader.verifyChain();
    if (!chainResult.valid) {
      console.error(
        red(
          `✗ Hash chain integrity check FAILED at event ${chainResult.firstInvalidIndex}: ${chainResult.reason}`,
        ),
      );
      process.exit(1);
    }
    console.log(green("✓ Hash chain integrity verified"));
  }

  const events = await reader.readAll();

  if (events.length === 0) {
    console.log(yellow("Ledger is empty — no events to replay"));
    return;
  }

  // Collect unique run IDs in order of first appearance
  const runIds: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!seen.has(e.run_id)) {
      runIds.push(e.run_id);
      seen.add(e.run_id);
    }
  }

  if (opts.runId) {
    if (!seen.has(opts.runId)) {
      console.error(red(`✗ Run ID not found in ledger: ${opts.runId}`));
      console.log(dim(`  Known runs: ${runIds.join(", ")}`));
      process.exit(1);
    }
    // Replay single run
    try {
      const state = replayLedger(events, opts.runId);
      printRunState(state);
    } catch (err) {
      if (err instanceof RunReplayError) {
        console.error(
          red(`✗ Replay error at event ${err.eventIndex} (${err.eventType}): ${err.message}`),
        );
        process.exit(1);
      }
      throw err;
    }
  } else {
    // Replay all runs — show a summary
    console.log(bold(`\nLedger replay — ${runIds.length} run(s):`));

    const states: RunState[] = [];
    for (const runId of runIds) {
      try {
        const state = replayLedger(events, runId);
        states.push(state);
      } catch (err) {
        if (err instanceof RunReplayError) {
          console.error(
            red(`✗ Replay error in run ${runId} at event ${err.eventIndex}: ${err.message}`),
          );
          process.exit(1);
        }
        throw err;
      }
    }

    for (const state of states) {
      printRunState(state);
    }

    // Final summary line
    const completed = states.filter((s) => s.status === "completed").length;
    const failed = states.filter((s) => s.status === "failed").length;
    const inProgress = states.length - completed - failed;
    const parts: string[] = [];
    if (completed > 0) parts.push(green(`${completed} completed`));
    if (failed > 0) parts.push(red(`${failed} failed`));
    if (inProgress > 0) parts.push(yellow(`${inProgress} in progress`));
    console.log(dim(`  ${parts.join(" · ")}`));
    console.log();
  }
}
