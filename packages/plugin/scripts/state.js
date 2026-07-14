/**
 * Session state management for the AgentLedger plugin.
 *
 * State lives in {projectDir}/.agentledger/session.json
 * proper-lockfile is used for concurrent write safety.
 *
 * Shape: { runId: string | null, dirty: boolean, sessionStart: string }
 */

import fs from "fs";
import path from "path";
import lockfile from "proper-lockfile";

/** @returns {string} */
function sessionStatePath() {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  return path.join(projectDir, ".agentledger", "session.json");
}

/** @typedef {{ runId: string | null, dirty: boolean, sessionStart: string }} SessionState */

/** @returns {SessionState} */
const DEFAULT_STATE = () => ({
  runId: null,
  dirty: false,
  sessionStart: new Date().toISOString(),
});

/**
 * Read current session state, returning defaults if file absent.
 * @returns {Promise<SessionState>}
 */
export async function readSessionState() {
  const statePath = sessionStatePath();

  if (!fs.existsSync(statePath)) {
    return DEFAULT_STATE();
  }

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return DEFAULT_STATE();
  }
}

/**
 * Atomically write session state using a lockfile.
 * @param {SessionState} state
 * @returns {Promise<void>}
 */
export async function writeSessionState(state) {
  const statePath = sessionStatePath();
  const dir = path.dirname(statePath);

  fs.mkdirSync(dir, { recursive: true });

  // Ensure file exists so lockfile can lock it
  if (!fs.existsSync(statePath)) {
    fs.writeFileSync(statePath, JSON.stringify(DEFAULT_STATE(), null, 2));
  }

  let release;
  try {
    release = await lockfile.lock(statePath, { retries: { retries: 5, minTimeout: 50 } });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } finally {
    if (release) await release();
  }
}

/**
 * Clear session state (called at SessionEnd after finalization).
 * @returns {Promise<void>}
 */
export async function clearSessionState() {
  const statePath = sessionStatePath();
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}
