#!/usr/bin/env node
/**
 * PostToolUse hook — event recorder + lazy run initialization.
 *
 * Runs AFTER Edit, Write, and Bash tool calls.
 *
 * On the FIRST Edit or Write in a session:
 *   - Creates a run: emits RUN_CREATED (run_mode: "observed") + INTENT_COMPILED
 *   - Then emits TOOL_CALLED for this event
 *
 * On subsequent Edit/Write/Bash calls:
 *   - Emits TOOL_CALLED only
 *
 * LedgerWriter.appendEvent computes hash/previous_hash internally —
 * never pass those fields here.
 *
 * Hook input arrives on stdin as JSON:
 *   {
 *     tool_name: string,
 *     tool_input: { file_path?: string, command?: string, ... },
 *     tool_response: unknown,
 *     ...
 *   }
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { readSessionState, writeSessionState } from "../state.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");
const configPath = path.join(projectDir, ".agentledger", "config.json");

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
 * Returns the new runId.
 *
 * @param {string} runId
 * @returns {Promise<void>}
 */
async function initRun(runId) {
  const { LedgerWriter } = await import("@agentledger/core");
  const writer = new LedgerWriter(ledgerPath);
  const operator = loadOperator();

  // Ensure .agentledger dir exists
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });

  await writer.appendEvent({
    event_id: `evt_${Date.now()}_run_created`,
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "plugin:post-tool-use",
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
    actor: "plugin:post-tool-use",
    event_type: "INTENT_COMPILED",
    payload: {
      goal: "Observed Claude Code session",
      taskCount: 0,
      tasks: [],
    },
  });
}

async function main() {
  // Read hook input from stdin
  let input;
  try {
    const raw = fs.readFileSync("/dev/stdin", "utf8");
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = input?.tool_name ?? "";
  const toolInput = input?.tool_input ?? {};

  // Track Edit, Write, Bash, and Read
  const TRACKED_TOOLS = new Set(["Edit", "Write", "Bash", "Read"]);
  if (!TRACKED_TOOLS.has(toolName)) {
    process.exit(0);
  }

  let state = await readSessionState();

  // Lazy run init: first Edit or Write triggers run creation
  if (!state.runId && (toolName === "Edit" || toolName === "Write")) {
    const runId = randomUUID();
    await initRun(runId);
    state = { ...state, runId, dirty: true };
  }

  // Track file operations in session state
  const filePath = toolInput.file_path ?? "";
  let stateChanged = false;

  if (toolName === "Read" && filePath) {
    const filesRead = state.filesRead ?? [];
    if (!filesRead.includes(filePath)) {
      state = { ...state, filesRead: [...filesRead, filePath] };
      stateChanged = true;
    }
    state = { ...state, reads: (state.reads ?? 0) + 1 };
    stateChanged = true;
  }

  if ((toolName === "Edit" || toolName === "Write") && filePath) {
    const filesEdited = state.filesEdited ?? [];
    if (!filesEdited.includes(filePath)) {
      state = { ...state, filesEdited: [...filesEdited, filePath] };
      stateChanged = true;
    }
    // Detect edit-without-read
    const filesRead = state.filesRead ?? [];
    const editWithoutRead = state.editWithoutRead ?? [];
    if (!filesRead.includes(filePath) && !editWithoutRead.includes(filePath)) {
      state = { ...state, editWithoutRead: [...editWithoutRead, filePath] };
      process.stderr.write(`⚠ AgentLedger: ${toolName} on ${path.basename(filePath)} without reading it first\n`);
      stateChanged = true;
    }
    const key = toolName === "Edit" ? "edits" : "writes";
    state = { ...state, [key]: (state[key] ?? 0) + 1 };
    stateChanged = true;
  }

  if (toolName === "Bash") {
    state = { ...state, bashCalls: (state.bashCalls ?? 0) + 1 };
    stateChanged = true;
  }

  if (!state.dirty) {
    state = { ...state, dirty: true };
    stateChanged = true;
  }

  if (stateChanged) {
    await writeSessionState(state);
  }

  // No active run — skip ledger recording (Read-only sessions don't need a run)
  if (!state.runId) {
    process.exit(0);
  }

  // Build TOOL_CALLED payload
  const payload = {
    tool: toolName,
    ...(filePath ? { file_path: filePath } : {}),
    ...(toolInput.command ? { command: toolInput.command.slice(0, 200) } : {}),
    timestamp: new Date().toISOString(),
  };

  try {
    const { LedgerWriter } = await import("@agentledger/core");
    const writer = new LedgerWriter(ledgerPath);

    await writer.appendEvent({
      event_id: `evt_${Date.now()}_tool_called`,
      run_id: state.runId,
      timestamp: new Date().toISOString(),
      actor: "plugin:post-tool-use",
      event_type: "TOOL_CALLED",
      payload,
    });
  } catch (err) {
    console.error("[agentledger] Warning: could not write TOOL_CALLED event:", err?.message);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[agentledger] post-tool-use error:", err?.message);
  process.exit(0);
});
