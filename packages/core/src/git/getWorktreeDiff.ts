import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Returns the unified diff of all staged + unstaged changes in the worktree
 * against HEAD. Equivalent to `git diff HEAD` but run inside the given path.
 */
export async function getWorktreeDiff(worktreePath: string): Promise<string> {
  // Stage everything first so untracked files appear in the diff
  await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "HEAD"],
    { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout;
}
