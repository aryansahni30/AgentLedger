import { minimatch } from "minimatch";
import { listModifiedFiles } from "../git/generatePatch.js";
import type {
  AgentTask,
  BoundaryCheckResult,
  BoundaryViolation,
} from "../schemas/index.js";
import { BoundaryCheckResultSchema } from "../schemas/index.js";

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(file, pattern, { dot: true }));
}

/**
 * Diffs the worktree against HEAD and checks every modified file against
 * the task's allowedFiles / blockedFiles patterns.
 *
 * Rules (in priority order):
 *  1. File matches blockedFiles  → BLOCKED_FILE_MODIFIED (hard violation)
 *  2. File matches allowedFiles  → OK
 *  3. File matches neither       → UNOWNED_FILE_MODIFIED (boundary violation)
 */
export async function checkFileBoundaries(
  worktreePath: string,
  task: Pick<AgentTask, "allowedFiles" | "blockedFiles">,
): Promise<BoundaryCheckResult> {
  const modifiedFiles = await listModifiedFiles(worktreePath);
  const violations: BoundaryViolation[] = [];

  for (const file of modifiedFiles) {
    if (matchesAny(file, task.blockedFiles)) {
      violations.push({
        violationType: "BLOCKED_FILE_MODIFIED",
        file,
        message: `"${file}" matches a blocked pattern and must not be modified`,
      });
    } else if (!matchesAny(file, task.allowedFiles)) {
      violations.push({
        violationType: "UNOWNED_FILE_MODIFIED",
        file,
        message: `"${file}" is outside the task's allowedFiles scope`,
      });
    }
  }

  return BoundaryCheckResultSchema.parse({
    passed: violations.length === 0,
    violations,
  });
}
