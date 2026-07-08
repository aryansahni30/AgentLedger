import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createTaskWorktree, cleanupWorktree } from "../../git/createWorktree.js";
import { checkFileBoundaries } from "../checkBoundaries.js";
import { runVerificationCommands } from "../runCommands.js";
import { verifyTask } from "../verifyTask.js";
import type { AgentTask, VerificationCommand } from "../../schemas/index.js";

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
    taskId: "task-verify-001",
    runId: "run-001",
    title: "Verify Task",
    description: "Test task for verifier",
    owner: "worker-1",
    dependencies: [],
    allowedFiles: ["**/*.md", "src/**/*.ts"],
    blockedFiles: ["**/.env", "**/secrets.txt"],
    allowedTools: ["read_file"],
    expectedOutputs: [],
    successCriteria: [],
    status: "pending",
    ...overrides,
  };
}

// ─── checkFileBoundaries ──────────────────────────────────────────────────────

describe("checkFileBoundaries", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-boundary-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes when no files modified", async () => {
    const task = makeTask({ taskId: "task-clean", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    await cleanupWorktree(repoRoot, handle);
  });

  it("passes when file matches allowedFiles pattern", async () => {
    const task = makeTask({ taskId: "task-allowed", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "NOTES.md"), "# Notes\n");

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    await cleanupWorktree(repoRoot, handle);
  });

  it("fails when file modified outside allowedFiles — UNOWNED_FILE_MODIFIED", async () => {
    const task = makeTask({ taskId: "task-unowned", allowedFiles: ["src/**/*.ts"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    // README.md doesn't match src/**/*.ts
    await writeFile(join(handle.worktreePath, "README.md"), "# Modified\n");

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.violationType).toBe("UNOWNED_FILE_MODIFIED");
    expect(result.violations[0]!.file).toBe("README.md");
    await cleanupWorktree(repoRoot, handle);
  });

  it("fails when blocked file modified — BLOCKED_FILE_MODIFIED", async () => {
    const task = makeTask({
      taskId: "task-blocked",
      allowedFiles: ["**/*"],
      blockedFiles: ["**/secrets.txt"],
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "secrets.txt"), "super-secret\n");

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.violationType).toBe("BLOCKED_FILE_MODIFIED");
    expect(result.violations[0]!.file).toBe("secrets.txt");
    await cleanupWorktree(repoRoot, handle);
  });

  it("blocked takes priority over allowed when patterns overlap", async () => {
    const task = makeTask({
      taskId: "task-priority",
      allowedFiles: ["**/*"],       // would match .env
      blockedFiles: ["**/.env"],    // but .env is blocked
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, ".env"), "SECRET=1\n");

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.passed).toBe(false);
    expect(result.violations[0]!.violationType).toBe("BLOCKED_FILE_MODIFIED");
    await cleanupWorktree(repoRoot, handle);
  });

  it("reports multiple violations for multiple out-of-scope files", async () => {
    const task = makeTask({
      taskId: "task-multi-violations",
      allowedFiles: ["src/**/*.ts"],
      blockedFiles: ["**/.env"],
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "README.md"), "# Modified\n");
    await writeFile(join(handle.worktreePath, ".env"), "SECRET=1\n");

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.passed).toBe(false);
    const types = result.violations.map((v) => v.violationType);
    expect(types).toContain("BLOCKED_FILE_MODIFIED");
    expect(types).toContain("UNOWNED_FILE_MODIFIED");
    await cleanupWorktree(repoRoot, handle);
  });

  it("matches nested paths with glob patterns", async () => {
    const task = makeTask({
      taskId: "task-nested",
      allowedFiles: ["src/**/*.ts"],
      blockedFiles: [],
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await mkdir(join(handle.worktreePath, "src", "utils"), { recursive: true });
    await writeFile(join(handle.worktreePath, "src", "utils", "helper.ts"), "export {};\n");

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.passed).toBe(true);
    await cleanupWorktree(repoRoot, handle);
  });

  it("returns violation message containing the filename", async () => {
    const task = makeTask({ taskId: "task-msg", allowedFiles: ["src/**/*.ts"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "README.md"), "# Modified\n");

    const result = await checkFileBoundaries(handle.worktreePath, task);

    expect(result.violations[0]!.message).toContain("README.md");
    await cleanupWorktree(repoRoot, handle);
  });
});

// ─── runVerificationCommands ──────────────────────────────────────────────────

describe("runVerificationCommands", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-cmds-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeCmd(overrides: Partial<VerificationCommand> = {}): VerificationCommand {
    return {
      name: "test",
      command: "echo hello",
      required: true,
      ...overrides,
    };
  }

  it("runs a successful command and returns exitCode 0", async () => {
    const results = await runVerificationCommands(tmpDir, [makeCmd()]);

    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).toBe(0);
  });

  it("captures stdout from command", async () => {
    const results = await runVerificationCommands(tmpDir, [
      makeCmd({ command: "echo hello-world" }),
    ]);

    expect(results[0]!.stdout.trim()).toBe("hello-world");
  });

  it("captures non-zero exit code without throwing", async () => {
    const results = await runVerificationCommands(tmpDir, [
      makeCmd({ command: "exit 42", name: "failing" }),
    ]);

    expect(results[0]!.exitCode).toBe(42);
  });

  it("captures stderr from failed command", async () => {
    const results = await runVerificationCommands(tmpDir, [
      makeCmd({ command: "ls /path/that/does/not/exist/xyz123" }),
    ]);

    expect(results[0]!.exitCode).not.toBe(0);
    expect(results[0]!.stderr).toBeTruthy();
  });

  it("records command name and command string in result", async () => {
    const cmd = makeCmd({ name: "my-check", command: "echo ok" });
    const results = await runVerificationCommands(tmpDir, [cmd]);

    expect(results[0]!.name).toBe("my-check");
    expect(results[0]!.command).toBe("echo ok");
  });

  it("records non-negative durationMs", async () => {
    const results = await runVerificationCommands(tmpDir, [makeCmd()]);

    expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runs all commands when all pass", async () => {
    const cmds = [
      makeCmd({ name: "a", command: "echo a" }),
      makeCmd({ name: "b", command: "echo b" }),
      makeCmd({ name: "c", command: "echo c" }),
    ];

    const results = await runVerificationCommands(tmpDir, cmds);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("short-circuits after required command fails", async () => {
    const cmds = [
      makeCmd({ name: "pass", command: "echo ok" }),
      makeCmd({ name: "fail", command: "exit 1", required: true }),
      makeCmd({ name: "never", command: "echo never" }),
    ];

    const results = await runVerificationCommands(tmpDir, cmds);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual(["pass", "fail"]);
  });

  it("does NOT short-circuit after optional command fails", async () => {
    const cmds = [
      makeCmd({ name: "fail-optional", command: "exit 1", required: false }),
      makeCmd({ name: "after", command: "echo after" }),
    ];

    const results = await runVerificationCommands(tmpDir, cmds);

    expect(results).toHaveLength(2);
    expect(results[1]!.name).toBe("after");
    expect(results[1]!.exitCode).toBe(0);
  });

  it("returns empty array for empty command list", async () => {
    const results = await runVerificationCommands(tmpDir, []);
    expect(results).toEqual([]);
  });
});

// ─── verifyTask (full pipeline) ────────────────────────────────────────────────

describe("verifyTask", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-verifytask-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes when no modifications and no commands", async () => {
    const task = makeTask({ taskId: "task-vt-clean", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await verifyTask(handle.worktreePath, task, []);

    expect(result.passed).toBe(true);
    expect(result.taskId).toBe("task-vt-clean");
    expect(result.boundaryCheck.passed).toBe(true);
    expect(result.commandResults).toEqual([]);
    await cleanupWorktree(repoRoot, handle);
  });

  it("passes when file in allowedFiles and command succeeds", async () => {
    const task = makeTask({ taskId: "task-vt-pass", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "NOTES.md"), "# Notes\n");

    const result = await verifyTask(handle.worktreePath, task, [
      { name: "echo", command: "echo ok", required: true },
    ]);

    expect(result.passed).toBe(true);
    expect(result.commandResults).toHaveLength(1);
    expect(result.commandResults[0]!.exitCode).toBe(0);
    await cleanupWorktree(repoRoot, handle);
  });

  it("fails and skips commands when boundary is violated", async () => {
    const task = makeTask({
      taskId: "task-vt-boundary-fail",
      allowedFiles: ["src/**/*.ts"],
      blockedFiles: [],
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    // README.md does not match src/**/*.ts
    await writeFile(join(handle.worktreePath, "README.md"), "# Modified\n");

    const commandsRun: string[] = [];
    const result = await verifyTask(handle.worktreePath, task, [
      { name: "should-not-run", command: "echo ran", required: true },
    ]);

    expect(result.passed).toBe(false);
    expect(result.boundaryCheck.passed).toBe(false);
    // Commands skipped when boundary fails
    expect(result.commandResults).toHaveLength(0);
    await cleanupWorktree(repoRoot, handle);
  });

  it("fails when boundary passes but command fails", async () => {
    const task = makeTask({ taskId: "task-vt-cmd-fail", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "NOTES.md"), "# Notes\n");

    const result = await verifyTask(handle.worktreePath, task, [
      { name: "failing-test", command: "exit 1", required: true },
    ]);

    expect(result.passed).toBe(false);
    expect(result.boundaryCheck.passed).toBe(true);
    expect(result.commandResults[0]!.exitCode).toBe(1);
    await cleanupWorktree(repoRoot, handle);
  });

  it("result taskId matches task taskId", async () => {
    const task = makeTask({ taskId: "task-id-match-99" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await verifyTask(handle.worktreePath, task, []);

    expect(result.taskId).toBe("task-id-match-99");
    await cleanupWorktree(repoRoot, handle);
  });

  it("result passes VerificationResultSchema validation", async () => {
    const { VerificationResultSchema } = await import("../../schemas/index.js");
    const task = makeTask({ taskId: "task-schema-check", allowedFiles: ["**/*.md"] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "NOTES.md"), "# Notes\n");

    const result = await verifyTask(handle.worktreePath, task, [
      { name: "ok", command: "echo ok", required: true },
    ]);

    expect(() => VerificationResultSchema.parse(result)).not.toThrow();
    await cleanupWorktree(repoRoot, handle);
  });
});
