import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  verifyTask,
  checkFileBoundaries,
  runVerificationCommands,
  AgentTaskSchema,
  AgentLedgerConfigSchema,
  VerificationCommandSchema,
} from "@agentledger/core";
import type { AgentTask, VerificationCommand, VerificationResult } from "@agentledger/core";

const AGENTLEDGER_DIR = ".agentledger";

function colorize(text: string, code: number): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

const green = (s: string) => colorize(s, 32);
const red = (s: string) => colorize(s, 31);
const yellow = (s: string) => colorize(s, 33);
const bold = (s: string) => colorize(s, 1);
const dim = (s: string) => colorize(s, 2);

/**
 * Loads the plugin-style config (blockedFiles, testCommand) used by observed runs.
 */
function loadObservedConfig(root: string): { blockedFiles: string[]; testCommand: string } {
  try {
    const raw = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
    return {
      blockedFiles: Array.isArray(raw.blockedFiles) ? raw.blockedFiles : [],
      testCommand: typeof raw.testCommand === "string" ? raw.testCommand : "",
    };
  } catch {
    return { blockedFiles: [], testCommand: "" };
  }
}

/**
 * Runs verification in observed mode (no tasks/worktrees).
 * Checks git diff against blockedFiles, runs testCommand against cwd.
 */
async function runObservedVerify(targetDir: string): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const config = loadObservedConfig(root);

  console.log(bold("\nVerifying current project state (observed mode)"));
  console.log(dim(`  dir: ${targetDir}`));
  console.log();

  // Boundary check — use checkFileBoundaries with blockedFiles and allowedFiles: ["**"]
  const boundaryCheck = await checkFileBoundaries(targetDir, {
    allowedFiles: ["**"],
    blockedFiles: config.blockedFiles,
  });

  if (boundaryCheck.passed) {
    console.log(green("✓ Boundary check passed"));
  } else {
    console.log(red("✗ Boundary check FAILED"));
    for (const v of boundaryCheck.violations) {
      console.log(red(`    [${v.violationType}] ${v.file}`));
      console.log(dim(`      ${v.message}`));
    }
  }

  // Test command
  let commandsPassed = true;
  if (config.testCommand) {
    const commands: VerificationCommand[] = [
      { name: "test", command: config.testCommand, required: true },
    ];
    const cmdResults = await runVerificationCommands(targetDir, commands);

    console.log();
    for (const cmd of cmdResults) {
      const status = cmd.exitCode === 0 ? green("✓") : red("✗");
      const duration = dim(`(${cmd.durationMs}ms)`);
      console.log(`  ${status} ${cmd.name}: ${cmd.command} ${duration}`);
      if (cmd.exitCode !== 0) {
        commandsPassed = false;
        if (cmd.stderr) {
          for (const line of cmd.stderr.trim().split("\n").slice(0, 10)) {
            console.log(dim(`      ${line}`));
          }
        }
      }
    }
  } else {
    console.log(dim("  (no test command configured)"));
  }

  console.log();
  if (boundaryCheck.passed && commandsPassed) {
    console.log(green(bold("VERIFICATION PASSED")));
  } else {
    console.log(red(bold("VERIFICATION FAILED")));
    process.exit(1);
  }
}

/**
 * Runs verification. Two modes:
 *
 * 1. Orchestrator mode (tasks.json exists): pick a task, verify its worktree
 * 2. Observed mode (no tasks.json): boundary check + test command against cwd
 *
 * Usage: agentledger verify [--task <taskId>] [--dir <path>]
 */
export async function runVerify(
  targetDir: string,
  opts: { taskId?: string } = {},
): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);
  const tasksPath = join(root, "tasks.json");

  // If no tasks.json, run observed mode verification
  if (!existsSync(tasksPath)) {
    await runObservedVerify(targetDir);
    return;
  }

  // ── Orchestrator mode ─────────────────────────────────────────────────────

  // Load orchestrator config
  let config;
  try {
    const raw = await readFile(join(root, "config.json"), "utf8");
    config = AgentLedgerConfigSchema.parse(JSON.parse(raw));
  } catch {
    // Config might be plugin-style — fall back to observed mode
    await runObservedVerify(targetDir);
    return;
  }

  // Load tasks
  let tasks: AgentTask[];
  try {
    const raw = await readFile(tasksPath, "utf8");
    const parsed = JSON.parse(raw) as unknown[];
    tasks = parsed.map((t) => AgentTaskSchema.parse(t));
  } catch {
    console.error(red("✗ Could not parse .agentledger/tasks.json"));
    process.exit(1);
  }

  if (tasks.length === 0) {
    console.log(yellow("No tasks found in tasks.json"));
    return;
  }

  // Pick task to verify
  const task = opts.taskId
    ? tasks.find((t) => t.taskId === opts.taskId)
    : tasks.find((t) => t.status === "awaiting_verification");

  if (!task) {
    const target = opts.taskId ?? "awaiting_verification";
    console.error(red(`✗ No task found matching: ${target}`));
    process.exit(1);
  }

  // Build worktree path
  const worktreePath = join(root, "worktrees", task.taskId);

  // Build command list from config
  const commands: VerificationCommand[] = Object.entries(config.verification.commands).map(
    ([name, command]) =>
      VerificationCommandSchema.parse({
        name,
        command,
        required: config.verification.required.includes(name),
      }),
  );

  console.log(bold(`\nVerifying task: ${task.taskId}`));
  console.log(dim(`  title:    ${task.title}`));
  console.log(dim(`  worktree: ${worktreePath}`));
  console.log();

  const result = await verifyTask(worktreePath, task, commands);

  // ── Boundary check output ──────────────────────────────────────────────────
  if (result.boundaryCheck.passed) {
    console.log(green("✓ Boundary check passed"));
  } else {
    console.log(red("✗ Boundary check FAILED"));
    for (const v of result.boundaryCheck.violations) {
      console.log(red(`    [${v.violationType}] ${v.file}`));
      console.log(dim(`      ${v.message}`));
    }
  }

  // ── Command results ────────────────────────────────────────────────────────
  if (result.commandResults.length > 0) {
    console.log();
    for (const cmd of result.commandResults) {
      const status = cmd.exitCode === 0 ? green("✓") : red("✗");
      const duration = dim(`(${cmd.durationMs}ms)`);
      console.log(`  ${status} ${cmd.name} ${duration}`);
      if (cmd.exitCode !== 0 && cmd.stderr) {
        console.log(dim("    stderr:"));
        for (const line of cmd.stderr.trim().split("\n").slice(0, 10)) {
          console.log(dim(`      ${line}`));
        }
      }
    }
  } else if (result.boundaryCheck.passed) {
    console.log(dim("  (no verification commands configured)"));
  }

  // ── Final verdict ─────────────────────────────────────────────────────────
  console.log();
  if (result.passed) {
    console.log(green(bold("VERIFICATION PASSED")));
  } else {
    console.log(red(bold("VERIFICATION FAILED")));
    process.exit(1);
  }
}
