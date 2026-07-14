import { z } from "zod";
import { LedgerEventTypeSchema } from "@agentledger/core";
import { getReader } from "../ledger.js";

export const QueryLedgerInputSchema = z.object({
  run_id: z.string().optional().describe("Filter by run ID"),
  task_id: z.string().optional().describe("Filter by task ID"),
  event_type: LedgerEventTypeSchema.optional().describe("Filter by event type"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe("Max number of events to return (newest-first within the filtered set; default 100)"),
});

export type QueryLedgerInput = z.infer<typeof QueryLedgerInputSchema>;

export async function queryLedger(input: QueryLedgerInput) {
  const reader = getReader();
  let events = await reader.readAll();

  if (input.run_id !== undefined) {
    events = events.filter((e) => e.run_id === input.run_id);
  }
  if (input.task_id !== undefined) {
    events = events.filter((e) => e.task_id === input.task_id);
  }
  if (input.event_type !== undefined) {
    events = events.filter((e) => e.event_type === input.event_type);
  }

  // Return the last N events (most recent within the filtered set)
  return events.slice(-input.limit);
}
