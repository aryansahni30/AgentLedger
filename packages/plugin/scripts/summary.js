/**
 * Builds and formats the session start summary printed by the SessionStart hook.
 *
 * Reads the ledger, verifies chain integrity, replays run state,
 * and prints a compact context block.
 */

import path from "path";

/**
 * @typedef {{ runId: string, status: string, taskCount: number, completedCount: number }} RunSummary
 */

/**
 * Build a summary of recent AgentLedger activity for the project.
 *
 * @param {string} projectDir
 * @returns {Promise<{ chainValid: boolean, recentRuns: RunSummary[], totalEvents: number }>}
 */
export async function buildSessionSummary(projectDir) {
  const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");

  try {
    const { LedgerReader } = await import("@agentledger/core");
    const { replayLedger } = await import("@agentledger/core");

    const reader = new LedgerReader(ledgerPath);
    const events = await reader.readAll();

    if (events.length === 0) {
      return { chainValid: true, recentRuns: [], totalEvents: 0 };
    }

    const chainResult = await reader.verifyChain();

    // Group events by runId to identify unique runs
    const runIds = [...new Set(events.map((e) => e.run_id).filter(Boolean))];

    /** @type {RunSummary[]} */
    const recentRuns = [];

    for (const runId of runIds.slice(-5)) {
      try {
        const runState = replayLedger(events, runId);
        recentRuns.push({
          runId,
          status: runState.status,
          taskCount: Object.keys(runState.tasks ?? {}).length,
          completedCount: Object.values(runState.tasks ?? {}).filter(
            (t) => t.status === "completed"
          ).length,
        });
      } catch {
        recentRuns.push({ runId, status: "unknown", taskCount: 0, completedCount: 0 });
      }
    }

    return {
      chainValid: chainResult.valid,
      recentRuns,
      totalEvents: events.length,
    };
  } catch {
    // Ledger doesn't exist yet — fresh project
    return { chainValid: true, recentRuns: [], totalEvents: 0 };
  }
}

/**
 * Format the summary as a compact console-printable block.
 *
 * @param {{ chainValid: boolean, recentRuns: RunSummary[], totalEvents: number }} summary
 * @returns {string}
 */
export function formatSummary(summary) {
  const lines = ["╔═══════════════════════════════════════╗"];
  lines.push("║        AgentLedger — Session Start       ║");
  lines.push("╚═══════════════════════════════════════╝");

  lines.push(`  Total ledger events : ${summary.totalEvents}`);
  lines.push(`  Chain integrity     : ${summary.chainValid ? "✓ valid" : "✗ BROKEN"}`);

  if (summary.recentRuns.length === 0) {
    lines.push("  Recent runs         : (none)");
  } else {
    lines.push("  Recent runs:");
    for (const run of summary.recentRuns) {
      const tag = run.runId.slice(0, 8);
      lines.push(
        `    [${tag}] ${run.status} — ${run.completedCount}/${run.taskCount} tasks`
      );
    }
  }

  lines.push("  Dashboard           : http://localhost:4242");
  lines.push("");
  return lines.join("\n");
}
