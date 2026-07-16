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
import { randomUUID } from "crypto";
import { minimatch } from "minimatch";
import { readSessionState, writeSessionState } from "../state.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const configPath = path.join(projectDir, ".agentledger", "config.json");
const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");

/** @returns {{ blockedFiles: string[], warnFiles: string[] }} */
function loadPatterns() {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    return {
      blockedFiles: Array.isArray(config.blockedFiles) ? config.blockedFiles : [],
      warnFiles: Array.isArray(config.warnFiles) ? config.warnFiles : [],
    };
  } catch {
    return {
      blockedFiles: ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
      warnFiles: ["**/migrations/**", "**/auth/**", "package.json", "**/middleware.*"],
    };
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

/** @returns {string} */
function loadOperator() {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    return config.operator || process.env["USER"] || "unknown";
  } catch {
    return process.env["USER"] ?? "unknown";
  }
}

/**
 * Initialize a new observed run — writes RUN_CREATED + INTENT_COMPILED events.
 * Same pattern as post-tool-use.js lazy init.
 *
 * @param {string} runId
 * @returns {Promise<void>}
 */
async function initRun(runId) {
  const { LedgerWriter } = await import("@agentledger/core");
  const writer = new LedgerWriter(ledgerPath);
  const operator = loadOperator();

  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });

  await writer.appendEvent({
    event_id: `evt_${Date.now()}_run_created`,
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "plugin:pre-tool-use",
    event_type: "RUN_CREATED",
    payload: {
      goal: "Observed Claude Code session",
      operator,
      run_mode: "observed",
    },
  });

  await writer.appendEvent({
    event_id: `evt_${Date.now()}_intent`,
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "plugin:pre-tool-use",
    event_type: "INTENT_COMPILED",
    payload: {
      goal: "Observed Claude Code session",
      taskCount: 0,
      tasks: [],
    },
  });
}

/**
 * Append a TOOL_DENIED event to the ledger.
 * If no run is active, lazy-inits one first (same as post-tool-use).
 * LedgerWriter computes hash/previous_hash internally — do not pass them.
 *
 * @param {string} filePath
 * @param {string} matchedPattern
 * @param {string} toolName
 */
async function emitDenied(filePath, matchedPattern, toolName) {
  let state = await readSessionState();

  // Lazy run init if no active run
  if (!state.runId) {
    const runId = randomUUID();
    await initRun(runId);
    state = { ...state, runId, dirty: true };
    await writeSessionState(state);
  }

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

  const { blockedFiles, warnFiles } = loadPatterns();

  // Check blocked first — hard block
  const blockedMatch = matchesBlocked(filePath, blockedFiles);
  if (blockedMatch) {
    const reason = `[AgentLedger] Write to "${path.basename(filePath)}" blocked — matches protected pattern "${blockedMatch}"`;

    // Emit denial to ledger (lazy-inits run if needed)
    await emitDenied(filePath, blockedMatch, toolName);

    // Increment blocks counter in session state
    try {
      const currentState = await readSessionState();
      await writeSessionState({ ...currentState, blocks: (currentState.blocks ?? 0) + 1 });
    } catch {
      // Non-fatal — block still happens
    }

    // Exit code 2 = block; reason on stderr for Claude Code
    process.stderr.write(reason + "\n");
    process.exit(2);
  }

  // Check warn — soft warning, still allows
  const warnMatch = matchesBlocked(filePath, warnFiles);
  if (warnMatch) {
    process.stderr.write(
      `⚠ AgentLedger: editing ${path.basename(filePath)} — flagged sensitive (${warnMatch})\n`
    );

    // Emit TOOL_WARNED to ledger
    try {
      let state = await readSessionState();
      if (!state.runId) {
        const runId = randomUUID();
        await initRun(runId);
        state = { ...state, runId, dirty: true };
      }
      await writeSessionState({ ...state, warnings: (state.warnings ?? 0) + 1 });

      const { LedgerWriter } = await import("@agentledger/core");
      const writer = new LedgerWriter(ledgerPath);
      await writer.appendEvent({
        event_id: `evt_${Date.now()}_warned`,
        run_id: state.runId,
        timestamp: new Date().toISOString(),
        actor: "plugin:pre-tool-use",
        event_type: "TOOL_WARNED",
        payload: {
          tool: toolName,
          file_path: filePath,
          matched_pattern: warnMatch,
        },
      });
    } catch {
      // Non-fatal — warning still shown
    }
  }

  // Allow the tool call
  process.exit(0);
}

main().catch((err) => {
  console.error("[agentledger] pre-tool-use error:", err?.message);
  process.exit(0); // Never block Claude Code on plugin error
});
