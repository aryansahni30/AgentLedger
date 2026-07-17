/**
 * Builds and formats the session start summary printed by the SessionStart hook.
 *
 * Reads the ledger + persistent stats, verifies chain integrity,
 * and prints a compact context block with trust score.
 */

import path from "path";
import { readStats } from "./stats.js";

/**
 * @typedef {{ runId: string, status: string, taskCount: number, completedCount: number }} RunSummary
 */

/**
 * @typedef {import("./stats.js").Stats} Stats
 */

/**
 * Build a summary of recent AgentLedger activity for the project.
 *
 * @param {string} projectDir
 * @returns {Promise<{ chainValid: boolean, recentRuns: RunSummary[], totalEvents: number, stats: Stats, dashboardStatus?: { running: boolean, port: number } }>}
 */
export async function buildSessionSummary(projectDir) {
  const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");

  const stats = await readStats();

  try {
    const { LedgerReader } = await import("@agentledger/core");
    const { replayLedger } = await import("@agentledger/core");

    const reader = new LedgerReader(ledgerPath);
    const events = await reader.readAll();

    if (events.length === 0) {
      return { chainValid: true, recentRuns: [], totalEvents: 0, stats };
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
      stats,
    };
  } catch {
    // Ledger doesn't exist yet — fresh project
    return { chainValid: true, recentRuns: [], totalEvents: 0, stats };
  }
}

/** Strip ANSI escape codes to get visible character length. */
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const visibleLength = (s) => stripAnsi(s).length;

// ANSI color constants
const C = {
  border: "\x1b[96m",       // bright cyan
  titleBold: "\x1b[1;97m",  // bright white bold
  label: "\x1b[2;37m",      // dim white
  value: "\x1b[97m",        // bright white
  ok: "\x1b[1;92m",         // bright green bold
  fail: "\x1b[1;91m",       // bright red bold
  runOk: "\x1b[92m",        // bright green
  runFail: "\x1b[91m",      // bright red
  dim: "\x1b[2;37m",        // dim white
  url: "\x1b[96m",          // bright cyan
  r: "\x1b[0m",             // reset
};

/**
 * Format the summary as a compact console-printable block with ANSI colors.
 * Hero metric: trust score (claim accuracy percentage).
 *
 * @param {{ chainValid: boolean, recentRuns: RunSummary[], totalEvents: number, stats: Stats, dashboardStatus?: { running: boolean, port: number } }} summary
 * @returns {string}
 */
export function formatSummary(summary) {
  const title = "AgentLedger - Session Start";
  const { stats } = summary;
  const hasClaims = stats.totalClaims > 0;

  // Trust score line — the hero number
  const trustLine = hasClaims
    ? (() => {
        const pct = Math.round(stats.trustScore * 100);
        const color = pct >= 90 ? C.ok : pct >= 70 ? "\x1b[1;93m" : C.fail; // green / yellow / red
        const detail = `${stats.verifiedTrue}/${stats.verifiedTrue + stats.verifiedFalse} claims true`;
        return `  ${C.label}Trust score${C.r}     : ${color}${pct}%${C.r} ${C.dim}(${detail})${C.r}`;
      })()
    : `  ${C.label}Trust score${C.r}     : ${C.dim}— (tracking starts now)${C.r}`;

  // Lies caught
  const liesLine = stats.verifiedFalse > 0
    ? `  ${C.label}Lies caught${C.r}     : ${C.fail}${stats.verifiedFalse}${C.r} ${C.dim}false claims detected${C.r}`
    : `  ${C.label}Lies caught${C.r}     : ${C.ok}0${C.r}`;

  // Writes blocked
  const blocksLine = stats.totalBlocks > 0
    ? `  ${C.label}Writes blocked${C.r}  : ${C.value}${stats.totalBlocks}${C.r} ${C.dim}protected file saves${C.r}`
    : `  ${C.label}Writes blocked${C.r}  : ${C.ok}0${C.r}`;

  // Chain integrity
  const chainStatus = summary.chainValid
    ? `${C.ok}✓ valid${C.r} ${C.dim}(${summary.totalEvents} events)${C.r}`
    : `${C.fail}✗ BROKEN${C.r}`;
  const chainLine = `  ${C.label}Chain integrity${C.r} : ${chainStatus}`;

  // Sessions tracked
  const sessionsLine = `  ${C.label}Sessions${C.r}        : ${C.value}${stats.sessionsTracked}${C.r} ${C.dim}tracked${C.r}`;

  // Dashboard — only show if server is running
  const dash = summary.dashboardStatus;
  const dashPort = dash?.port ?? 4242;
  const dashLine = dash?.running
    ? `  ${C.label}Dashboard${C.r}       : ${C.url}http://localhost:${dashPort}${C.r}`
    : `  ${C.label}Dashboard${C.r}       : ${C.dim}not running${C.r}`;

  const contentLines = [trustLine, liesLine, blocksLine, chainLine, sessionsLine, dashLine];

  // Calculate box width from longest visible content line
  const maxContentWidth = contentLines.reduce(
    (max, line) => Math.max(max, visibleLength(line)),
    0
  );
  const titleWidth = title.length + 4;
  const innerWidth = Math.max(maxContentWidth + 2, titleWidth);

  // Build box
  const topBar = `${C.border}┌${"─".repeat(innerWidth)}┐${C.r}`;
  const bottomBar = `${C.border}└${"─".repeat(innerWidth)}┘${C.r}`;

  const titlePad = innerWidth - title.length;
  const titleLeft = Math.floor(titlePad / 2);
  const titleRight = titlePad - titleLeft;
  const titleLine = `${C.border}│${C.r}${" ".repeat(titleLeft)}${C.titleBold}${title}${C.r}${" ".repeat(titleRight)}${C.border}│${C.r}`;

  const boxedContent = contentLines.map((line) => {
    const pad = innerWidth - visibleLength(line);
    return `${C.border}│${C.r}${line}${" ".repeat(Math.max(pad, 0))}${C.border}│${C.r}`;
  });

  const emptyLine = `${C.border}│${C.r}${" ".repeat(innerWidth)}${C.border}│${C.r}`;

  const lines = [
    "",
    topBar,
    titleLine,
    emptyLine,
    ...boxedContent,
    bottomBar,
    "",
  ];

  return lines.join("\n");
}

/**
 * Format a compact one-liner for stdout (model context).
 *
 * @param {{ chainValid: boolean, recentRuns: RunSummary[], totalEvents: number, stats: Stats }} summary
 * @returns {string}
 */
export function formatOneLiner(summary) {
  const chain = summary.chainValid ? "chain valid" : "chain BROKEN";
  const { stats } = summary;
  const trust = stats.totalClaims > 0
    ? `trust ${Math.round(stats.trustScore * 100)}%`
    : "trust tracking starts now";
  const lies = stats.verifiedFalse > 0
    ? `${stats.verifiedFalse} lies caught`
    : "0 lies";
  return `AgentLedger: ${trust}, ${lies}, ${summary.totalEvents} events, ${chain}, dashboard at :4242`;
}
