/**
 * Lazy run initialization, shared by every hook that may be the first to
 * observe work in a session.
 *
 * Any hook can be the one to discover that a session has become worth
 * recording: pre-tool-use when it denies a write, post-tool-use on a first
 * edit, stop when it catches a claim. Each one previously carried its own copy
 * of this logic, and the copies drifted — stop.js had none at all, so a claim
 * made in a session that never edited a file had no run_id to attach to and was
 * dropped on the floor.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const RUN_GOAL = "Observed Claude Code session";

/** @returns {string} */
function projectDir() {
  return process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
}

/** @returns {string} */
function ledgerPath() {
  return path.join(projectDir(), ".agentledger", "ledger.jsonl");
}

/** @returns {string} */
function loadOperator() {
  try {
    const raw = fs.readFileSync(path.join(projectDir(), ".agentledger", "config.json"), "utf8");
    return JSON.parse(raw).operator || process.env["USER"] || "unknown";
  } catch {
    return process.env["USER"] ?? "unknown";
  }
}

/**
 * Write RUN_CREATED + INTENT_COMPILED for a new observed run.
 *
 * LedgerWriter computes hash/previous_hash internally — never pass them here.
 *
 * @param {string} runId
 * @param {string} actor — the hook that discovered the run, e.g. "plugin:stop"
 * @returns {Promise<void>}
 */
async function initRun(runId, actor) {
  const { LedgerWriter } = await import("@agentledger/core");
  const target = ledgerPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const writer = new LedgerWriter(target);
  const timestamp = new Date().toISOString();

  await writer.appendEvent({
    event_id: `evt_${Date.now()}_run_created`,
    run_id: runId,
    timestamp,
    actor,
    event_type: "RUN_CREATED",
    payload: { goal: RUN_GOAL, operator: loadOperator(), run_mode: "observed" },
  });

  await writer.appendEvent({
    event_id: `evt_${Date.now()}_intent`,
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor,
    event_type: "INTENT_COMPILED",
    payload: { goal: RUN_GOAL, taskCount: 0, tasks: [] },
  });
}

/**
 * Return state with an active run guaranteed, creating one if absent.
 * Callers own the decision of *whether* a run is warranted; this owns the how.
 *
 * @param {import("./state.js").SessionState} state
 * @param {string} actor
 * @returns {Promise<import("./state.js").SessionState>} new state — never mutated in place
 */
export async function ensureRun(state, actor) {
  if (state.runId) return state;

  const runId = randomUUID();
  await initRun(runId, actor);
  return { ...state, runId, dirty: true };
}
