import express from "express";
import cors from "cors";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { LedgerReader } from "@agentledger/core";
import type { LedgerEvent } from "@agentledger/core";
import { SSEManager } from "./services/sseManager.js";
import { createRunsRouter } from "./routes/runs.js";
import { createLeaderboardRouter } from "./routes/leaderboard.js";
import { createEventsRouter } from "./routes/events.js";
import { createWhoamiRouter } from "./routes/whoami.js";

export interface AppOptions {
  ledgerDir: string;
  eventStore: LedgerEvent[];
  sseManager: SSEManager;
}

// Resolve visualizer dist relative to this compiled file (packages/server/dist/index.js)
const VISUALIZER_DIST = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "visualizer",
  "dist",
);

/**
 * Factory that wires up the Express application. Separated from createServer
 * so it can be tested without spinning up an http.Server.
 */
export function createApp(opts: AppOptions): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const ledgerPath = join(opts.ledgerDir, "ledger.jsonl");
  const reader = new LedgerReader(ledgerPath);

  // Health check — polled by server-manager.js
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/runs", createRunsRouter(reader));
  app.use("/api/leaderboard", createLeaderboardRouter(reader));
  app.use("/api/events", createEventsRouter(opts.sseManager, opts.eventStore));
  app.use("/api/whoami", createWhoamiRouter());

  // Serve React frontend if built
  if (existsSync(VISUALIZER_DIST)) {
    app.use(express.static(VISUALIZER_DIST));
    // SPA fallback — all non-API routes return index.html
    app.get("*", (_req, res) => {
      res.sendFile(join(VISUALIZER_DIST, "index.html"));
    });
  }

  return app;
}
