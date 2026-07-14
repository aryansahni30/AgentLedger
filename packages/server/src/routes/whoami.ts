import { Router } from "express";

export function createWhoamiRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const user = process.env["USER"] ?? process.env["USERNAME"] ?? "unknown";
    res.json({ success: true, data: { user } });
  });

  return router;
}
