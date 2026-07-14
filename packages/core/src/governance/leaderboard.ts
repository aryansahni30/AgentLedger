import type { LedgerEvent, PolicyLeaderboard, LeaderboardEntry } from "../schemas/index.js";
import { generateAuditReport, computeRiskScore } from "./auditReport.js";

/**
 * Pure function — builds a cross-run per-task leaderboard sorted by riskScore descending.
 * All data sourced from the ledger; no I/O.
 */
export function buildLeaderboard(events: LedgerEvent[]): PolicyLeaderboard {
  const runIds = [
    ...new Set(
      events.filter((e) => e.event_type === "RUN_CREATED").map((e) => e.run_id),
    ),
  ];

  const entries: LeaderboardEntry[] = [];

  for (const runId of runIds) {
    const report = generateAuditReport(events, runId);

    for (const task of report.tasks) {
      const taskScore = computeRiskScore([task]);

      const denyCount = task.policyDecision?.action === "deny" ? 1 : 0;
      const requireApprovalCount =
        task.policyDecision?.action === "require_approval" ? 1 : 0;

      entries.push({
        runId,
        taskId: task.taskId,
        title: task.title,
        riskScore: taskScore.total,
        denyCount,
        requireApprovalCount,
        boundaryViolationCount: task.boundaryViolations.length,
        toolDenialCount: task.toolDenials.length,
      });
    }
  }

  entries.sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    return a.taskId.localeCompare(b.taskId);
  });

  return {
    generatedAt: new Date().toISOString(),
    entries,
  };
}
