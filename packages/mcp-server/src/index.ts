#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendEvent, AppendEventInputSchema } from "./tools/appendEvent.js";
import { getTask, GetTaskInputSchema } from "./tools/getTask.js";
import { claimTask, ClaimTaskInputSchema } from "./tools/claimTask.js";
import { queryLedger, QueryLedgerInputSchema } from "./tools/queryLedger.js";
import { getRunSummary, GetRunSummaryInputSchema } from "./tools/getRunSummary.js";

const server = new McpServer({
  name: "agentledger-mcp",
  version: "0.1.0",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorContent(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

// ── Tool: append_event ────────────────────────────────────────────────────────

server.tool(
  "append_event",
  "Write a new hash-chained event to the AgentLedger ledger (orchestrator only). " +
    "Returns the full event including computed hash and previous_hash.",
  AppendEventInputSchema.shape,
  async (args) => {
    try {
      const event = await appendEvent(AppendEventInputSchema.parse(args));
      return { content: [{ type: "text" as const, text: toText(event) }] };
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ── Tool: get_task ────────────────────────────────────────────────────────────

server.tool(
  "get_task",
  "Read a task by task_id. Returns the current AgentTask (title, description, status, " +
    "allowedFiles, blockedFiles, etc.) reconstructed via ledger replay. " +
    "run_id is inferred from the ledger if omitted.",
  GetTaskInputSchema.shape,
  async (args) => {
    try {
      const task = await getTask(GetTaskInputSchema.parse(args));
      return { content: [{ type: "text" as const, text: toText(task) }] };
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ── Tool: claim_task ──────────────────────────────────────────────────────────

server.tool(
  "claim_task",
  "Atomically claim a pending task for a worker agent. Emits a TASK_ASSIGNED event " +
    "and returns the updated task (status: 'assigned') plus the emitted event. " +
    "Fails if the task is not in 'pending' status.",
  ClaimTaskInputSchema.shape,
  async (args) => {
    try {
      const result = await claimTask(ClaimTaskInputSchema.parse(args));
      return { content: [{ type: "text" as const, text: toText(result) }] };
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ── Tool: query_ledger ────────────────────────────────────────────────────────

server.tool(
  "query_ledger",
  "Filter ledger events by run_id, task_id, and/or event_type. " +
    "Returns the last `limit` matching events in append order (default 100, max 1000).",
  QueryLedgerInputSchema.shape,
  async (args) => {
    try {
      const events = await queryLedger(QueryLedgerInputSchema.parse(args));
      return { content: [{ type: "text" as const, text: toText(events) }] };
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ── Tool: get_run_summary ─────────────────────────────────────────────────────

server.tool(
  "get_run_summary",
  "Return the current RunState (status, goal, tasks, filesModified, startedAt, completedAt) " +
    "reconstructed from ledger replay for the given run_id.",
  GetRunSummaryInputSchema.shape,
  async (args) => {
    try {
      const state = await getRunSummary(GetRunSummaryInputSchema.parse(args));
      return { content: [{ type: "text" as const, text: toText(state) }] };
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
