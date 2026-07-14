import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import type { ServerHandle } from "../server.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

interface StatsResponse {
  clientCount: number;
  eventCount: number;
}

function getStats(port: number): Promise<StatsResponse> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${port}/api/events/stats`, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as StatsResponse);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timed out");
}

interface SSEConnection {
  events: string[];
  close: () => void;
}

function connectSSE(port: number, path = "/api/events"): SSEConnection {
  const events: string[] = [];
  let destroyed = false;

  const req = http.request({ host: "localhost", port, path }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          events.push(line.slice(6));
        }
      }
    });
  });
  req.on("error", () => {
    /* ignore destroy-triggered errors */
  });
  req.end();

  return {
    events,
    close: () => {
      if (!destroyed) {
        destroyed = true;
        req.destroy();
      }
    },
  };
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const SEED_EVENT = JSON.stringify({
  event_id: "ev-sse-1",
  run_id: "run-sse-1",
  timestamp: "2024-01-01T00:00:00.000Z",
  actor: "orchestrator",
  event_type: "RUN_CREATED",
  payload: { goal: "sse integration test" },
  hash: "aaaa1111",
  previous_hash: "00000000",
});

const NEW_EVENT = JSON.stringify({
  event_id: "ev-sse-2",
  run_id: "run-sse-1",
  timestamp: "2024-01-01T00:01:00.000Z",
  actor: "orchestrator",
  event_type: "RUN_COMPLETED",
  payload: {},
  hash: "bbbb2222",
  previous_hash: "aaaa1111",
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("SSE integration", () => {
  let handle: ServerHandle;
  let ledgerPath: string;

  beforeAll(async () => {
    const ledgerDir = join(tmpdir(), `al-sse-${Date.now()}`);
    mkdirSync(ledgerDir, { recursive: true });
    ledgerPath = join(ledgerDir, "ledger.jsonl");
    writeFileSync(ledgerPath, SEED_EVENT + "\n", "utf8");
    handle = await createServer({ ledgerDir, port: 0 });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("client receives replayed events on connect", async () => {
    const conn = connectSSE(handle.port);

    await waitFor(() => conn.events.length >= 1);
    conn.close();

    expect(conn.events.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(conn.events[0]!) as { event_id: string };
    expect(parsed.event_id).toBe("ev-sse-1");
  });

  it("client receives new events after ledger.jsonl append", async () => {
    const conn = connectSSE(handle.port);

    // Wait for the replayed seed event
    await waitFor(() => conn.events.length >= 1);

    // Append a new event to the ledger file
    appendFileSync(ledgerPath, NEW_EVENT + "\n", "utf8");

    await waitFor(() => conn.events.length >= 2);
    conn.close();

    const last = JSON.parse(conn.events[conn.events.length - 1]!) as {
      event_id: string;
    };
    expect(last.event_id).toBe("ev-sse-2");
  });

  it("disconnected client is removed from SSEManager registry", async () => {
    const before = await getStats(handle.port);

    const conn = connectSSE(handle.port);

    // Wait until the server registers the client
    await waitFor(async () => {
      const s = await getStats(handle.port);
      return s.clientCount > before.clientCount;
    });

    // Disconnect
    conn.close();

    // Wait until the server deregisters the client
    await waitFor(async () => {
      const s = await getStats(handle.port);
      return s.clientCount === before.clientCount;
    });

    // If waitFor resolved without timing out, registry was cleaned up
    const after = await getStats(handle.port);
    expect(after.clientCount).toBe(before.clientCount);
  });
});
