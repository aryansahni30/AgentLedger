/**
 * Ensures the AgentLedger dashboard server is running.
 *
 * Strategy:
 *   1. Read port from config (default 4242)
 *   2. GET localhost:{port}/health
 *   3. If already up → return { running: true, port }
 *   4. If not → attempt spawn, wait up to 2s
 *   5. Return { running: bool, port }
 *
 * Never throws — dashboard is optional.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const DEFAULT_PORT = 4242;
const MAX_WAIT_MS = 2000;
const POLL_INTERVAL_MS = 100;

/**
 * Read dashboard port from config.json.
 * @returns {number}
 */
function getPort() {
  try {
    const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
    const configPath = path.join(projectDir, ".agentledger", "config.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    return typeof config.dashboardPort === "number" ? config.dashboardPort : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * Returns true if the server is currently responding.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function isServerRunning(port) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Attempt to find and spawn the server.
 * Looks for bundled server first, then monorepo path.
 * @param {number} port
 * @returns {Promise<boolean>} whether server started
 */
async function spawnServer(port) {
  // Try multiple server locations
  const candidates = [];

  // 1. Bundled server in dist/ (standalone install)
  const pluginDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  candidates.push(path.join(pluginDir, "..", "dist", "server.cjs"));

  // 2. Monorepo path (dev mode)
  candidates.push(path.join(pluginDir, "..", "..", "server", "dist", "main.js"));

  const serverMain = candidates.find((c) => fs.existsSync(c));
  if (!serverMain) {
    // No server binary available — degrade gracefully
    return false;
  }

  const child = spawn("node", [serverMain], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AGENTLEDGER_PORT: String(port) },
  });
  child.unref();

  // Wait up to MAX_WAIT_MS for server to respond
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (await isServerRunning(port)) return true;
  }

  return false;
}

/**
 * Ensures the AgentLedger server is running, starting it if necessary.
 * Never throws — dashboard is optional.
 * @returns {Promise<{ running: boolean, port: number }>}
 */
export async function ensureServerRunning() {
  const port = getPort();
  try {
    if (await isServerRunning(port)) return { running: true, port };
    const started = await spawnServer(port);
    return { running: started, port };
  } catch {
    return { running: false, port };
  }
}
