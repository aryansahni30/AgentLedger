import { Router } from "express";
import { buildLeaderboard } from "@agentledger/core";
import type { TaggedEvent } from "../services/ledgerRegistry.js";

/**
 * The leaderboard is cross-project by definition — it answers "how much do I
 * trust my agents overall" — so it consumes the full tagged store, never a
 * per-project slice.
 *
 * @param getEvents snapshot accessor for the shared tagged store
 */
export function createLeaderboardRouter(getEvents: () => readonly TaggedEvent[]): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      // buildLeaderboard takes a mutable array; hand it a shallow copy rather
      // than casting away the store's readonly guarantee.
      const lb = buildLeaderboard(Array.from(getEvents()));
      res.json({ success: true, data: lb });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  return router;
}
