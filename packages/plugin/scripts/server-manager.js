/**
 * Ensures the AgentLedger dashboard server (port 4242) is running.
 *
 * Strategy:
 *   1. GET localhost:4242/health
 *   2. If already up → return
 *   3. If not → spawn server detached, wait up to 2s for it to respond
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const SERVER_PORT = 4242;
const HEALTH_URL = `http://localhost:${SERVER_PORT}/health`;
const MAX_WAIT_MS = 2000;
const POLL_INTERVAL_MS = 100;

/**
 * Returns true if the server is currently responding on port 4242.
 * @returns {Promise<boolean>}
 */
async function isServerRunning() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Spawns the server package in detached mode and waits up to MAX_WAIT_MS for it to respond.
 * @returns {Promise<void>}
 */
async function spawnServer() {
  // Resolve path to @agentledger/server dist relative to this file
  const pluginDir = path.dirname(fileURLToPath(import.meta.url));
  const serverMain = path.join(
    pluginDir,
    "..",
    "..",
    "server",
    "dist",
    "main.js"
  );

  const child = spawn("node", [serverMain], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  // Wait up to MAX_WAIT_MS for server to respond
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (await isServerRunning()) return;
  }

  // Non-fatal: server might not be built yet — plugin continues without dashboard
  console.error(
    "[agentledger] Warning: dashboard server did not start within 2s (is it built?)"
  );
}

/**
 * Ensures the AgentLedger server is running, starting it if necessary.
 * Never throws — dashboard is optional.
 * @returns {Promise<void>}
 */
export async function ensureServerRunning() {
  try {
    if (await isServerRunning()) return;
    await spawnServer();
  } catch (err) {
    console.error("[agentledger] Warning: could not start server:", err?.message);
  }
}
