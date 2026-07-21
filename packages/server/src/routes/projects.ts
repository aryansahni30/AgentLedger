import { Router } from "express";
import type { ProjectSummary } from "../services/ledgerRegistry.js";

/**
 * Lists the tracked projects for the top-nav selector, each with its event and
 * session counts and its own chain-integrity verdict. Chains are per-repo and
 * cannot be merged, so the cross-project chain badge is a roll-up of these —
 * valid only when every project verifies.
 *
 * @param getSummaries computes summaries against the live source list + store
 */
export function createProjectsRouter(
  getSummaries: () => Promise<ProjectSummary[]>,
): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const projects = await getSummaries();
      // Stable, human-friendly order; most-recently-active first.
      projects.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
      res.json({ success: true, data: projects });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  return router;
}
