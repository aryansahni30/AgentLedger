import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join, dirname, relative, isAbsolute } from "path";
import { existsSync } from "fs";
import type OpenAI from "openai";
import { getTogetherClient } from "./togetherClient.js";
import { buildWorkerSystemPrompt, buildWorkerUserMessage } from "./prompts/worker.js";
import { WorkerResultSchema, type WorkerContext, type WorkerResult } from "../schemas/index.js";

export const DEFAULT_TOGETHER_WORKER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const MAX_TOOL_CALLS = 40;

// ─── Tool definitions (OpenAI format) ────────────────────────────────────────

const WORKER_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and directories at a given path (relative to worktree root)",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the content of a file (relative path from worktree root)",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file at the given path (relative to worktree root).",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "task_complete",
      description:
        "Mark the task as complete. Call this when all changes are made. REQUIRED — the run will stall without it.",
      parameters: {
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
  },
];

// ─── Tool input types ─────────────────────────────────────────────────────────

interface ListDirInput { path: string }
interface ReadFileInput { path: string }
interface WriteFileInput { path: string; content: string }
interface TaskCompleteInput { summary: string; filesModified: string[] }

// ─── Tool execution ───────────────────────────────────────────────────────────

function safeRelativePath(worktreePath: string, rawPath: string): string {
  const rel = isAbsolute(rawPath) ? relative(worktreePath, rawPath) : rawPath;
  const abs = join(worktreePath, rel);
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
): Promise<string> {
  const rel = safeRelativePath(worktreePath, input.path);
  const abs = join(worktreePath, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, input.content, "utf8");
  filesWritten.add(rel);
  return `Written: ${rel}`;
}

// ─── Main worker function ─────────────────────────────────────────────────────

/**
 * Together AI variant of the worker tool loop.
 * Uses OpenAI-compatible chat completions with function calling.
 */
export async function runWorkerTogether(
  context: WorkerContext,
  model = DEFAULT_TOGETHER_WORKER_MODEL,
): Promise<WorkerResult> {
  const { task, worktreePath } = context;
  const client = getTogetherClient();

  const systemPrompt = buildWorkerSystemPrompt(task);
  const filesWritten = new Set<string>();
  const filesRead: string[] = [];

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildWorkerUserMessage(task) },
  ];

  let toolCallCount = 0;
  let taskCompleteResult: TaskCompleteInput | null = null;

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 8192,
      tools: WORKER_TOOLS,
      tool_choice: "auto",
      messages,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    if (choice.finish_reason === "stop" || choice.finish_reason === "length") {
      break;
    }

    if (choice.finish_reason !== "tool_calls" || !assistantMessage.tool_calls?.length) {
      break;
    }

    // Process all tool calls in this turn — only handle "function" type calls
    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;
      toolCallCount++;

      const fnName = toolCall.function.name;
      const fnArgs = toolCall.function.arguments;

      let resultContent: string;
      let parsedInput: unknown;

      try {
        parsedInput = JSON.parse(fnArgs);
      } catch {
        parsedInput = {};
        resultContent = `Error: could not parse tool arguments: ${fnArgs}`;
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultContent,
        });
        continue;
      }

      try {
        if (fnName === "list_directory") {
          resultContent = await execListDirectory(worktreePath, parsedInput as unknown as ListDirInput);
        } else if (fnName === "read_file") {
          const input = parsedInput as unknown as ReadFileInput;
          resultContent = await execReadFile(worktreePath, input);
          filesRead.push(input.path);
        } else if (fnName === "write_file") {
          resultContent = await execWriteFile(
            worktreePath,
            parsedInput as unknown as WriteFileInput,
            filesWritten,
          );
        } else if (fnName === "task_complete") {
          taskCompleteResult = parsedInput as unknown as TaskCompleteInput;
          resultContent = "Task marked complete.";
        } else {
          resultContent = `Unknown tool: ${fnName}`;
        }
      } catch (err) {
        resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultContent,
      });
    }

    if (taskCompleteResult !== null) break;
  }

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
    output: {
      taskCompleted: taskCompleteResult !== null,
      toolCallCount,
      selfReportedFilesModified: reportedModified,
      actualFilesWritten: [...filesWritten],
    },
  });
}
