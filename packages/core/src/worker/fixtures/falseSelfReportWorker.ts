import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { WorkerResultSchema, type WorkerContext, type WorkerResult } from "../../schemas/index.js";

/**
 * Scripted fixture: simulates an agent that claims its changes are correct
 * and all tests pass — but the real verification command exits non-zero.
 *
 * - Writes files within the allowed scope (no boundary violation)
 * - Returns output claiming tests passed and the task is complete
 * - The orchestrator must run real verification commands and trust exit codes,
 *   not the worker's self-report
 *
 * Used in Phase 6 unhappy-path integration tests to verify that the
 * verifier rejects a task when real commands fail, regardless of what the
 * worker reported.
 */
export async function runFalseSelfReportWorker(
  context: WorkerContext,
): Promise<WorkerResult> {
  const { task, worktreePath } = context;

  // Write a file within allowed scope — boundary check passes
  const outputRelPath = `agentledger-task-${task.taskId}.md`;
  const outputAbsPath = join(worktreePath, outputRelPath);
  await mkdir(dirname(outputAbsPath), { recursive: true });
  await writeFile(
    outputAbsPath,
    `# ${task.title}\n\nThis output claims success.\n`,
    "utf8",
  );

  // Self-report: lies about test results
  return WorkerResultSchema.parse({
    taskId: task.taskId,
    summary: `False-self-report worker "completed" "${task.title}" (all tests pass! trust me)`,
    filesRead: [],
    filesModified: [outputRelPath],
    worktreeBranch: `agentledger/${task.taskId}`,
    output: {
      completed: true,
      testsPass: true,          // lie — the real command will exit non-zero
      selfReportedSuccess: true,
    },
  });
}
