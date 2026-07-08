import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createTaskWorktree, cleanupWorktree } from "../createWorktree.js";
import { generatePatch, listModifiedFiles } from "../generatePatch.js";
import type { AgentTask } from "../../schemas/index.js";

const execAsync = promisify(exec);

async function initTestRepo(repoPath: string): Promise<void> {
  await mkdir(repoPath, { recursive: true });
  await execAsync("git init", { cwd: repoPath });
  await execAsync("git config user.email 'test@agentledger.test'", { cwd: repoPath });
  await execAsync("git config user.name 'AgentLedger Test'", { cwd: repoPath });
  // Ensure we're on 'main' regardless of git defaultBranch config
  await execAsync("git checkout -b main", { cwd: repoPath }).catch(() => {
    // Already on main or branch already exists — ignore
  });

  await writeFile(join(repoPath, "README.md"), "# Test Repo\n");
  await execAsync("git add README.md", { cwd: repoPath });
  await execAsync("git commit -m 'Initial commit'", { cwd: repoPath });
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "task-test-001",
    runId: "run-001",
    title: "Test task",
    description: "A test task",
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

describe("createTaskWorktree", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-wt-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates the worktree directory at the expected path", async () => {
    const task = makeTask();
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    expect(existsSync(handle.worktreePath)).toBe(true);
  });

  it("creates worktree on the correct branch", async () => {
    const task = makeTask({ taskId: "task-abc" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const { stdout } = await execAsync("git branch --show-current", {
      cwd: handle.worktreePath,
    });
    expect(stdout.trim()).toBe("agentledger/task-abc");
  });

  it("returns WorktreeHandle with correct fields", async () => {
    const task = makeTask({ taskId: "task-xyz" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    expect(handle.taskId).toBe("task-xyz");
    expect(handle.branch).toBe("agentledger/task-xyz");
    expect(handle.worktreePath).toContain("task-xyz");
  });

  it("worktree path is registered in main repo worktree list", async () => {
    const task = makeTask();
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const { stdout } = await execAsync("git worktree list --porcelain", {
      cwd: repoRoot,
    });
    expect(stdout).toContain(handle.worktreePath);
  });

  it("worktree contains files from HEAD (initial commit)", async () => {
    const task = makeTask({ allowedFiles: [] }); // no sparse-checkout
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    // README.md from initial commit should be present
    expect(existsSync(join(handle.worktreePath, "README.md"))).toBe(true);
  });

  it("creates worktreeBaseDir if it does not exist", async () => {
    const deepBase = join(tmpDir, "deep", "nested", "worktrees");
    const task = makeTask({ taskId: "task-deep" });
    const handle = await createTaskWorktree(repoRoot, task, deepBase);

    expect(existsSync(handle.worktreePath)).toBe(true);
  });

  it("two tasks get separate worktree paths", async () => {
    const handle1 = await createTaskWorktree(
      repoRoot,
      makeTask({ taskId: "task-one" }),
      worktreeBaseDir,
    );
    const handle2 = await createTaskWorktree(
      repoRoot,
      makeTask({ taskId: "task-two" }),
      worktreeBaseDir,
    );

    expect(handle1.worktreePath).not.toBe(handle2.worktreePath);
    expect(existsSync(handle1.worktreePath)).toBe(true);
    expect(existsSync(handle2.worktreePath)).toBe(true);
  });
});

describe("cleanupWorktree", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-cleanup-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes the worktree directory", async () => {
    const task = makeTask({ taskId: "task-cleanup" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    expect(existsSync(handle.worktreePath)).toBe(true);
    await cleanupWorktree(repoRoot, handle);
    expect(existsSync(handle.worktreePath)).toBe(false);
  });

  it("removes the task branch", async () => {
    const task = makeTask({ taskId: "task-branch-rm" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    await cleanupWorktree(repoRoot, handle);

    const { stdout } = await execAsync("git branch --list", { cwd: repoRoot });
    expect(stdout).not.toContain(handle.branch);
  });

  it("is idempotent — second cleanup does not throw", async () => {
    const task = makeTask({ taskId: "task-idem" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);
    await cleanupWorktree(repoRoot, handle);
    await expect(cleanupWorktree(repoRoot, handle)).resolves.not.toThrow();
  });
});

describe("generatePatch", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-patch-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates a patch file at the specified path", async () => {
    const task = makeTask({ taskId: "task-patch" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    // Worker creates a new file
    await writeFile(join(handle.worktreePath, "output.md"), "# Output\n", "utf8");

    const patchPath = join(tmpDir, "patches", `${task.taskId}.patch`);
    await generatePatch(handle.worktreePath, patchPath);

    expect(existsSync(patchPath)).toBe(true);
  });

  it("patch content contains the modified file", async () => {
    const task = makeTask({ taskId: "task-patch-content" });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "new-file.ts"), "export const x = 1;\n", "utf8");

    const patchPath = join(tmpDir, "patches", `${task.taskId}.patch`);
    const content = await generatePatch(handle.worktreePath, patchPath);

    expect(content).toContain("new-file.ts");
  });

  it("patch is empty string when no changes made", async () => {
    const task = makeTask({ taskId: "task-no-changes", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const patchPath = join(tmpDir, "patches", `${task.taskId}.patch`);
    const content = await generatePatch(handle.worktreePath, patchPath);

    expect(content).toBe("");
  });

  it("patch captures modification to existing file", async () => {
    const task = makeTask({ taskId: "task-patch-modify", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    // Modify the existing README.md
    await writeFile(join(handle.worktreePath, "README.md"), "# Modified\n\nNew content.\n", "utf8");

    const patchPath = join(tmpDir, "patches", `${task.taskId}.patch`);
    const content = await generatePatch(handle.worktreePath, patchPath);

    expect(content).toContain("README.md");
    expect(content).toContain("Modified");
  });

  it("creates patch output directory if it does not exist", async () => {
    const task = makeTask({ taskId: "task-patch-dir", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "output.md"), "# Output\n", "utf8");

    const deepPatchPath = join(tmpDir, "deep", "nested", "patches", `${task.taskId}.patch`);
    await generatePatch(handle.worktreePath, deepPatchPath);

    expect(existsSync(deepPatchPath)).toBe(true);
  });
});

describe("listModifiedFiles", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeBaseDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-list-"));
    repoRoot = join(tmpDir, "repo");
    worktreeBaseDir = join(tmpDir, "worktrees");
    await initTestRepo(repoRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no changes", async () => {
    const task = makeTask({ taskId: "task-list-empty", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    const modified = await listModifiedFiles(handle.worktreePath);
    expect(modified).toEqual([]);
  });

  it("returns new file in list", async () => {
    const task = makeTask({ taskId: "task-list-new", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "new.ts"), "export {};\n", "utf8");

    const modified = await listModifiedFiles(handle.worktreePath);
    expect(modified).toContain("new.ts");
  });

  it("returns modified file in list", async () => {
    const task = makeTask({ taskId: "task-list-mod", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "README.md"), "# Changed\n", "utf8");

    const modified = await listModifiedFiles(handle.worktreePath);
    expect(modified).toContain("README.md");
  });

  it("returns multiple files", async () => {
    const task = makeTask({ taskId: "task-list-multi", allowedFiles: [] });
    const handle = await createTaskWorktree(repoRoot, task, worktreeBaseDir);

    await writeFile(join(handle.worktreePath, "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(join(handle.worktreePath, "b.ts"), "export const b = 2;\n", "utf8");

    const modified = await listModifiedFiles(handle.worktreePath);
    expect(modified).toContain("a.ts");
    expect(modified).toContain("b.ts");
  });
});
