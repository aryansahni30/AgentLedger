import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import type { ServerHandle } from "../server.js";

// ─── helper ───────────────────────────────────────────────────────────────────

function get<T>(port: number, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${port}${path}`, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const SEED_EVENTS = [
  {
    event_id: "ev-r1",
    run_id: "run-routes-1",
    timestamp: "2024-06-01T00:00:00.000Z",
    actor: "orchestrator",
    event_type: "RUN_CREATED",
    payload: { goal: "routes integration test" },
    hash: "h001",
    previous_hash: "0000",
  },
];

// ─── tests ────────────────────────────────────────────────────────────────────

describe("REST routes integration", () => {
  let handle: ServerHandle;

  beforeAll(async () => {
    const ledgerDir = join(tmpdir(), `al-routes-${Date.now()}`);
    mkdirSync(ledgerDir, { recursive: true });
    const ledgerPath = join(ledgerDir, "ledger.jsonl");
    writeFileSync(
      ledgerPath,
      SEED_EVENTS.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    );
    // Isolate from the real ~/.agentledger registry so only the seeded ledger is watched.
    handle = await createServer({ ledgerDir, port: 0, registryFile: join(ledgerDir, "no-registry.json") });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("GET /api/runs returns all run states", async () => {
    const res = await get<{ success: boolean; data: unknown[] }>(
      handle.port,
      "/api/runs",
    );
    expect(res.success).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/runs/:runId returns specific run state", async () => {
    const res = await get<{
      success: boolean;
      data: { runId: string; goal: string; status: string };
    }>(handle.port, "/api/runs/run-routes-1");
    expect(res.success).toBe(true);
    expect(res.data.runId).toBe("run-routes-1");
    expect(res.data.goal).toBe("routes integration test");
    expect(res.data.status).toBe("created");
  });

  it("GET /api/leaderboard returns leaderboard structure", async () => {
    const res = await get<{
      success: boolean;
      data: { entries: unknown[]; generatedAt: string };
    }>(handle.port, "/api/leaderboard");
    expect(res.success).toBe(true);
    expect(Array.isArray(res.data.entries)).toBe(true);
    expect(typeof res.data.generatedAt).toBe("string");
  });

  it("GET /api/events/stats returns clientCount and eventCount", async () => {
    const res = await get<{ clientCount: number; eventCount: number }>(
      handle.port,
      "/api/events/stats",
    );
    expect(typeof res.clientCount).toBe("number");
    expect(typeof res.eventCount).toBe("number");
    expect(res.eventCount).toBeGreaterThanOrEqual(1);
  });
});
