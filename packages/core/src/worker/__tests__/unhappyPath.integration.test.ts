/**
 * Phase 6: Unhappy-path integration tests
 *
 * These tests exercise the full harness pipeline using scripted worker fixtures
 * that simulate two classes of agent misbehavior:
 *
 *   1. BOUNDARY_VIOLATION — worker writes to a blocked file and self-reports success.
 *      The verifier must catch the violation via file-diff, not by trusting the worker.
 *
 *   2. VERIFICATION_FAILED — worker stays within file boundaries and self-reports
 *      success, but the real verification command exits non-zero.
 *      The verifier must reject the task based on exit code, not the self-report.
 *
 * "It caught a lie" and "it blocked a boundary violation" are the two moments
 * that prove the harness works. (CLAUDE.md § Demo Requirements)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createTaskWorktree, cleanupWorktree } from "../../git/createWorktree.js";
import { verifyTask } from "../../verifier/verifyTask.js";
import { runBoundaryViolatingWorker } from "../fixtures/boundaryViolatingWorker.js";
import { runFalseSelfReportWorker } from "../fixtures/falseSelfReportWorker.js";
import type { AgentTask, WorkerContext } from "../../schemas/index.js";

const execAsync = promisify(exec);

async function initTestRepo(repoPath: string): Promise<void> {
  await mkdir(repoPath, { recursive: true });
  await execAsync("git init", { cwd: repoPath });
  await execAsync("git config user.email 'test@agentledger.test'", { cwd: repoPath });
  await execAsync("git config user.name 'AgentLedger Test'", { cwd: repoPath });
  await execAsync("git checkout -b main", { cwd: repoPath }).catch(() => {});
  await writeFile(join(repoPath, "README.md"), "# Test Repo\n");
  await execAsync("git add README.md", { cwd: repoPath });
  await execAsync("git commit -m 'Initial commit'", { cwd: repoPath });
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "task-unhappy-001",
    runId: "run-unhappy-001",
    title: "Unhappy path task",
    description: "Tests boundary violations and false self-reports",
    owner: "scripted-worker",
    dependencies: [],
    allowedFiles: ["**/*.md"],
    blockedFiles: ["**/.env", "**/secrets.txt"],
    allowedTools: [],
    expectedOutputs: [],
    successCriteria: [],
    status: "pending",
    ...overrides,
  };
}

function makeContext(task: AgentTask, worktreePath: string): WorkerContext {
  return {
    task,
    worktreePath,
    relevantContext: {},
    allowedFiles: task.allowedFiles,
    blockedFiles: task.blockedFiles,
    allowedTools: task.allowedTools,
    outputSchema: {},
  };
}

// ─── Scenario 1: BOUNDARY_VIOLATION ──────────────────────────────────────────

describe("Scenario 1 — BOUNDARY_VIOLATION: worker writes blocked file, self-reports success", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-unhappy-bv-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("verifier catches BLOCKED_FILE_MODIFIED even though worker self-reported success", async () => {
    const task = makeTask({ taskId: "task-bv-blocked" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    // Worker runs — touches secrets.txt (blocked) and claims success
    const workerResult = await runBoundaryViolatingWorker(ctx, "secrets.txt");
    expect(workerResult.output["selfReportedSuccess"]).toBe(true);

    // Verifier runs — must detect the blocked file via diff
    const result = await verifyTask(handle.worktreePath, task, []);

    expect(result.passed).toBe(false);
    expect(result.boundaryCheck.passed).toBe(false);

    const types = result.boundaryCheck.violations.map((v) => v.violationType);
    expect(types).toContain("BLOCKED_FILE_MODIFIED");

    const violation = result.boundaryCheck.violations.find(
      (v) => v.violationType === "BLOCKED_FILE_MODIFIED",
    );
    expect(violation?.file).toBe("secrets.txt");

    await cleanupWorktree(repoRoot, handle);
  });

  it("verifier catches UNOWNED_FILE_MODIFIED when worker writes outside allowedFiles", async () => {
    const task = makeTask({
      taskId: "task-bv-unowned",
      allowedFiles: ["src/**/*.ts"],  // only src/*.ts allowed — no .md, no .env
      blockedFiles: ["**/.env"],
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    // Worker writes a .md file (not in allowedFiles) and claims success
    const workerResult = await runBoundaryViolatingWorker(ctx, "NOTES.md");
    expect(workerResult.output["selfReportedSuccess"]).toBe(true);

    const result = await verifyTask(handle.worktreePath, task, []);

    expect(result.passed).toBe(false);
    expect(result.boundaryCheck.passed).toBe(false);

    const types = result.boundaryCheck.violations.map((v) => v.violationType);
    expect(types).toContain("UNOWNED_FILE_MODIFIED");

    await cleanupWorktree(repoRoot, handle);
  });

  it("verifier skips verification commands when boundary fails", async () => {
    const task = makeTask({ taskId: "task-bv-skip-cmds" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    await runBoundaryViolatingWorker(ctx, "secrets.txt");

    // Would succeed if run — but should be skipped because boundary fails
    const result = await verifyTask(handle.worktreePath, task, [
      { name: "would-pass", command: "echo ok", required: true },
    ]);

    expect(result.passed).toBe(false);
    expect(result.boundaryCheck.passed).toBe(false);
    // Commands must be skipped
    expect(result.commandResults).toHaveLength(0);

    await cleanupWorktree(repoRoot, handle);
  });

  it("verifier report includes the blocked file path in violation message", async () => {
    const task = makeTask({ taskId: "task-bv-msg" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    await runBoundaryViolatingWorker(ctx, "secrets.txt");

    const result = await verifyTask(handle.worktreePath, task, []);

    const blocked = result.boundaryCheck.violations.find(
      (v) => v.violationType === "BLOCKED_FILE_MODIFIED",
    );
    expect(blocked?.message).toContain("secrets.txt");

    await cleanupWorktree(repoRoot, handle);
  });

  it("worker self-report filesModified does not include the blocked file", async () => {
    const task = makeTask({ taskId: "task-bv-self-report" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    const workerResult = await runBoundaryViolatingWorker(ctx, "secrets.txt");

    // Worker omits the blocked file from its own filesModified report
    expect(workerResult.filesModified).not.toContain("secrets.txt");
    // But the verifier independently detects it via git diff
    const result = await verifyTask(handle.worktreePath, task, []);
    expect(result.boundaryCheck.violations.some((v) => v.file === "secrets.txt")).toBe(true);

    await cleanupWorktree(repoRoot, handle);
  });
});

// ─── Scenario 2: VERIFICATION_FAILED ─────────────────────────────────────────

describe("Scenario 2 — VERIFICATION_FAILED: worker self-reports success, real command exits non-zero", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-unhappy-vf-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("verifier rejects task when real test command exits 1, ignoring worker self-report", async () => {
    const task = makeTask({ taskId: "task-vf-lie", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    // Worker runs — stays in bounds, but lies about tests
    const workerResult = await runFalseSelfReportWorker(ctx);
    expect(workerResult.output["testsPass"]).toBe(true);
    expect(workerResult.output["selfReportedSuccess"]).toBe(true);

    // Verifier runs real command that exits non-zero
    const result = await verifyTask(handle.worktreePath, task, [
      { name: "tests", command: "exit 1", required: true },
    ]);

    expect(result.passed).toBe(false);
    // Boundary passes — violation is in command execution
    expect(result.boundaryCheck.passed).toBe(true);
    expect(result.commandResults).toHaveLength(1);
    expect(result.commandResults[0]!.exitCode).toBe(1);

    await cleanupWorktree(repoRoot, handle);
  });

  it("verifier passes when real command actually succeeds", async () => {
    const task = makeTask({ taskId: "task-vf-real-pass", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    await runFalseSelfReportWorker(ctx);

    // When real command passes, the task passes regardless of self-report
    const result = await verifyTask(handle.worktreePath, task, [
      { name: "tests", command: "exit 0", required: true },
    ]);

    expect(result.passed).toBe(true);
    expect(result.commandResults[0]!.exitCode).toBe(0);

    await cleanupWorktree(repoRoot, handle);
  });

  it("verifier captures stderr from failing command", async () => {
    const task = makeTask({ taskId: "task-vf-stderr", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    await runFalseSelfReportWorker(ctx);

    const result = await verifyTask(handle.worktreePath, task, [
      { name: "tests", command: "echo 'FAIL: assertion failed' >&2; exit 1", required: true },
    ]);

    expect(result.passed).toBe(false);
    expect(result.commandResults[0]!.stderr).toContain("assertion failed");

    await cleanupWorktree(repoRoot, handle);
  });

  it("verifier records durationMs for executed command", async () => {
    const task = makeTask({ taskId: "task-vf-duration", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    await runFalseSelfReportWorker(ctx);

    const result = await verifyTask(handle.worktreePath, task, [
      { name: "tests", command: "exit 1", required: true },
    ]);

    expect(result.commandResults[0]!.durationMs).toBeGreaterThanOrEqual(0);

    await cleanupWorktree(repoRoot, handle);
  });

  it("non-required command failure does not fail the task by itself", async () => {
    const task = makeTask({ taskId: "task-vf-optional", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    const ctx = makeContext(task, handle.worktreePath);

    await runFalseSelfReportWorker(ctx);

    const result = await verifyTask(handle.worktreePath, task, [
      { name: "optional-lint", command: "exit 1", required: false },
      { name: "required-test", command: "exit 0", required: true },
    ]);

    expect(result.passed).toBe(true);
    expect(result.commandResults).toHaveLength(2);
    expect(result.commandResults[0]!.exitCode).toBe(1);  // optional failed
    expect(result.commandResults[1]!.exitCode).toBe(0);  // required passed

    await cleanupWorktree(repoRoot, handle);
  });
});
