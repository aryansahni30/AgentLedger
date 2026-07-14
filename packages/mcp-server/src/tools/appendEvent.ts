import { z } from "zod";
import { LedgerWriter, LedgerEventTypeSchema } from "@agentledger/core";
import { getWriter } from "../ledger.js";

export const AppendEventInputSchema = z.object({
  run_id: z.string().describe("Run ID this event belongs to"),
  event_type: LedgerEventTypeSchema.describe("Event type"),
  actor: z.string().describe("Actor emitting the event (e.g. 'orchestrator', agent ID)"),
  payload: z.record(z.string(), z.unknown()).describe("Arbitrary event payload"),
  event_id: z.string().optional().describe("UUID for this event; auto-generated if omitted"),
  task_id: z.string().optional().describe("Task ID, if this event is task-scoped"),
});

export type AppendEventInput = z.infer<typeof AppendEventInputSchema>;

export async function appendEvent(input: AppendEventInput) {
  const writer = getWriter();
  return writer.appendEvent({
    event_id: input.event_id ?? LedgerWriter.createEventId(),
    run_id: input.run_id,
    task_id: input.task_id,
    timestamp: new Date().toISOString(),
    actor: input.actor,
    event_type: input.event_type,
    payload: input.payload,
  });
}
