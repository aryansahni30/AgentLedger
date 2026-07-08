import { exec } from "child_process";
import { promisify } from "util";
import { mkdir, writeFile } from "fs/promises";
import { isAbsolute, join, dirname } from "path";
import {
  WorktreeHandleSchema,
  type WorktreeHandle,
  type AgentTask,
} from "../schemas/index.js";

const execAsync = promisify(exec);

const BRANCH_PREFIX = "agentledger";

export async function createTaskWorktree(
  repoRoot: string,
  task: AgentTask,
  worktreeBaseDir: string,
): Promise<WorktreeHandle> {
  const branch = `${BRANCH_PREFIX}/${task.taskId}`;
  const worktreePath = join(worktreeBaseDir, task.taskId);

  await mkdir(worktreeBaseDir, { recursive: true });

  await execAsync(`git worktree add -b "${branch}" "${worktreePath}"`, {
    cwd: repoRoot,
  });

  if (task.allowedFiles.length > 0) {
    await applySparseCheckout(worktreePath, task.allowedFiles);
  }

  return WorktreeHandleSchema.parse({ taskId: task.taskId, branch, worktreePath });
}

export async function cleanupWorktree(
  repoRoot: string,
  handle: WorktreeHandle,
): Promise<void> {
  try {
    await execAsync(`git worktree remove "${handle.worktreePath}" --force`, {
      cwd: repoRoot,
    });
  } catch {
    // Already removed — not fatal
  }

  try {
    await execAsync(`git branch -D "${handle.branch}"`, { cwd: repoRoot });
  } catch {
    // Branch already gone — not fatal
  }
}

/**
 * Applies sparse-checkout to limit the worktree to the given file patterns.
 * Uses core.sparseCheckout + info/sparse-checkout for maximum git version compatibility.
 *
 * Note: this is the "prevention" layer. The verifier (Phase 4) provides
 * independent "detection" — do not rely solely on sparse-checkout for enforcement.
 */
async function applySparseCheckout(
  worktreePath: string,
  patterns: string[],
): Promise<void> {
  // Enable sparse checkout for this worktree
  await execAsync("git config core.sparseCheckout true", { cwd: worktreePath });

  // git rev-parse --git-dir returns the worktree-specific git dir
  // (e.g., /main/.git/worktrees/taskId/ for a linked worktree)
  const { stdout } = await execAsync("git rev-parse --git-dir", {
    cwd: worktreePath,
  });
  const gitDir = stdout.trim();
  const resolvedGitDir = isAbsolute(gitDir) ? gitDir : join(worktreePath, gitDir);

  const infoDir = join(resolvedGitDir, "info");
  await mkdir(infoDir, { recursive: true });

  const sparseFile = join(infoDir, "sparse-checkout");
  await writeFile(sparseFile, patterns.join("\n") + "\n", "utf8");

  // Apply patterns — updates the working tree to match
  await execAsync("git read-tree -mu HEAD", { cwd: worktreePath });
}
