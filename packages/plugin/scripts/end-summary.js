/**
 * Session-end box persistence + replay.
 *
 * Why this exists: Claude Code renders SessionStart hook stdout (via systemMessage)
 * but SILENTLY SWALLOWS SessionEnd hook stdout — the terminal is already tearing
 * down when SessionEnd fires. So the documented "Session End" box, printed with
 * console.log from the SessionEnd hook, is never visible to the user.
 *
 * Fix: SessionEnd persists its rendered box here; the NEXT SessionStart replays it
 * into a rendered systemMessage. Because `/clear` fires SessionEnd → SessionStart
 * back-to-back, the End box appears the instant you clear. After a hard quit it
 * surfaces at the next launch. The file is deleted on read so it renders exactly once.
 *
 * Compaction is different: it fires SessionStart with source="compact" but does NOT
 * fire SessionEnd (the session continues). renderCheckpointBox() builds a live
 * mid-session box from the current, un-cleared session state for that case.
 */

import fs from "fs";
import path from "path";

const SUMMARY_FILE = "last-session-summary.txt";

/** @param {string} projectDir @returns {string} */
function summaryPath(projectDir) {
  return path.join(projectDir, ".agentledger", SUMMARY_FILE);
}

/**
 * Persist the rendered Session End box for the next SessionStart to replay.
 * Non-fatal: a write failure must never break session teardown.
 *
 * @param {string} projectDir
 * @param {string} text  Fully rendered box (multi-line).
 * @returns {void}
 */
export function writeLastSummary(projectDir, text) {
  try {
    const p = summaryPath(projectDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, "utf8");
  } catch {
    // Non-fatal — the box was already console.logged; persistence is a bonus.
  }
}

/**
 * Read the persisted End box and delete it so it renders exactly once — right
 * after the session that produced it (on /clear, or at the next launch).
 *
 * @param {string} projectDir
 * @returns {string | null}
 */
export function readAndClearLastSummary(projectDir) {
  try {
    const p = summaryPath(projectDir);
    if (!fs.existsSync(p)) return null;
    const text = fs.readFileSync(p, "utf8");
    fs.rmSync(p, { force: true });
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/**
 * Draw the 3-line header box used by both the End and Checkpoint summaries.
 * Content lines are printed below it as plain indented text (matching the
 * existing Session End box style), not boxed.
 *
 * @param {string} title
 * @returns {string[]}
 */
function headerBox(title) {
  const inner = title.length + 12;
  const bar = "═".repeat(inner);
  const pad = inner - title.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return [
    `╔${bar}╗`,
    `║${" ".repeat(left)}${title}${" ".repeat(right)}║`,
    `╚${bar}╝`,
  ];
}

/**
 * @typedef {import("./state.js").SessionState} SessionState
 * @typedef {import("./stats.js").Stats} Stats
 */

/**
 * Render a live mid-session checkpoint box from the current (un-cleared) session
 * state. Used on SessionStart source="compact", where no SessionEnd has run.
 *
 * Cheap by design: reads in-memory state + persistent stats only. No test run,
 * no git diff — SessionStart has a tight timeout and the session is ongoing.
 *
 * @param {SessionState} state
 * @param {Stats} stats
 * @returns {string}
 */
export function renderCheckpointBox(state, stats) {
  const verifiedTrue = state.claimsVerifiedTrue ?? 0;
  const verifiedFalse = state.claimsVerifiedFalse ?? 0;
  const claims = verifiedTrue + verifiedFalse + (state.claimsUnverifiable ?? 0);
  const reads = state.reads ?? 0;
  const edits = (state.edits ?? 0) + (state.writes ?? 0);
  const blocks = state.blocks ?? 0;

  const lines = [];
  if (claims > 0) {
    lines.push(`  Claims     : ${claims} made · ${verifiedTrue} verified · ${verifiedFalse} false`);
  }
  lines.push(`  Activity   : ${reads} reads · ${edits} edits · ${blocks} blocks`);
  if ((stats?.totalClaims ?? 0) > 0) {
    lines.push(`  Trust      : ${Math.round(stats.trustScore * 100)}%`);
  }
  lines.push("  Context compacted — session continues");

  return ["", ...headerBox("AgentLedger — Session Checkpoint"), ...lines, ""].join("\n");
}
