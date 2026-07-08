import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createTaskWorktree, cleanupWorktree } from "../../git/createWorktree.js";
import { runMockWorker } from "../MockWorker.js";
import type { AgentTask, WorkerContext } from "../../schemas/index.js";

const execAsync = promisify(exec);

async function initTestRepo(repoPath: string): Promise<void> {
  const { mkdir } = await import("fs/promises");
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
    taskId: "task-mock-001",
    runId: "run-001",
    title: "Mock Task",
    description: "A mock task for testing",
    owner: "worker-1",
    dependencies: [],
    allowedFiles: ["src/**/*.ts", "**/*.md"],
    blockedFiles: ["**/.env"],
    allowedTools: ["read_file"],
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
    allowedFiles: task.allowedFiles,
    blockedFiles: task.blockedFiles,
    allowedTools: task.allowedTools,
    relevantContext: {},
    outputSchema: {},
  };
}

describe("runMockWorker", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-mock-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns a WorkerResult with correct taskId", async () => {
    const task = makeTask({ taskId: "task-id-check" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.taskId).toBe("task-id-check");
    await cleanupWorktree(repoRoot, handle);
  });

  it("returns correct worktreeBranch in result", async () => {
    const task = makeTask({ taskId: "task-branch-check" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.worktreeBranch).toBe("agentledger/task-branch-check");
    await cleanupWorktree(repoRoot, handle);
  });

  it("creates output file inside the worktree", async () => {
    const task = makeTask({ taskId: "task-output-file" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await runMockWorker(makeContext(task, handle.worktreePath));

    const expectedFile = join(handle.worktreePath, `agentledger-task-${task.taskId}.md`);
    expect(existsSync(expectedFile)).toBe(true);
    await cleanupWorktree(repoRoot, handle);
  });

  it("output file includes task title and description", async () => {
    const task = makeTask({
      taskId: "task-content-check",
      title: "My Test Title",
      description: "My Test Description",
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await runMockWorker(makeContext(task, handle.worktreePath));

    const { readFile } = await import("fs/promises");
    const content = await readFile(
      join(handle.worktreePath, `agentledger-task-${task.taskId}.md`),
      "utf8",
    );
    expect(content).toContain("My Test Title");
    expect(content).toContain("My Test Description");
    await cleanupWorktree(repoRoot, handle);
  });

  it("filesModified includes the output file", async () => {
    const task = makeTask({ taskId: "task-files-mod" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.filesModified).toContain(`agentledger-task-${task.taskId}.md`);
    await cleanupWorktree(repoRoot, handle);
  });

  it("modifies README.md when it exists and records in filesModified", async () => {
    const task = makeTask({ taskId: "task-readme" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    // README.md exists because it came from the initial commit
    expect(existsSync(join(handle.worktreePath, "README.md"))).toBe(true);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.filesModified).toContain("README.md");
    expect(result.filesRead).toContain("README.md");
    await cleanupWorktree(repoRoot, handle);
  });

  it("README.md contains the task annotation after worker runs", async () => {
    const task = makeTask({ taskId: "task-readme-annotated" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await runMockWorker(makeContext(task, handle.worktreePath));

    const { readFile } = await import("fs/promises");
    const content = await readFile(join(handle.worktreePath, "README.md"), "utf8");
    expect(content).toContain(`agentledger: ${task.taskId}`);
    await cleanupWorktree(repoRoot, handle);
  });

  it("does not modify README.md when it does not exist", async () => {
    const task = makeTask({ taskId: "task-no-readme", allowedFiles: [] });
    // Use a repo with no README
    const emptyRepoRoot = join(tmpDir, "empty-repo");
    const { mkdir } = await import("fs/promises");
    await mkdir(emptyRepoRoot, { recursive: true });
    await execAsync("git init", { cwd: emptyRepoRoot });
    await execAsync("git config user.email 'test@agentledger.test'", { cwd: emptyRepoRoot });
    await execAsync("git config user.name 'AgentLedger Test'", { cwd: emptyRepoRoot });
    await execAsync("git checkout -b main", { cwd: emptyRepoRoot }).catch(() => {});
    await writeFile(join(emptyRepoRoot, "placeholder.txt"), "placeholder\n");
    await execAsync("git add placeholder.txt", { cwd: emptyRepoRoot });
    await execAsync("git commit -m 'Initial commit'", { cwd: emptyRepoRoot });

    const emptyWorktreeBase = join(tmpDir, "empty-worktrees");
    const handle = await createTaskWorktree(emptyRepoRoot, task, emptyWorktreeBase);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.filesModified).not.toContain("README.md");
    expect(result.filesRead).not.toContain("README.md");
    await cleanupWorktree(emptyRepoRoot, handle);
  });

  it("filesRead includes up to 2 allowedFiles patterns", async () => {
    const task = makeTask({
      taskId: "task-files-read",
      allowedFiles: ["src/**/*.ts", "**/*.md", "lib/**/*.js"],
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    // Should include first 2 allowedFiles patterns (plus README.md if it exists)
    expect(result.filesRead).toContain("src/**/*.ts");
    expect(result.filesRead).toContain("**/*.md");
    await cleanupWorktree(repoRoot, handle);
  });

  it("result summary mentions task title", async () => {
    const task = makeTask({ taskId: "task-summary", title: "Unique Task Title XYZ" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.summary).toContain("Unique Task Title XYZ");
    await cleanupWorktree(repoRoot, handle);
  });

  it("output object contains completed:true", async () => {
    const task = makeTask({ taskId: "task-output-obj" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.output["completed"]).toBe(true);
    await cleanupWorktree(repoRoot, handle);
  });

  it("output object contains taskTitle and goal", async () => {
    const task = makeTask({
      taskId: "task-output-fields",
      title: "The Title",
      description: "The Goal",
    });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const result = await runMockWorker(makeContext(task, handle.worktreePath));

    expect(result.output["taskTitle"]).toBe("The Title");
    expect(result.output["goal"]).toBe("The Goal");
    await cleanupWorktree(repoRoot, handle);
  });

  it("result passes WorkerResultSchema validation (no throw)", async () => {
    const task = makeTask({ taskId: "task-schema-valid" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    // If schema validation fails, WorkerResultSchema.parse() inside MockWorker throws
    await expect(
      runMockWorker(makeContext(task, handle.worktreePath)),
    ).resolves.not.toThrow();

    await cleanupWorktree(repoRoot, handle);
  });
});
