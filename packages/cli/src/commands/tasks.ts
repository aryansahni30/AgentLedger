import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { TaskGraphSchema } from "@agentledger/core";

const AGENTLEDGER_DIR = ".agentledger";

const STATUS_COLORS: Record<string, string> = {
  pending: "\x1b[33m",          // yellow
  assigned: "\x1b[36m",         // cyan
  running: "\x1b[34m",          // blue
  awaiting_verification: "\x1b[35m", // magenta
  completed: "\x1b[32m",        // green
  failed: "\x1b[31m",           // red
};

const RESET = "\x1b[0m";

function colorStatus(status: string): string {
  const color = STATUS_COLORS[status] ?? "";
  return `${color}${status}${RESET}`;
}

export async function runTasksView(targetDir: string = process.cwd()): Promise<void> {
  const tasksPath = join(targetDir, AGENTLEDGER_DIR, "tasks.json");

  if (!existsSync(tasksPath)) {
    console.error(`No tasks.json found. Run 'agentledger init' first.`);
    process.exit(1);
  }

  const raw = await readFile(tasksPath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  // tasks.json stores either an array of tasks or a TaskGraph object
  const tasks = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)["tasks"] ?? [];

  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.log("No tasks found. Run 'agentledger run' to create a task graph.");
    return;
  }

  // Validate via TaskGraph schema (wrapping in object if needed)
  const graphRaw = Array.isArray(parsed)
    ? { runId: "unknown", tasks: parsed }
    : parsed;

  const graph = TaskGraphSchema.parse(graphRaw);

  console.log(`\nTask Graph — Run: ${graph.runId}`);
  console.log("─".repeat(60));

  for (const task of graph.tasks) {
    const deps =
      task.dependencies.length > 0
        ? `deps: [${task.dependencies.join(", ")}]`
        : "no deps";

    console.log(`\n  ${task.taskId}`);
    console.log(`  Title:   ${task.title}`);
    console.log(`  Owner:   ${task.owner}`);
    console.log(`  Status:  ${colorStatus(task.status)}`);
    console.log(`  Deps:    ${deps}`);
    console.log(
      `  Files:   allowed=${task.allowedFiles.length} blocked=${task.blockedFiles.length}`,
    );
  }

  console.log("\n" + "─".repeat(60));
  console.log(`Total: ${graph.tasks.length} task(s)\n`);
}
