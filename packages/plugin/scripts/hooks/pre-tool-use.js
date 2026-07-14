#!/usr/bin/env node
/**
 * PreToolUse hook — Layer 1 boundary enforcement.
 *
 * Runs BEFORE Edit and Write tool calls.
 * Checks the target file path against blockedFiles patterns from config.json.
 * If matched: emits a TOOL_DENIED ledger event and exits with a JSON block
 * that Claude Code interprets as a hook block.
 *
 * Hook input arrives on stdin as JSON:
 *   { tool_name: string, tool_input: { file_path?: string, ... }, ... }
 *
 * Block output (stdout, JSON):
 *   { "decision": "block", "reason": "..." }
 *
 * Allow output: exit 0 with no stdout (or any non-block JSON).
 */

import fs from "fs";
import path from "path";
import { minimatch } from "minimatch";
import { readSessionState } from "../state.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const configPath = path.join(projectDir, ".agentledger", "config.json");
const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");

/** @returns {string[]} */
function loadBlockedPatterns() {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    return Array.isArray(config.blockedFiles) ? config.blockedFiles : [];
  } catch {
    return ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"];
  }
}

/**
 * Check if a file path matches any blocked pattern.
 * Paths are relative to projectDir for matching.
 *
 * @param {string} filePath - absolute or relative file path
 * @param {string[]} patterns
 * @returns {string | null} matched pattern or null
 */
function matchesBlocked(filePath, patterns) {
  const rel = path.isAbsolute(filePath)
    ? path.relative(projectDir, filePath)
    : filePath;

  for (const pattern of patterns) {
    if (minimatch(rel, pattern, { dot: true })) {
      return pattern;
    }
    // Also match basename alone (e.g. ".env" against "**/.env")
    if (minimatch(path.basename(filePath), pattern.replace(/\*\*\//, ""), { dot: true })) {
      return pattern;
    }
  }
  return null;
}

/**
 * Append a TOOL_DENIED event to the ledger if a run is active.
 * LedgerWriter computes hash/previous_hash internally — do not pass them.
 *
 * @param {string} filePath
 * @param {string} matchedPattern
 * @param {string} toolName
 */
async function emitDenied(filePath, matchedPattern, toolName) {
  const state = await readSessionState();
  if (!state.runId) return; // No active run — skip ledger write

  try {
    const { LedgerWriter } = await import("@agentledger/core");

    const writer = new LedgerWriter(ledgerPath);
    await writer.appendEvent({
      event_id: `evt_${Date.now()}_denied`,
      run_id: state.runId,
      timestamp: new Date().toISOString(),
      actor: "plugin:pre-tool-use",
      event_type: "TOOL_DENIED",
      payload: {
        tool: toolName,
        file_path: filePath,
        matched_pattern: matchedPattern,
        decision: "denied",
      },
    });
  } catch (err) {
    // Non-fatal — denial still happens even if ledger write fails
    console.error("[agentledger] Warning: could not write TOOL_DENIED event:", err?.message);
  }
}

async function main() {
  // Read hook input from stdin
  let input;
  try {
    const raw = fs.readFileSync("/dev/stdin", "utf8");
    input = JSON.parse(raw);
  } catch {
    // Malformed input — allow the tool call to proceed
    process.exit(0);
  }

  const toolName = input?.tool_name ?? "";
  const filePath = input?.tool_input?.file_path ?? "";

  if (!filePath) {
    process.exit(0); // No file path — allow
  }

  const patterns = loadBlockedPatterns();
  const matched = matchesBlocked(filePath, patterns);

  if (!matched) {
    process.exit(0); // Not blocked — allow
  }

  // Block the write
  const reason = `[AgentLedger] Write to "${path.basename(filePath)}" blocked — matches protected pattern "${matched}"`;

  // Emit denial to ledger (best-effort)
  await emitDenied(filePath, matched, toolName);

  // Output block decision for Claude Code
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

main().catch((err) => {
  console.error("[agentledger] pre-tool-use error:", err?.message);
  process.exit(0); // Never block Claude Code on plugin error
});
