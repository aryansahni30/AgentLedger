import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildSessionSummary, formatSummary } from "../scripts/summary.js";

/** Build a minimal valid ledger event JSON line */
function makeLine(overrides = {}) {
  return JSON.stringify({
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    run_id: "run-001",
    timestamp: new Date().toISOString(),
    actor: "plugin:test",
    event_type: "RUN_CREATED",
    payload: { goal: "test", run_mode: "observed" },
    hash: "aabbcc",
    previous_hash: "genesis",
    ...overrides,
  });
}

describe("summary.js — buildSessionSummary", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-summary-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty summary when ledger.jsonl missing", async () => {
    const summary = await buildSessionSummary(tmpDir);
    expect(summary.totalEvents).toBe(0);
    expect(summary.recentRuns).toEqual([]);
    expect(summary.chainValid).toBe(true);
  });

  it("returns empty summary when ledger.jsonl is empty", async () => {
    const agDir = join(tmpDir, ".agentledger");
    await mkdir(agDir, { recursive: true });
    await writeFile(join(agDir, "ledger.jsonl"), "");

    const summary = await buildSessionSummary(tmpDir);
    expect(summary.totalEvents).toBe(0);
    expect(summary.recentRuns).toEqual([]);
  });

  it("counts events when ledger has entries", async () => {
    const agDir = join(tmpDir, ".agentledger");
    await mkdir(agDir, { recursive: true });
    await writeFile(
      join(agDir, "ledger.jsonl"),
      [makeLine(), makeLine({ event_type: "INTENT_COMPILED", payload: { goal: "test", taskCount: 0, tasks: [] } })].join("\n") + "\n"
    );

    const summary = await buildSessionSummary(tmpDir);
    expect(summary.totalEvents).toBe(2);
  });
});

describe("summary.js — formatSummary", () => {
  it("includes 'none' when no runs", () => {
    const out = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 0 });
    expect(out).toContain("none");
  });

  it("includes dashboard URL always", () => {
    const out = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 0 });
    expect(out).toContain("localhost:4242");
  });

  it("includes chain integrity indicator", () => {
    const validOut = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 5 });
    expect(validOut).toContain("valid");

    const brokenOut = formatSummary({ chainValid: false, recentRuns: [], totalEvents: 5 });
    expect(brokenOut).toContain("BROKEN");
  });

  it("shows run ID prefix and status for recent runs", () => {
    const out = formatSummary({
      chainValid: true,
      recentRuns: [{ runId: "abcdef123456", status: "completed", taskCount: 2, completedCount: 2 }],
      totalEvents: 10,
    });
    expect(out).toContain("abcdef12");
    expect(out).toContain("completed");
  });
});
