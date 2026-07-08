import { exec } from "child_process";
import { promisify } from "util";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

const execAsync = promisify(exec);

/**
 * Stages all changes in the worktree, then generates a unified diff
 * of staged changes vs HEAD and writes it to outputPath.
 *
 * Returns the patch content (empty string if no changes).
 */
export async function generatePatch(
  worktreePath: string,
  outputPath: string,
): Promise<string> {
  // Stage all changes (new files, modifications, deletions).
  // --sparse allows staging files outside sparse-checkout — required to detect boundary violations.
  await execAsync("git add -A --sparse", { cwd: worktreePath });

  // Unified diff: staged changes vs HEAD
  const { stdout: patch } = await execAsync("git diff --cached HEAD", {
    cwd: worktreePath,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, patch, "utf8");

  return patch;
}

/**
 * Returns the list of files modified in the worktree (staged + unstaged)
 * relative to HEAD. Used by the verifier for boundary checks.
 */
export async function listModifiedFiles(worktreePath: string): Promise<string[]> {
  // Stage everything first so we capture untracked files too.
  // --sparse allows staging files outside sparse-checkout (boundary violation detection).
  await execAsync("git add -A --sparse", { cwd: worktreePath });

  const { stdout } = await execAsync(
    "git diff --cached --name-only HEAD",
    { cwd: worktreePath },
  );

  return stdout
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}
