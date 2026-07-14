/**
 * Standalone entry point for the AgentLedger dashboard server.
 * Spawned by packages/plugin/scripts/server-manager.js as a detached process.
 *
 * Reads ledger location from CLAUDE_PROJECT_DIR env var.
 * Starts on port 4242 (fixed — server-manager polls this exact port).
 */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createServer } from "./server.js";

const PORT = 4242;
const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const ledgerDir = join(projectDir, ".agentledger");

// Ensure ledger dir exists (session-start normally creates it, but be safe)
mkdirSync(ledgerDir, { recursive: true });

const handle = await createServer({ ledgerDir, port: PORT });

process.on("SIGINT", async () => {
  await handle.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await handle.close();
  process.exit(0);
});
