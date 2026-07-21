/**
 * Multi-ledger aggregation — the cross-project behavior the dashboard is built
 * on. Drives a real server against real project ledgers written with the real
 * LedgerWriter (so hash chains are genuine), a real registry file, and real
 * fs.watch. Nothing is mocked: the failure modes here — an event tagged with
 * the wrong project, a broken chain in one repo tainting another's badge, a
 * project registered mid-run never appearing — are all invisible to mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerWriter, registerProject } from "@agentledger/core";
import { createServer } from "../server.js";
import type { ServerHandle } from "../server.js";

let home: string;
let workspace: string;
let handle: ServerHandle | null = null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "al-multi-home-"));
  workspace = mkdtempSync(join(tmpdir(), "al-multi-ws-"));
  process.env["AGENTLEDGER_HOME"] = home;
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
  delete process.env["AGENTLEDGER_HOME"];
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function registryFile(): string {
  return join(home, "projects.json");
}

function get<T>(port: number, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
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

async function waitFor(cond: () => Promise<boolean>, timeout = 4000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timed out");
}

/**
 * Create a project with a valid, hash-chained ledger: a run that detects one
 * claim and verifies it. Returns the project root.
 */
async function seedProject(name: string, runId: string): Promise<string> {
  const root = join(workspace, name);
  const ledgerPath = join(root, ".agentledger", "ledger.jsonl");
  mkdirSync(join(root, ".agentledger"), { recursive: true });
  const writer = new LedgerWriter(ledgerPath);
  await writer.appendEvent({
    event_id: `${name}-created`,
    run_id: runId,
    timestamp: "2026-07-01T00:00:00.000Z",
    actor: "plugin:post-tool-use",
    event_type: "RUN_CREATED",
    payload: { goal: `work in ${name}`, run_mode: "observed" },
  });
  await writer.appendEvent({
    event_id: `${name}-claim`,
    run_id: runId,
    timestamp: "2026-07-01T00:01:00.000Z",
    actor: "plugin:stop",
    event_type: "CLAIM_VERIFIED",
    payload: { claim_text: "tests pass", claim_type: "test_claim" },
  });
  return root;
}

/** Write the registry file listing the given project roots. */
function writeRegistry(roots: { path: string; name: string }[]): void {
  mkdirSync(home, { recursive: true });
  const now = "2026-07-01T00:00:00.000Z";
  writeFileSync(
    registryFile(),
    JSON.stringify({
      version: 1,
      projects: roots.map((r) => ({ path: r.path, name: r.name, firstSeen: now, lastSeen: now })),
    }),
  );
}

interface ProjectRow {
  name: string;
  eventCount: number;
  sessionCount: number;
  chainValid: boolean;
}
interface EventRow {
  project: string;
  event_type: string;
  run_id: string;
}
interface RunRow {
  runId: string;
  project: string;
}

describe("multi-ledger aggregation", () => {
  it("tags every event with the project its ledger belongs to", async () => {
    // Arrange — two registered projects, each with its own run
    const alpha = await seedProject("alpha", "run-alpha");
    const beta = await seedProject("beta", "run-beta");
    writeRegistry([
      { path: alpha, name: "alpha" },
      { path: beta, name: "beta" },
    ]);

    // Act
    handle = await createServer({ port: 0, registryFile: registryFile() });
    const res = await get<{ data: EventRow[] }>(handle.port, "/api/events/history");

    // Assert — four events, correctly attributed
    const byProject = new Map<string, number>();
    for (const e of res.data) byProject.set(e.project, (byProject.get(e.project) ?? 0) + 1);
    expect(byProject.get("alpha")).toBe(2);
    expect(byProject.get("beta")).toBe(2);
    expect(res.data.find((e) => e.run_id === "run-alpha")!.project).toBe("alpha");
    expect(res.data.find((e) => e.run_id === "run-beta")!.project).toBe("beta");
  });

  it("serves runs from every project in one aggregate list", async () => {
    // Arrange
    const alpha = await seedProject("alpha", "run-alpha");
    const beta = await seedProject("beta", "run-beta");
    writeRegistry([
      { path: alpha, name: "alpha" },
      { path: beta, name: "beta" },
    ]);

    // Act
    handle = await createServer({ port: 0, registryFile: registryFile() });
    const res = await get<{ data: RunRow[] }>(handle.port, "/api/runs");

    // Assert — both runs present, each tagged with its project
    const runs = new Map(res.data.map((r) => [r.runId, r.project]));
    expect(runs.get("run-alpha")).toBe("alpha");
    expect(runs.get("run-beta")).toBe("beta");
  });

  it("reports chain validity per project", async () => {
    // Arrange — alpha valid; beta's chain tampered
    const alpha = await seedProject("alpha", "run-alpha");
    const beta = await seedProject("beta", "run-beta");
    appendFileSync(
      join(beta, ".agentledger", "ledger.jsonl"),
      JSON.stringify({
        event_id: "beta-tampered",
        run_id: "run-beta",
        timestamp: "2026-07-01T00:02:00.000Z",
        actor: "attacker",
        event_type: "CLAIM_VERIFIED",
        payload: { claim_text: "forged" },
        hash: "deadbeef",
        previous_hash: "not-the-real-previous-hash",
      }) + "\n",
    );
    writeRegistry([
      { path: alpha, name: "alpha" },
      { path: beta, name: "beta" },
    ]);

    // Act
    handle = await createServer({ port: 0, registryFile: registryFile() });
    const res = await get<{ data: ProjectRow[] }>(handle.port, "/api/projects");

    // Assert — the broken chain is isolated to beta
    const byName = new Map(res.data.map((p) => [p.name, p]));
    expect(byName.get("alpha")!.chainValid).toBe(true);
    expect(byName.get("beta")!.chainValid).toBe(false);
    expect(byName.get("alpha")!.sessionCount).toBe(1);
  });

  it("picks up a project registered after the server started", async () => {
    // Arrange — server boots knowing only alpha
    const alpha = await seedProject("alpha", "run-alpha");
    writeRegistry([{ path: alpha, name: "alpha" }]);
    handle = await createServer({ port: 0, registryFile: registryFile() });

    // Act — a new project registers mid-run, exactly as a fresh SessionStart would
    const gamma = await seedProject("gamma", "run-gamma");
    await registerProject(gamma);

    // Assert — the running server notices without a restart
    await waitFor(async () => {
      const res = await get<{ data: ProjectRow[] }>(handle!.port, "/api/projects");
      return res.data.some((p) => p.name === "gamma");
    });
    const res = await get<{ data: EventRow[] }>(handle.port, "/api/events/history");
    expect(res.data.some((e) => e.project === "gamma")).toBe(true);
  });
});
