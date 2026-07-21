import express from "express";
import cors from "cors";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { SSEManager } from "./services/sseManager.js";
import type { TaggedEvent, ProjectSummary } from "./services/ledgerRegistry.js";
import { createRunsRouter } from "./routes/runs.js";
import { createLeaderboardRouter } from "./routes/leaderboard.js";
import { createEventsRouter } from "./routes/events.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createWhoamiRouter } from "./routes/whoami.js";

export interface AppOptions {
  /** shared, mutable tagged event store — appended to by the ledger registry */
  eventStore: TaggedEvent[];
  sseManager: SSEManager;
  /** computes per-project summaries for the selector + chain badge */
  getProjectSummaries: () => Promise<ProjectSummary[]>;
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
 *
 * Routes read from the shared in-memory tagged store (every project's events),
 * not a single ledger file. Aggregate views (runs, leaderboard, events) span
 * all projects; the client filters the session list. Only /api/projects is
 * source-aware, for the selector and per-project chain badges.
 */
export function createApp(opts: AppOptions): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const getEvents = (): readonly TaggedEvent[] => opts.eventStore;

  // Health check — polled by server-manager.js
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/runs", createRunsRouter(getEvents));
  app.use("/api/leaderboard", createLeaderboardRouter(getEvents));
  app.use("/api/events", createEventsRouter(opts.sseManager, opts.eventStore));
  app.use("/api/projects", createProjectsRouter(opts.getProjectSummaries));
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
