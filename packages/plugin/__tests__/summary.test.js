import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildSessionSummary, formatSummary } from "../scripts/summary.js";

/** Default empty stats for test fixtures */
const emptyStats = {
  version: 1,
  totalClaims: 0, verifiedTrue: 0, verifiedFalse: 0, unverifiable: 0,
  trustScore: 0, totalBlocks: 0, totalWarnings: 0, sessionsTracked: 0,
  filesReadTotal: 0, filesEditedTotal: 0, readEditRatio: 0,
  recentFalseClaims: [], lastUpdated: new Date().toISOString(),
};

/** Stats with some claim history */
const statsWithClaims = {
  ...emptyStats,
  totalClaims: 47, verifiedTrue: 38, verifiedFalse: 9, trustScore: 0.808,
  totalBlocks: 3, sessionsTracked: 14,
};

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
  it("shows tracking starts now when no claims", () => {
    const out = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 0, stats: emptyStats });
    expect(out).toContain("tracking starts now");
  });

  it("shows dashboard URL when running, 'not running' when not", () => {
    const runningOut = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 0, stats: emptyStats, dashboardStatus: { running: true, port: 4242 } });
    expect(runningOut).toContain("localhost:4242");

    const stoppedOut = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 0, stats: emptyStats, dashboardStatus: { running: false, port: 4242 } });
    expect(stoppedOut).toContain("not running");

    // No dashboardStatus defaults to "not running"
    const defaultOut = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 0, stats: emptyStats });
    expect(defaultOut).toContain("not running");
  });

  it("includes chain integrity indicator", () => {
    const validOut = formatSummary({ chainValid: true, recentRuns: [], totalEvents: 5, stats: emptyStats });
    expect(validOut).toContain("valid");

    const brokenOut = formatSummary({ chainValid: false, recentRuns: [], totalEvents: 5, stats: emptyStats });
    expect(brokenOut).toContain("BROKEN");
  });

  it("shows trust score percentage when claims exist", () => {
    const out = formatSummary({
      chainValid: true,
      recentRuns: [],
      totalEvents: 10,
      stats: statsWithClaims,
    });
    expect(out).toContain("81%");
    expect(out).toContain("claims true");
  });

  it("shows lies caught count", () => {
    const out = formatSummary({
      chainValid: true,
      recentRuns: [],
      totalEvents: 10,
      stats: statsWithClaims,
    });
    expect(out).toContain("9");
    expect(out).toContain("false claims");
  });

  it("shows writes blocked count", () => {
    const out = formatSummary({
      chainValid: true,
      recentRuns: [],
      totalEvents: 10,
      stats: statsWithClaims,
    });
    expect(out).toContain("3");
    expect(out).toContain("protected file");
  });

  it("shows sessions tracked", () => {
    const out = formatSummary({
      chainValid: true,
      recentRuns: [],
      totalEvents: 10,
      stats: statsWithClaims,
    });
    expect(out).toContain("14");
    expect(out).toContain("tracked");
  });
});
