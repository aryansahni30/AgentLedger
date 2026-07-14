import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { LedgerEvent } from "@agentledger/core";
import type { SSEManager } from "../services/sseManager.js";

export function createEventsRouter(
  sseManager: SSEManager,
  eventStore: LedgerEvent[],
): Router {
  const router = Router();

  // SSE stream — replays history then holds connection open for new events
  router.get("/", (req, res) => {
    const id = randomUUID();
    const sinceEventId =
      typeof req.query["sinceEventId"] === "string"
        ? req.query["sinceEventId"]
        : undefined;

    sseManager.addClient(id, res, sinceEventId);

    req.on("close", () => {
      sseManager.removeClient(id);
    });
  });

  // Stats — used by integration tests to inspect SSEManager state
  router.get("/stats", (_req, res) => {
    res.json({
      clientCount: sseManager.clientCount,
      eventCount: eventStore.length,
    });
  });

  return router;
}
