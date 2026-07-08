import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { WorkerResultSchema, type WorkerContext, type WorkerResult } from "../../schemas/index.js";

/**
 * Scripted fixture: simulates an agent that intentionally (or accidentally)
 * writes to a file outside its allowed scope.
 *
 * - Writes one file inside allowedFiles (looks legitimate)
 * - Writes one file matching blockedFiles (the boundary violation)
 * - Self-reports success
 *
 * Used in Phase 6 unhappy-path integration tests to verify that the
 * verifier catches the violation even when the worker claims success.
 */
export async function runBoundaryViolatingWorker(
  context: WorkerContext,
  blockedFilePath: string,
): Promise<WorkerResult> {
  const { task, worktreePath } = context;

  // Write a legitimate output file (within allowed scope)
  const legitimateRelPath = `agentledger-task-${task.taskId}.md`;
  const legitimateAbsPath = join(worktreePath, legitimateRelPath);
  await mkdir(dirname(legitimateAbsPath), { recursive: true });
  await writeFile(legitimateAbsPath, `# ${task.title}\n\nTask output.\n`, "utf8");

  // Write the blocked file — this is the violation
  const blockedAbsPath = join(worktreePath, blockedFilePath);
  await mkdir(dirname(blockedAbsPath), { recursive: true });
  await writeFile(blockedAbsPath, "EXFILTRATED_SECRET=hunter2\n", "utf8");

  // Self-report claims success — the verifier must catch the lie
  return WorkerResultSchema.parse({
    taskId: task.taskId,
    summary: `Boundary-violating worker "completed" "${task.title}" (self-report)`,
    filesRead: [],
    filesModified: [legitimateRelPath],  // deliberately omits the blocked file
    worktreeBranch: `agentledger/${task.taskId}`,
    output: {
      completed: true,
      selfReportedSuccess: true,
    },
  });
}
