import { join } from "path";
import { LedgerReader, generateHandoff, generateHandoffBrief } from "@agentledger/core";
import type { HandoffDocument, HandoffBrief } from "@agentledger/core";

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

function printHandoff(doc: HandoffDocument): void {
  log(bold(cyan(`\n═══ HANDOFF DOCUMENT ═══`)));
  log(`  Run ID   : ${dim(doc.runId)}`);
  log(`  Goal     : ${doc.goal}`);
  log(`  Status   : ${doc.runStatus}`);
  log("");

  if (doc.completedTasks.length > 0) {
    log(bold(green("Completed Tasks")));
    for (const t of doc.completedTasks) {
      log(`  ${green("✓")} ${t.title} ${dim(`(${t.taskId})`)}`);
      if (t.summary) log(`      ${dim(t.summary.slice(0, 120))}`);
      if (t.filesModified.length > 0) {
        log(`      Files: ${t.filesModified.join(", ")}`);
      }
    }
    log("");
  }

  if (doc.awaitingApproval.length > 0) {
    log(bold(yellow("Awaiting Approval")));
    for (const t of doc.awaitingApproval) {
      log(`  ${yellow("⏳")} ${t.title} ${dim(`(${t.taskId})`)}`);
      log(`      Requested at: ${t.requestedAt}`);
    }
    log("");
  }

  if (doc.pendingTasks.length > 0) {
    log(bold("Pending Tasks"));
    for (const t of doc.pendingTasks) {
      const blockedLabel =
        t.blockedBy.length > 0 ? red(` [blocked by: ${t.blockedBy.join(", ")}]`) : "";
      log(`  • ${t.title} ${dim(`(${t.taskId})`)}${blockedLabel}`);
      log(`      Owner: ${t.owner}`);
    }
    log("");
  }

  if (doc.failedTasks.length > 0) {
    log(bold(red("Failed Tasks")));
    for (const t of doc.failedTasks) {
      log(`  ${red("✗")} ${t.title} ${dim(`(${t.taskId})`)}`);
      log(`      Reason: ${t.failureReason}`);
    }
    log("");
  }

  if (doc.allFilesModified.length > 0) {
    log(bold("All Modified Files"));
    for (const f of doc.allFilesModified) {
      log(`  • ${f}`);
    }
    log("");
  }

  log(bold("Suggested Next Action"));
  log(`  ${doc.suggestedNextAction}`);
  log("");
}

function printBrief(brief: HandoffBrief): void {
  const statusColor =
    brief.runStatus === "completed"
      ? green
      : brief.runStatus === "failed"
        ? red
        : yellow;

  log(bold(cyan(`\n═══ HANDOFF BRIEF ═══`)));
  log(`  Run ID   : ${dim(brief.runId)}`);
  log(`  Goal     : ${brief.goal}`);
  log(`  Status   : ${statusColor(brief.runStatus.toUpperCase())}`);
  log(`  Generated: ${dim(brief.generatedAt)}`);
  log("");

  if (brief.completedTasks.length > 0) {
    log(bold(green(`Completed (${brief.completedTasks.length})`)));
    for (const t of brief.completedTasks) {
      log(`  ${green("✓")} ${t.title} ${dim(`(${t.taskId})`)}`);
      if (t.filesModified.length > 0) {
        log(`      Files: ${t.filesModified.join(", ")}`);
      }
    }
    log("");
  }

  if (brief.failedTasks.length > 0) {
    log(bold(red(`Failed (${brief.failedTasks.length})`)));
    for (const t of brief.failedTasks) {
      const ctxPart = t.context?.violatedFile
        ? ` — violated: ${t.context.violatedFile}`
        : t.context?.detail
          ? ` — ${t.context.detail.slice(0, 80)}`
          : "";
      log(`  ${red("✗")} ${t.title} ${dim(`(${t.taskId})`)} [${yellow(t.reason)}${ctxPart}]`);
      if (t.attemptedFiles.length > 0) {
        log(`      Attempted: ${t.attemptedFiles.join(", ")}`);
      }
    }
    log("");
  }

  if (brief.awaitingApproval.length > 0) {
    log(bold(yellow(`Awaiting Approval (${brief.awaitingApproval.length})`)));
    for (const t of brief.awaitingApproval) {
      log(`  ${yellow("⏳")} ${t.title} ${dim(`(${t.taskId})`)}`);
      log(`      Requested at: ${t.requestedAt}`);
    }
    log("");
  }

  if (brief.inProgressTasks.length > 0) {
    log(bold(cyan(`In Progress (${brief.inProgressTasks.length})`)));
    for (const t of brief.inProgressTasks) {
      log(`  ↺ ${t.title} ${dim(`(${t.taskId})`)}`);
    }
    log("");
  }

  if (brief.pendingTasks.length > 0) {
    log(bold(`Pending (${brief.pendingTasks.length})`));
    for (const t of brief.pendingTasks) {
      const blockedLabel =
        t.blockedBy.length > 0 ? red(` [blocked: ${t.blockedBy.join(", ")}]`) : green(" [ready]");
      log(`  → ${t.title} ${dim(`(${t.taskId})`)}${blockedLabel}`);
    }
    log("");
  }

  if (brief.unresolvedRisks.length > 0) {
    log(bold(red(`Unresolved Risks (${brief.unresolvedRisks.length})`)));
    for (const r of brief.unresolvedRisks) {
      const sev = r.severity === "critical" ? red(r.severity) : r.severity === "high" ? yellow(r.severity) : r.severity;
      log(`  ⚠ ${sev}/${r.category} in ${r.filePath} [${dim(r.pattern)}]`);
    }
    log("");
  }

  if (brief.fileInventory.mergedFiles.length > 0) {
    log(bold("Merged Files"));
    for (const f of brief.fileInventory.mergedFiles) log(`  ${green("✓")} ${f}`);
    log("");
  }

  if (brief.fileInventory.worktreeFiles.length > 0) {
    log(bold(yellow("Unmerged (Worktree) Files")));
    for (const f of brief.fileInventory.worktreeFiles) log(`  ${yellow("~")} ${f}`);
    log("");
  }

  log(bold("Next Action"));
  log(`  ${cyan(brief.resumptionGuidance.action)} — ${brief.resumptionGuidance.detail}`);
  log(`  Run: ${bold(brief.resumptionGuidance.command)}`);
  log("");
}

const AGENT_PROMPT_TEMPLATE = `You are resuming an AgentLedger run on behalf of a developer who is unavailable.
Below is the current execution context. Read it carefully before taking any action.

<handoff_brief>
{CONTEXT_SUMMARY}
</handoff_brief>

Your task:
1. Review the brief and understand where the run left off.
2. Execute the recommended next action: {ACTION}
3. Run the suggested command: {COMMAND}
4. Follow the AgentLedger protocol — do not touch files outside your assigned scope.
`;

function buildAgentPrompt(brief: HandoffBrief): string {
  return AGENT_PROMPT_TEMPLATE
    .replace("{CONTEXT_SUMMARY}", brief.contextSummary)
    .replace("{ACTION}", brief.resumptionGuidance.action)
    .replace("{COMMAND}", brief.resumptionGuidance.command);
}

export async function runHandoff(
  targetDir: string,
  opts: { runId?: string; json?: boolean; brief?: boolean; agentPrompt?: boolean } = {},
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

  // Resolve run ID
  let runId = opts.runId;
  if (!runId) {
    const runCreatedEvents = events.filter((e) => e.event_type === "RUN_CREATED");
    const last = runCreatedEvents[runCreatedEvents.length - 1];
    if (!last) {
      log(red("✗ No runs found in ledger."));
      process.exit(1);
    }
    runId = last.run_id;
  }

  // --brief or --agent-prompt: use the richer HandoffBrief
  if (opts.brief || opts.agentPrompt) {
    const brief = generateHandoffBrief(events, runId);

    if (opts.json) {
      process.stdout.write(JSON.stringify(brief, null, 2) + "\n");
      return;
    }

    if (opts.agentPrompt) {
      process.stdout.write(buildAgentPrompt(brief) + "\n");
      return;
    }

    printBrief(brief);
    return;
  }

  const doc = generateHandoff(events, runId);

  if (opts.json) {
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    return;
  }

  printHandoff(doc);
}
