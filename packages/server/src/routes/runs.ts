import { Router } from "express";
import { replayLedger, RunReplayError, generateHandoffBrief } from "@agentledger/core";
import type { TaggedEvent } from "../services/ledgerRegistry.js";

/**
 * Runs are replayed from the in-memory tagged event store rather than re-read
 * from a single ledger file — the store already holds every project's events,
 * each carrying the `project` it came from. Each run is tagged with its project
 * so the UI can group and filter without a second lookup.
 *
 * @param getEvents snapshot accessor for the shared tagged store
 */
export function createRunsRouter(getEvents: () => readonly TaggedEvent[]): Router {
  const router = Router();

  /** run_id → project, taken from the first event seen for that run. */
  function projectByRun(events: readonly TaggedEvent[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const e of events) {
      if (!map.has(e.run_id)) map.set(e.run_id, e.project);
    }
    return map;
  }

  router.get("/", (_req, res) => {
    try {
      const events = getEvents();
      const projects = projectByRun(events);
      const runIds = [
        ...new Set(
          events.filter((e) => e.event_type === "RUN_CREATED").map((e) => e.run_id),
        ),
      ];
      const runs = runIds.flatMap((runId) => {
        const project = projects.get(runId);
        try {
          return [{ ...replayLedger(events, runId), project }];
        } catch (err) {
          if (err instanceof RunReplayError) {
            // Bad ledger data (e.g. wrong terminal event). Return a minimal
            // degraded state so the UI can still render the run.
            const created = events.find(
              (e) => e.run_id === runId && e.event_type === "RUN_CREATED",
            );
            return [
              {
                runId,
                status: "failed" as const,
                goal:
                  typeof created?.payload["goal"] === "string"
                    ? created.payload["goal"]
                    : "",
                tasks: [],
                filesModified: [],
                startedAt: created?.timestamp,
                completedAt: undefined,
                project,
              },
            ];
          }
          return [];
        }
      });
      res.json({ success: true, data: runs });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.get("/:runId/handoff", (req, res) => {
    try {
      const events = getEvents();
      const runId = req.params["runId"] ?? "";
      const brief = generateHandoffBrief(events, runId);
      res.json({ success: true, data: brief });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.get("/:runId", (req, res) => {
    try {
      const events = getEvents();
      const runId = req.params["runId"] ?? "";
      const project = projectByRun(events).get(runId);
      const runState = replayLedger(events, runId);
      res.json({ success: true, data: { ...runState, project } });
    } catch (err) {
      if (err instanceof RunReplayError) {
        res.status(422).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  return router;
}
