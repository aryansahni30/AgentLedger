import { Router } from "express";
import { LedgerReader, buildLeaderboard } from "@agentledger/core";

export function createLeaderboardRouter(reader: LedgerReader): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const events = await reader.readAll();
      const lb = buildLeaderboard(events);
      res.json({ success: true, data: lb });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  return router;
}
