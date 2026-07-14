import { join } from "node:path";
import { LedgerReader } from "@agentledger/core";
import { generateAuditReport, buildLeaderboard } from "@agentledger/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

function riskColor(score: number): string {
  if (score >= 60) return RED;
  if (score >= 30) return YELLOW;
  return GREEN;
}

function severityColor(s: string): string {
  if (s === "critical") return RED;
  if (s === "high") return YELLOW;
  return CYAN;
}

// ─── Exported command ─────────────────────────────────────────────────────────

export async function runLeaderboard(
  targetDir: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  const ledgerDir = join(targetDir, ".agentledger");
  const reader = new LedgerReader(join(ledgerDir, "ledger.jsonl"));
  const events = await reader.readAll();

  if (events.length === 0) {
    console.error("No ledger events found. Run `agentledger run` first.");
    process.exit(1);
  }

  const lb = buildLeaderboard(events);

  if (opts.json) {
    console.log(JSON.stringify(lb, null, 2));
    return;
  }

  console.log(`\n${BOLD}AgentLedger Policy Leaderboard${RESET}`);
  console.log(`${DIM}Generated: ${lb.generatedAt}${RESET}`);
  console.log(`${DIM}Entries: ${lb.entries.length}${RESET}\n`);

  if (lb.entries.length === 0) {
    console.log(`${DIM}No task entries found.${RESET}`);
    return;
  }

  const rankWidth = String(lb.entries.length).length;
  for (let i = 0; i < lb.entries.length; i++) {
    const e = lb.entries[i]!;
    const rank = String(i + 1).padStart(rankWidth);
    const rc = riskColor(e.riskScore);
    console.log(
      `${DIM}#${rank}${RESET} ${BOLD}${e.title}${RESET} ${DIM}(${e.taskId} / run: ${e.runId})${RESET}`,
    );
    console.log(
      `     Risk: ${rc}${e.riskScore}/100${RESET}  ` +
      `Deny: ${RED}${e.denyCount}${RESET}  ` +
      `Req-Approval: ${YELLOW}${e.requireApprovalCount}${RESET}  ` +
      `Boundary: ${e.boundaryViolationCount}  ` +
      `Tool-Denied: ${e.toolDenialCount}`,
    );
  }
  console.log();
}

export async function runAudit(
  targetDir: string,
  opts: { runId?: string; json?: boolean } = {},
): Promise<void> {
  const ledgerDir = join(targetDir, ".agentledger");
  const reader = new LedgerReader(join(ledgerDir, "ledger.jsonl"));
  const events = await reader.readAll();

  if (events.length === 0) {
    console.error("No ledger events found. Run `agentledger run` first.");
    process.exit(1);
  }

  // Determine runId
  let runId = opts.runId;
  if (!runId) {
    // Pick most recent RUN_CREATED
    const runCreated = [...events].reverse().find((e) => e.event_type === "RUN_CREATED");
    if (!runCreated) {
      console.error("No RUN_CREATED event found in ledger.");
      process.exit(1);
    }
    runId = runCreated.run_id;
  }

  const report = generateAuditReport(events, runId);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ── Pretty print ────────────────────────────────────────────────────────────
  const rc = riskColor(report.riskScore.total);
  console.log(`\n${BOLD}AgentLedger Audit Report${RESET}`);
  console.log(`${DIM}Run: ${report.runId}${RESET}`);
  console.log(`${DIM}Goal: ${report.goal}${RESET}`);
  console.log(`${DIM}Status: ${report.runStatus}${RESET}`);
  console.log(`${DIM}Generated: ${report.generatedAt}${RESET}`);

  console.log(`\n${BOLD}Risk Score: ${rc}${report.riskScore.total}/100${RESET}`);
  const b = report.riskScore.breakdown;
  console.log(`  Secret exposure:   ${RED}${b.secret_exposure}/40${RESET}`);
  console.log(`  Schema change:     ${YELLOW}${b.schema_change}/30${RESET}`);
  console.log(`  Auth code:         ${CYAN}${b.auth_change}/20${RESET}`);
  console.log(`  Boundary violation:${b.boundary_violation}/10`);
  console.log(`  Tool denial:       ${b.tool_denial}/10`);

  // ── Governance Summary ───────────────────────────────────────────────────
  const gs = report.governanceSummary;
  const dc = gs.policyDecisionCounts;
  console.log(`\n${BOLD}Governance Summary${RESET}`);
  console.log(`  Policy Decisions:`);
  console.log(`    Allow:            ${GREEN}${dc.allow}${RESET}`);
  console.log(`    Warn:             ${YELLOW}${dc.warn}${RESET}`);
  console.log(`    Require Approval: ${CYAN}${dc.require_approval}${RESET}`);
  console.log(`    Deny:             ${RED}${dc.deny}${RESET}`);
  if (gs.thresholdBreached) {
    console.log(`  Threshold Breached: ${RED}YES${RESET} (action: ${gs.thresholdBreachAction ?? "warn"})`);
  } else {
    console.log(`  Threshold Breached: ${GREEN}No${RESET}`);
  }

  console.log(`\n${BOLD}Approvals Summary${RESET}`);
  console.log(`  Total requested: ${report.approvalsSummary.total}`);
  console.log(`  Granted:         ${GREEN}${report.approvalsSummary.granted}${RESET}`);
  console.log(`  Rejected:        ${RED}${report.approvalsSummary.rejected}${RESET}`);
  console.log(`  Pending:         ${YELLOW}${report.approvalsSummary.pending}${RESET}`);

  console.log(`\n${BOLD}Tasks (${report.tasks.length})${RESET}`);
  for (const task of report.tasks) {
    const statusIcon = task.status === "completed" ? GREEN + "✓" + RESET
      : task.status === "failed" ? RED + "✗" + RESET
      : YELLOW + "~" + RESET;
    console.log(`\n  ${statusIcon} ${BOLD}${task.title}${RESET} ${DIM}(${task.taskId})${RESET}`);

    if (task.patchRisks.length > 0) {
      console.log(`    ${YELLOW}Patch Risks (${task.patchRisks.length}):${RESET}`);
      for (const r of task.patchRisks) {
        const sc = severityColor(r.severity);
        console.log(`      ${sc}[${r.severity.toUpperCase()}]${RESET} ${r.category} — ${r.pattern}`);
        console.log(`        ${DIM}${r.filePath}:${r.lineNumber} — ${r.lineContext}${RESET}`);
      }
    }

    if (task.toolDenials.length > 0) {
      console.log(`    ${RED}Tool Denials (${task.toolDenials.length}):${RESET}`);
      for (const d of task.toolDenials) {
        console.log(`      ${d.violationType} — ${d.path} (${d.reason})`);
      }
    }

    if (task.boundaryViolations.length > 0) {
      console.log(`    ${RED}Boundary Violations (${task.boundaryViolations.length}):${RESET}`);
      for (const bv of task.boundaryViolations) {
        console.log(`      ${bv.violationType} — ${bv.file}`);
      }
    }

    if (task.policyDecision) {
      const ac = task.policyDecision.action === "deny" ? RED
        : task.policyDecision.action === "require_approval" ? YELLOW
        : task.policyDecision.action === "warn" ? CYAN
        : GREEN;
      console.log(`    Policy: ${ac}${task.policyDecision.action.toUpperCase()}${RESET}`);
    }

    if (task.approvalRecord) {
      const ar = task.approvalRecord;
      const state = ar.grantedAt ? `${GREEN}GRANTED${RESET}` : ar.rejectedAt ? `${RED}REJECTED${RESET}` : `${YELLOW}PENDING${RESET}`;
      console.log(`    Approval: ${state}`);
    }

    if (task.filesModified.length > 0) {
      console.log(`    Files: ${task.filesModified.join(", ")}`);
    }
  }

  console.log(`\n${BOLD}All Files Modified (${report.allFilesModified.length}):${RESET}`);
  for (const f of report.allFilesModified) {
    console.log(`  ${DIM}${f}${RESET}`);
  }

  console.log();
}
