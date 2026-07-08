import { readFile } from "fs/promises";
import { join } from "path";
import {
  verifyTask,
  AgentTaskSchema,
  AgentLedgerConfigSchema,
  VerificationCommandSchema,
} from "@agentledger/core";
import type { AgentTask, VerificationCommand } from "@agentledger/core";

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
 * Loads tasks from .agentledger/tasks.json and runs the verifier on the
 * first task whose worktree exists, using commands from config.json.
 *
 * Usage: agentledger verify [--task <taskId>] [--dir <path>]
 */
export async function runVerify(
  targetDir: string,
  opts: { taskId?: string } = {},
): Promise<void> {
  const root = join(targetDir, AGENTLEDGER_DIR);

  // Load config
  let config;
  try {
    const raw = await readFile(join(root, "config.json"), "utf8");
    config = AgentLedgerConfigSchema.parse(JSON.parse(raw));
  } catch {
    console.error(red("✗ Could not read .agentledger/config.json — run `agentledger init` first"));
    process.exit(1);
  }

  // Load tasks
  let tasks: AgentTask[];
  try {
    const raw = await readFile(join(root, "tasks.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown[];
    tasks = parsed.map((t) => AgentTaskSchema.parse(t));
  } catch {
    console.error(red("✗ Could not read .agentledger/tasks.json"));
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
