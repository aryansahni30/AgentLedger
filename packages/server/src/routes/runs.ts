import { Router } from "express";
import { LedgerReader, replayLedger, RunReplayError, generateHandoffBrief } from "@agentledger/core";

export function createRunsRouter(reader: LedgerReader): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const events = await reader.readAll();
      const runIds = [
        ...new Set(
          events
            .filter((e) => e.event_type === "RUN_CREATED")
            .map((e) => e.run_id),
        ),
      ];
      const runs = runIds.flatMap((runId) => {
        try {
          return [replayLedger(events, runId)];
        } catch (err) {
          if (err instanceof RunReplayError) {
            // Bad ledger data (e.g. orchestrator bug wrote wrong terminal event).
            // Return a minimal degraded state so the UI can still render the run.
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

  router.get("/:runId/handoff", async (req, res) => {
    try {
      const events = await reader.readAll();
      const runId = req.params["runId"] ?? "";
      const brief = generateHandoffBrief(events, runId);
      res.json({ success: true, data: brief });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  router.get("/:runId", async (req, res) => {
    try {
      const events = await reader.readAll();
      const runId = req.params["runId"] ?? "";
      const runState = replayLedger(events, runId);
      res.json({ success: true, data: runState });
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
