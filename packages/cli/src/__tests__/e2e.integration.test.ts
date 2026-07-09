/**
 * End-to-end integration tests for runRun() — the orchestrator function.
 *
 * These tests exercise the full pipeline without hitting a real LLM:
 *   config load → planner → git worktree → worker (injected) → verifier → ledger
 *
 * Worker injection via opts.workerFn bypasses the LLM; all other paths are real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { runRun } from "../commands/run.js";
import {
  LedgerReader,
  WorkerResultSchema,
  replayLedger,
  runBoundaryViolatingWorker,
  runFalseSelfReportWorker,
  type WorkerContext,
  type WorkerResult,
} from "@agentledger/core";

/**
 * Worker that writes to src/**\/*.ts — valid for both mock planner tasks:
 *   analyze: allowedFiles includes "src/**\/*.ts"
 *   implement: allowedFiles includes "src/**\/*.ts"
 */
async function e2eHappyWorker(ctx: WorkerContext): Promise<WorkerResult> {
  const relPath = `src/agentledger-${ctx.task.taskId}.ts`;
  const absPath = join(ctx.worktreePath, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `// agentledger task: ${ctx.task.taskId}\n`, "utf8");
  return WorkerResultSchema.parse({
    taskId: ctx.task.taskId,
    summary: `E2E worker completed "${ctx.task.title}"`,
    filesRead: [],
    filesModified: [relPath],
    worktreeBranch: `agentledger/${ctx.task.taskId}`,
    output: { completed: true },
  });
}

const HAPPY_CONFIG = JSON.stringify({
  version: "0.1.0",
  verification: {
    commands: { check: "echo ok" },
    required: ["check"],
  },
});

const FAILING_VERIFY_CONFIG = JSON.stringify({
  version: "0.1.0",
  verification: {
    commands: { test: "sh -c 'exit 1'" },
    required: ["test"],
  },
});

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentledger-e2e-"));
  execSync("git init", { cwd: dir });
  execSync("git config user.email test@test.com", { cwd: dir });
  execSync("git config user.name Test", { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# E2E Test Repo\n");
  execSync("git add -A", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
  mkdirSync(join(dir, ".agentledger"), { recursive: true });
  return dir;
}

describe("runRun E2E", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeRepo();
    // Prevent process.exit from killing vitest — throw instead
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it("happy path: all tasks complete, ledger contains RUN_COMPLETED", async () => {
    writeFileSync(join(tmpDir, ".agentledger", "config.json"), HAPPY_CONFIG);

    await runRun("add a greeting function", tmpDir, {
      useMockPlanner: true,
      workerFn: e2eHappyWorker,
    });

    const reader = new LedgerReader(join(tmpDir, ".agentledger", "ledger.jsonl"));
    const events = await reader.readAll();
    const types = events.map((e) => e.event_type);

    expect(types).toContain("RUN_COMPLETED");
    expect(types).toContain("TASK_COMPLETED");
    expect(types).not.toContain("TASK_FAILED");
    expect(types).not.toContain("RUN_FAILED");
  });

  // ── Boundary violation ───────────────────────────────────────────────────────

  it("boundary violation: BOUNDARY_VIOLATION emitted, run fails", async () => {
    writeFileSync(join(tmpDir, ".agentledger", "config.json"), HAPPY_CONFIG);

    await expect(
      runRun("add a feature", tmpDir, {
        useMockPlanner: true,
        workerFn: (ctx) => runBoundaryViolatingWorker(ctx, ".env"),
      }),
    ).rejects.toThrow("process.exit");

    const reader = new LedgerReader(join(tmpDir, ".agentledger", "ledger.jsonl"));
    const events = await reader.readAll();
    const types = events.map((e) => e.event_type);

    expect(types).toContain("BOUNDARY_VIOLATION");
    expect(types).toContain("VERIFICATION_FAILED");
    expect(types).toContain("TASK_FAILED");
    expect(types).toContain("RUN_FAILED");
    expect(types).not.toContain("RUN_COMPLETED");
  });

  // ── False self-report ────────────────────────────────────────────────────────

  it("false self-report: VERIFICATION_FAILED when command exits non-zero", async () => {
    writeFileSync(join(tmpDir, ".agentledger", "config.json"), FAILING_VERIFY_CONFIG);

    await expect(
      runRun("add a feature", tmpDir, {
        useMockPlanner: true,
        workerFn: runFalseSelfReportWorker,
      }),
    ).rejects.toThrow("process.exit");

    const reader = new LedgerReader(join(tmpDir, ".agentledger", "ledger.jsonl"));
    const events = await reader.readAll();
    const types = events.map((e) => e.event_type);

    expect(types).toContain("VERIFICATION_FAILED");
    expect(types).toContain("TASK_FAILED");
    expect(types).toContain("RUN_FAILED");
    expect(types).not.toContain("VERIFICATION_PASSED");
    expect(types).not.toContain("RUN_COMPLETED");
  });

  // ── Hash chain integrity ─────────────────────────────────────────────────────

  it("hash chain: valid after a successful run", async () => {
    writeFileSync(join(tmpDir, ".agentledger", "config.json"), HAPPY_CONFIG);

    await runRun("add a greeting function", tmpDir, {
      useMockPlanner: true,
      workerFn: e2eHappyWorker,
    });

    const reader = new LedgerReader(join(tmpDir, ".agentledger", "ledger.jsonl"));
    const result = await reader.verifyChain();

    expect(result.valid).toBe(true);
  });

  // ── Replay ───────────────────────────────────────────────────────────────────

  it("replay: reconstructs completed task statuses after happy path", async () => {
    writeFileSync(join(tmpDir, ".agentledger", "config.json"), HAPPY_CONFIG);

    await runRun("add a greeting function", tmpDir, {
      useMockPlanner: true,
      workerFn: e2eHappyWorker,
    });

    const reader = new LedgerReader(join(tmpDir, ".agentledger", "ledger.jsonl"));
    const events = await reader.readAll();
    const runId = events.find((e) => e.event_type === "RUN_CREATED")!.run_id;

    const state = replayLedger(events, runId);

    expect(state.status).toBe("completed");
    expect(state.tasks.length).toBeGreaterThan(0);
    expect(state.tasks.every((t) => t.status === "completed")).toBe(true);
  });

  it("replay: reconstructs failed task status after boundary violation", async () => {
    writeFileSync(join(tmpDir, ".agentledger", "config.json"), HAPPY_CONFIG);

    await expect(
      runRun("add a feature", tmpDir, {
        useMockPlanner: true,
        workerFn: (ctx) => runBoundaryViolatingWorker(ctx, ".env"),
      }),
    ).rejects.toThrow("process.exit");

    const reader = new LedgerReader(join(tmpDir, ".agentledger", "ledger.jsonl"));
    const events = await reader.readAll();
    const runId = events.find((e) => e.event_type === "RUN_CREATED")!.run_id;

    const state = replayLedger(events, runId);

    expect(state.status).toBe("failed");
    expect(state.tasks.some((t) => t.status === "failed")).toBe(true);
  });
});
