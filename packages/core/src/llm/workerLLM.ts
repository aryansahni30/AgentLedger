import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join, dirname, relative, isAbsolute } from "path";
import { existsSync } from "fs";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./client.js";
import { buildWorkerSystemPrompt, buildWorkerUserMessage } from "./prompts/worker.js";
import {
  WorkerResultSchema,
  type WorkerContext,
  type WorkerResult,
  type ToolDenial,
  type PriorTaskContext,
} from "../schemas/index.js";
import { LedgerWriter } from "../ledger/LedgerWriter.js";
import { checkWritePermission } from "./writeBoundaryGuard.js";

export const DEFAULT_WORKER_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_CALLS = 40;

// ─── Tool definitions ─────────────────────────────────────────────────────────

const WORKER_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_directory",
    description: "List files and directories at a given path (relative to worktree root)",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to worktree root (use '.' for root)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description: "Read the content of a file (relative path from worktree root)",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to worktree root",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file at the given path (relative to worktree root).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to worktree root",
        },
        content: {
          type: "string",
          description: "Full content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "task_complete",
    description:
      "Mark the task as complete. Call this when all changes are made. REQUIRED — the run will stall without it.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of what was done",
        },
        filesModified: {
          type: "array",
          items: { type: "string" },
          description: "Relative paths of files you wrote (not read)",
        },
      },
      required: ["summary", "filesModified"],
    },
  },
];

// ─── Tool input types ─────────────────────────────────────────────────────────

interface ListDirInput { path: string }
interface ReadFileInput { path: string }
interface WriteFileInput { path: string; content: string }
interface TaskCompleteInput { summary: string; filesModified: string[] }

// ─── Ledger opts for real-time TOOL_DENIED emission ──────────────────────────

export interface WorkerLedgerOpts {
  writer: LedgerWriter;
  runId: string;
  taskId: string;
}

// ─── Tool execution ───────────────────────────────────────────────────────────

function safeRelativePath(worktreePath: string, rawPath: string): string {
  // Normalise to relative, then resolve back to absolute for safety
  const rel = isAbsolute(rawPath) ? relative(worktreePath, rawPath) : rawPath;
  const abs = join(worktreePath, rel);
  // Reject path traversal attempts
  if (!abs.startsWith(worktreePath)) {
    throw new Error(`Path '${rawPath}' is outside the worktree`);
  }
  return rel;
}

async function execListDirectory(worktreePath: string, input: ListDirInput): Promise<string> {
  const rel = safeRelativePath(worktreePath, input.path);
  const abs = join(worktreePath, rel);
  if (!existsSync(abs)) {
    return `Directory not found: ${input.path}`;
  }
  const entries = await readdir(abs, { withFileTypes: true });
  const lines = entries.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`);
  return lines.length > 0 ? lines.join("\n") : "(empty directory)";
}

async function execReadFile(worktreePath: string, input: ReadFileInput): Promise<string> {
  const rel = safeRelativePath(worktreePath, input.path);
  const abs = join(worktreePath, rel);
  if (!existsSync(abs)) {
    return `File not found: ${input.path}`;
  }
  return readFile(abs, "utf8");
}

async function execWriteFile(
  worktreePath: string,
  input: WriteFileInput,
  filesWritten: Set<string>,
  allowedFiles: string[],
  blockedFiles: string[],
  toolDenials: ToolDenial[],
  ledgerOpts?: WorkerLedgerOpts,
): Promise<string> {
  const rel = safeRelativePath(worktreePath, input.path);

  const permission = checkWritePermission(rel, allowedFiles, blockedFiles);
  if (permission.denied) {
    const denial: ToolDenial = {
      toolName: "write_file",
      path: rel,
      reason: permission.reason,
      violationType: permission.violationType,
    };
    toolDenials.push(denial);

    if (ledgerOpts) {
      await ledgerOpts.writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: ledgerOpts.runId,
        task_id: ledgerOpts.taskId,
        timestamp: new Date().toISOString(),
        actor: "worker",
        event_type: "TOOL_DENIED",
        payload: {
          toolName: "write_file",
          path: rel,
          reason: permission.reason,
          violationType: permission.violationType,
        },
      });
    }

    return permission.reason;
  }

  const abs = join(worktreePath, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, input.content, "utf8");
  filesWritten.add(rel);
  return `Written: ${rel}`;
}

// ─── Main worker function ─────────────────────────────────────────────────────

/**
 * Runs the LLM worker tool loop. The model reads the repo, makes changes,
 * and calls `task_complete` to finish. Returns a WorkerResult.
 *
 * Phase B: write_file attempts are boundary-checked BEFORE disk write.
 * Blocked writes are denied immediately, emitting a TOOL_DENIED event to the
 * ledger in real-time (if ledgerOpts provided). The model sees the denial
 * message and can course-correct within the same task.
 *
 * The post-hoc verifier still runs independently — prevention + detection
 * are both required.
 */
export async function runWorkerLLM(
  context: WorkerContext,
  model = DEFAULT_WORKER_MODEL,
  ledgerOpts?: WorkerLedgerOpts,
  priorContext?: PriorTaskContext[],
): Promise<WorkerResult> {
  const { task, worktreePath } = context;
  const client = getAnthropicClient();

  const systemPrompt = buildWorkerSystemPrompt(task, priorContext);
  const filesWritten = new Set<string>();
  const filesRead: string[] = [];
  const toolDenials: ToolDenial[] = [];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildWorkerUserMessage(task) },
  ];

  let toolCallCount = 0;
  let taskCompleteResult: TaskCompleteInput | null = null;

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      tools: WORKER_TOOLS,
      messages,
    });

    // Append assistant turn
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      break;
    }

    if (response.stop_reason !== "tool_use") {
      break;
    }

    // Process all tool calls in this turn
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolCallCount++;

      let resultContent: string;

      try {
        if (block.name === "list_directory") {
          resultContent = await execListDirectory(worktreePath, block.input as ListDirInput);
        } else if (block.name === "read_file") {
          const input = block.input as ReadFileInput;
          resultContent = await execReadFile(worktreePath, input);
          filesRead.push((block.input as ReadFileInput).path);
        } else if (block.name === "write_file") {
          resultContent = await execWriteFile(
            worktreePath,
            block.input as WriteFileInput,
            filesWritten,
            task.allowedFiles,
            task.blockedFiles,
            toolDenials,
            ledgerOpts,
          );
        } else if (block.name === "task_complete") {
          taskCompleteResult = block.input as TaskCompleteInput;
          resultContent = "Task marked complete.";
        } else {
          resultContent = `Unknown tool: ${block.name}`;
        }
      } catch (err) {
        resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
      });

      if (taskCompleteResult !== null) break;
    }

    messages.push({ role: "user", content: toolResults });

    if (taskCompleteResult !== null) break;
  }

  // Build WorkerResult from what actually happened
  const summary =
    taskCompleteResult?.summary ??
    `Worker reached max tool calls (${MAX_TOOL_CALLS}) without calling task_complete`;

  const reportedModified = taskCompleteResult?.filesModified ?? [...filesWritten];

  return WorkerResultSchema.parse({
    taskId: task.taskId,
    summary,
    filesRead,
    filesModified: reportedModified,
    worktreeBranch: `agentledger/${task.taskId}`,
    toolDenials,
    output: {
      taskCompleted: taskCompleteResult !== null,
      toolCallCount,
      selfReportedFilesModified: reportedModified,
      actualFilesWritten: [...filesWritten],
      toolDenialCount: toolDenials.length,
    },
  });
}
