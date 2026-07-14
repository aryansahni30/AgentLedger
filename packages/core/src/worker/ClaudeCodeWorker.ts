import { spawn } from "child_process";
import { WorkerResultSchema, type AgentTask, type WorkerContext, type WorkerResult } from "../schemas/index.js";

// ─── JSON schema sent to --json-schema ────────────────────────────────────────

const CLAUDE_CODE_RESULT_SCHEMA = {
  type: "object",
  description: "Report what you did after completing all work",
  properties: {
    summary: {
      type: "string",
      description: "Concise summary of what was accomplished",
    },
    filesModified: {
      type: "array",
      items: { type: "string" },
      description: "Relative paths (from repo root) of files you created or modified",
    },
    filesRead: {
      type: "array",
      items: { type: "string" },
      description: "Relative paths of files you read",
    },
  },
  required: ["summary", "filesModified", "filesRead"],
} as const;

// ─── Claude Code output envelope ──────────────────────────────────────────────

interface ClaudeCodeEnvelope {
  type: string;
  subtype?: string;
  is_error: boolean;
  result: string;
  structured_output?: {
    summary?: string;
    filesModified?: string[];
    filesRead?: string[];
    [key: string]: unknown;
  };
  session_id: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ClaudeCodeWorkerOpts {
  /** Override Claude Code binary path. Defaults to "claude" on PATH. */
  claudeCodePath?: string;
  /** Model to pass via --model. Omit to use Claude Code's configured default. */
  model?: string;
  /** Hard budget cap in USD (passed via --max-budget-usd). */
  maxBudgetUsd?: number;
  /**
   * Extra tools to block via --disallowedTools.
   * Defaults to blocking web search and web fetch so the worker
   * stays focused on local edits.
   */
  disallowedTools?: string[];
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildConstraintSystemPrompt(task: AgentTask): string {
  const allowed =
    task.allowedFiles.length > 0
      ? task.allowedFiles.map((f) => `  - ${f}`).join("\n")
      : "  (no explicit file restriction — use good judgement)";

  const blocked =
    task.blockedFiles.length > 0
      ? task.blockedFiles.map((f) => `  - ${f}`).join("\n")
      : "  (none specified)";

  return `
=== AgentLedger Task Constraints ===

You are operating as an isolated worker inside AgentLedger, an orchestration harness
that enforces file boundary checks after you finish. A separate verifier will diff
your changes against the allowed files list and REJECT the patch if you touch files
outside your scope.

TASK ID   : ${task.taskId}
TASK TITLE: ${task.title}

FILES YOU MAY MODIFY:
${allowed}

FILES YOU MUST NOT TOUCH:
${blocked}

RULES:
1. Only read and modify files within your allowed scope.
2. Do not install packages globally — make only local changes.
3. Run any necessary build or test commands to verify your work.
4. When your work is complete, your FINAL response must be the JSON object
   described in the output schema (summary + filesModified + filesRead).
   Do not add any prose after the JSON.

=== End of AgentLedger Constraints ===
`.trim();
}

function buildTaskUserPrompt(task: AgentTask): string {
  return `## Task: ${task.title}

${task.description}

${
  task.successCriteria.length > 0
    ? `### Success criteria\n${task.successCriteria.map((c) => `- ${c}`).join("\n")}`
    : ""
}

Complete this task now. When done, return the structured JSON result.`.trim();
}

// ─── Process helpers ──────────────────────────────────────────────────────────

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function spawnAndCapture(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      // Inherit env so Claude Code can find its auth credentials
      env: process.env,
      // stdio: pipe stdout/stderr, inherit stdin (never blocks in -p mode)
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

// ─── Output parsing ───────────────────────────────────────────────────────────

interface StructuredResult {
  summary: string;
  filesModified: string[];
  filesRead: string[];
}

function parseClaudeCodeOutput(
  rawStdout: string,
  taskId: string,
): StructuredResult {
  // Try to parse the outer JSON envelope first
  let envelope: ClaudeCodeEnvelope | null = null;
  try {
    // stdout may have a trailing newline or hook output on subsequent lines;
    // take only the first line that looks like JSON
    const firstJson = rawStdout.split("\n").find((l) => l.trim().startsWith("{"));
    if (firstJson) {
      envelope = JSON.parse(firstJson) as ClaudeCodeEnvelope;
    }
  } catch {
    // fall through to text extraction
  }

  // Prefer structured_output (set when --json-schema is used)
  if (envelope?.structured_output) {
    const s = envelope.structured_output;
    return {
      summary: typeof s.summary === "string" ? s.summary : `Task ${taskId} completed`,
      filesModified: Array.isArray(s.filesModified) ? (s.filesModified as string[]) : [],
      filesRead: Array.isArray(s.filesRead) ? (s.filesRead as string[]) : [],
    };
  }

  // Fallback: try to parse result field as JSON
  if (envelope?.result) {
    try {
      const inner = JSON.parse(envelope.result) as StructuredResult;
      if (inner.summary) return inner;
    } catch {
      // not JSON — use as plain summary
      return {
        summary: envelope.result.slice(0, 500),
        filesModified: [],
        filesRead: [],
      };
    }
  }

  // Last resort: raw text summary
  return {
    summary: rawStdout.slice(0, 500) || `Task ${taskId} completed (no structured output)`,
    filesModified: [],
    filesRead: [],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs a Claude Code CLI subprocess as the AgentLedger worker.
 *
 * This replaces the custom LLM loop in workerLLM.ts with a full Claude Code
 * session that uses the user's existing Claude Code authentication, all
 * built-in tools (Bash, Edit, Read, Write, etc.), and runs inside the
 * isolated git worktree. The post-hoc verifier still diffs the branch and
 * enforces boundary constraints independently of what the worker reports.
 *
 * Usage via CLI: agentledger run "goal" --worker claude-code
 */
export async function runClaudeCodeWorker(
  context: WorkerContext,
  opts: ClaudeCodeWorkerOpts = {},
): Promise<WorkerResult> {
  const { task, worktreePath } = context;
  const claudeCmd = opts.claudeCodePath ?? "claude";

  const constraintPrompt = buildConstraintSystemPrompt(task);
  const userPrompt = buildTaskUserPrompt(task);

  const defaultDisallowed = ["WebSearch", "WebFetch"];
  const disallowed = opts.disallowedTools ?? defaultDisallowed;

  const args: string[] = [
    "--print", userPrompt,
    "--append-system-prompt", constraintPrompt,
    "--output-format", "json",
    "--json-schema", JSON.stringify(CLAUDE_CODE_RESULT_SCHEMA),
    "--dangerously-skip-permissions",
    "--no-session-persistence",
  ];

  if (opts.model) {
    args.push("--model", opts.model);
  }

  if (opts.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  }

  if (disallowed.length > 0) {
    args.push("--disallowedTools", disallowed.join(","));
  }

  const { stdout, stderr, exitCode } = await spawnAndCapture(claudeCmd, args, worktreePath);

  // A non-zero exit code with no stdout is a hard failure (e.g. claude not found)
  if (exitCode !== 0 && !stdout.trim()) {
    throw new Error(
      `Claude Code worker exited with code ${exitCode}.\nstderr: ${stderr.slice(0, 500)}`,
    );
  }

  const structured = parseClaudeCodeOutput(stdout, task.taskId);

  return WorkerResultSchema.parse({
    taskId: task.taskId,
    summary: structured.summary,
    filesRead: structured.filesRead,
    filesModified: structured.filesModified,
    worktreeBranch: `agentledger/${task.taskId}`,
    toolDenials: [],
    output: {
      taskCompleted: true,
      workerType: "claude-code",
      exitCode,
    },
  });
}
