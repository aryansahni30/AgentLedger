import { join } from "path";
import { LedgerReader, LedgerWriter, replayLedger, reassignTask } from "@agentledger/core";

const AGENTLEDGER_DIR = ".agentledger";

function colorize(text: string, code: number): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

const green = (s: string) => colorize(s, 32);
const red = (s: string) => colorize(s, 31);
const dim = (s: string) => colorize(s, 2);

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

/**
 * Reassign a pending task to a new owner.
 *
 * Reads the current task state via replay, validates that it is `pending`,
 * then emits a TASK_ASSIGNED event with the new owner so the ledger reflects
 * the handoff.
 */
export async function runAssign(
  runId: string,
  taskId: string,
  newOwner: string,
  targetDir: string,
): Promise<void> {
  const ledgerPath = join(targetDir, AGENTLEDGER_DIR, "ledger.jsonl");
  const reader = new LedgerReader(ledgerPath);

  let events;
  try {
    events = await reader.readAll();
  } catch {
    log(red("✗ No ledger found — run `agentledger init` and `agentledger run` first"));
    process.exit(1);
  }

  const state = replayLedger(events, runId);

  const task = state.tasks.find((t) => t.taskId === taskId);
  if (!task) {
    log(red(`✗ Task "${taskId}" not found in run "${runId}".`));
    log(dim("  Use `agentledger replay -r <runId>` to list task IDs."));
    process.exit(1);
  }

  const writer = new LedgerWriter(ledgerPath);

  try {
    await reassignTask(task, newOwner, writer);
  } catch (err) {
    log(red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  log(green(`✓ Task "${taskId}" (${task.title}) reassigned to "${newOwner}".`));
  log(dim(`  Owner change recorded in ledger — replay will show new assignment.`));
}
