import { join } from "path";
import {
  LedgerWriter,
  LedgerReader,
  getPendingApprovals,
  isApproved,
  isRejected,
} from "@agentledger/core";

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
 * Lists all pending approval requests across all runs.
 */
export async function listApprovals(targetDir: string): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const ledgerPath = join(root, "ledger.jsonl");

  const reader = new LedgerReader(ledgerPath);
  let events;
  try {
    events = await reader.readAll();
  } catch {
    log(red("✗ Could not read ledger. Run `agentledger init` first."));
    process.exit(1);
  }

  const pending = getPendingApprovals(events);

  banner("PENDING APPROVALS");

  if (pending.length === 0) {
    log(dim("  No pending approvals.\n"));
    return;
  }

  for (const approval of pending) {
    log(`\n  ${bold(yellow("⚠"))} ${bold(approval.runId.slice(0, 8))}… / ${dim(approval.taskId.slice(0, 8))}…`);
    log(`    Requested : ${dim(new Date(approval.requestedAt).toLocaleString())}`);
    log(`    Reasons   :`);
    for (const r of approval.reasons) {
      log(`      ${yellow("•")} ${r}`);
    }
    if (approval.filesModified.length > 0) {
      log(`    Files     :`);
      for (const f of approval.filesModified) {
        log(`      ${dim("•")} ${f}`);
      }
    }
    if (approval.summary) {
      log(`    Summary   : ${dim(approval.summary.slice(0, 160))}`);
    }
    log(`\n    ${bold("approve:")} agentledger approvals approve ${approval.runId}`);
    log(`    ${bold("reject:")}  agentledger approvals reject ${approval.runId}`);
  }

  log("");
}

/**
 * Approves a pending run, emitting HUMAN_APPROVAL_GRANTED to the ledger.
 * After granting, prints instructions to run `agentledger resume <run_id>`.
 */
export async function approveRun(runId: string, targetDir: string): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const ledgerPath = join(root, "ledger.jsonl");

  const reader = new LedgerReader(ledgerPath);
  let events;
  try {
    events = await reader.readAll();
  } catch {
    log(red("✗ Could not read ledger."));
    process.exit(1);
  }

  const pending = getPendingApprovals(events);
  const approval = pending.find((p) => p.runId === runId);

  if (!approval) {
    if (isApproved(events, runId)) {
      log(yellow(`  Run ${runId.slice(0, 8)}… already approved.`));
    } else if (isRejected(events, runId)) {
      log(red(`  Run ${runId.slice(0, 8)}… was already rejected.`));
    } else {
      log(red(`✗ No pending approval found for run ${runId.slice(0, 8)}…`));
      log(dim("  Use `agentledger approvals list` to see pending approvals."));
    }
    process.exit(1);
  }

  const writer = new LedgerWriter(ledgerPath);
  await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: runId,
    task_id: approval.taskId,
    timestamp: new Date().toISOString(),
    actor: "human",
    event_type: "HUMAN_APPROVAL_GRANTED",
    payload: {
      approvedAt: new Date().toISOString(),
      taskId: approval.taskId,
    },
  });

  log(green(`\n  ✓ Approved run ${runId.slice(0, 8)}… / task ${approval.taskId.slice(0, 8)}…`));
  log(`\n  ${bold("To continue:")}  agentledger resume ${runId}\n`);
}

/**
 * Rejects a pending run, emitting HUMAN_APPROVAL_REJECTED to the ledger.
 */
export async function rejectRun(
  runId: string,
  targetDir: string,
  reason?: string,
): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const ledgerPath = join(root, "ledger.jsonl");

  const reader = new LedgerReader(ledgerPath);
  let events;
  try {
    events = await reader.readAll();
  } catch {
    log(red("✗ Could not read ledger."));
    process.exit(1);
  }

  const pending = getPendingApprovals(events);
  const approval = pending.find((p) => p.runId === runId);

  if (!approval) {
    if (isRejected(events, runId)) {
      log(yellow(`  Run ${runId.slice(0, 8)}… was already rejected.`));
    } else {
      log(red(`✗ No pending approval found for run ${runId.slice(0, 8)}…`));
    }
    process.exit(1);
  }

  const writer = new LedgerWriter(ledgerPath);
  await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: runId,
    task_id: approval.taskId,
    timestamp: new Date().toISOString(),
    actor: "human",
    event_type: "HUMAN_APPROVAL_REJECTED",
    payload: {
      rejectedAt: new Date().toISOString(),
      taskId: approval.taskId,
      reason: reason ?? "rejected by human reviewer",
    },
  });

  log(red(`\n  ✗ Rejected run ${runId.slice(0, 8)}… / task ${approval.taskId.slice(0, 8)}…`));
  if (reason) log(dim(`  Reason: ${reason}`));
  log("");
}
