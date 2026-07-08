import type {
  AgentTask,
  VerificationCommand,
  VerificationResult,
} from "../schemas/index.js";
import { VerificationResultSchema } from "../schemas/index.js";
import { checkFileBoundaries } from "./checkBoundaries.js";
import { runVerificationCommands } from "./runCommands.js";

/**
 * Full verification pipeline for a single task:
 *  1. Check file boundaries (allowedFiles / blockedFiles)
 *  2. Run verification commands only if boundaries are clean
 *     (no point running tests in a boundary-violated worktree)
 *
 * Returns a structured VerificationResult.
 */
export async function verifyTask(
  worktreePath: string,
  task: AgentTask,
  commands: VerificationCommand[],
): Promise<VerificationResult> {
  const boundaryCheck = await checkFileBoundaries(worktreePath, task);

  // Skip command execution when boundary violations exist
  const commandResults = boundaryCheck.passed
    ? await runVerificationCommands(worktreePath, commands)
    : [];

  // Only required command failures block the task — optional failures are informational
  const commandsPassed = commandResults.every((r) => {
    const cmd = commands.find((c) => c.name === r.name);
    return !cmd?.required || r.exitCode === 0;
  });
  const passed = boundaryCheck.passed && (commandResults.length === 0 || commandsPassed);

  return VerificationResultSchema.parse({
    taskId: task.taskId,
    passed,
    boundaryCheck,
    commandResults,
  });
}
