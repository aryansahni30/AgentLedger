import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import {
  WorkerResultSchema,
  type WorkerContext,
  type WorkerResult,
} from "../schemas/index.js";

/**
 * Mock worker: deterministic, rule-based task executor.
 *
 * Used to exercise the full harness loop (worktree isolation → worker →
 * patch → verification) without requiring a real LLM. The mock:
 *
 *   1. "Reads" the task description (records filesRead)
 *   2. Writes an output file inside the worktree (records filesModified)
 *   3. Returns a structured WorkerResult to the orchestrator
 *
 * The worker does NOT commit — the orchestrator stages and generates the patch.
 * The worker does NOT write to the ledger — that is the orchestrator's job.
 */
export async function runMockWorker(context: WorkerContext): Promise<WorkerResult> {
  const { task, worktreePath } = context;
  const filesRead: string[] = [];
  const filesModified: string[] = [];

  // Simulate reading existing files that match allowedFiles
  for (const pattern of task.allowedFiles.slice(0, 2)) {
    filesRead.push(pattern);
  }

  // Write a task output file inside the worktree
  const outputRelPath = `agentledger-task-${task.taskId}.md`;
  const outputAbsPath = join(worktreePath, outputRelPath);

  await mkdir(dirname(outputAbsPath), { recursive: true });
  await writeFile(
    outputAbsPath,
    formatTaskOutput(task.title, task.description),
    "utf8",
  );
  filesModified.push(outputRelPath);

  // If an existing README exists, append a note (simulate in-place edit)
  const readmePath = join(worktreePath, "README.md");
  if (existsSync(readmePath)) {
    const existing = await readFile(readmePath, "utf8");
    await writeFile(readmePath, existing + `\n<!-- agentledger: ${task.taskId} -->\n`, "utf8");
    filesRead.push("README.md");
    filesModified.push("README.md");
  }

  return WorkerResultSchema.parse({
    taskId: task.taskId,
    summary: `Mock worker completed "${task.title}"`,
    filesRead,
    filesModified,
    worktreeBranch: `agentledger/${task.taskId}`,
    output: {
      completed: true,
      taskTitle: task.title,
      goal: task.description,
    },
  });
}

function formatTaskOutput(title: string, description: string): string {
  return [
    `# ${title}`,
    "",
    `> ${description}`,
    "",
    "## Result",
    "",
    "Task completed by mock worker.",
    `Generated: ${new Date().toISOString()}`,
    "",
  ].join("\n");
}
