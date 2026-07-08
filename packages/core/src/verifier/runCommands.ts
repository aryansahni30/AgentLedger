import { exec } from "child_process";
import { promisify } from "util";
import type { VerificationCommand, CommandResult } from "../schemas/index.js";
import { CommandResultSchema } from "../schemas/index.js";

const execAsync = promisify(exec);

/**
 * Runs a single verification command in the given working directory.
 * Captures exit code, stdout, stderr, and wall-clock duration.
 * Never throws — failed commands return exit code 1+ in the result.
 */
async function runCommand(
  cmd: VerificationCommand,
  cwd: string,
): Promise<CommandResult> {
  const startMs = Date.now();
  let exitCode = 0;
  let stdout = "";
  let stderr = "";

  try {
    const result = await execAsync(cmd.command, { cwd });
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = 0;
  } catch (err: unknown) {
    // execAsync rejects on non-zero exit — the error carries stdout/stderr/code
    const execErr = err as { code?: number; stdout?: string; stderr?: string };
    exitCode = execErr.code ?? 1;
    stdout = execErr.stdout ?? "";
    stderr = execErr.stderr ?? "";
  }

  return CommandResultSchema.parse({
    name: cmd.name,
    command: cmd.command,
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - startMs,
  });
}

/**
 * Runs all verification commands sequentially in the worktree directory.
 * Returns results for every command, regardless of pass/fail.
 * Stops early if a required command fails (short-circuit).
 */
export async function runVerificationCommands(
  worktreePath: string,
  commands: VerificationCommand[],
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];

  for (const cmd of commands) {
    const result = await runCommand(cmd, worktreePath);
    results.push(result);

    if (cmd.required && result.exitCode !== 0) {
      break;
    }
  }

  return results;
}
