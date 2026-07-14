import { z } from "zod";
import { LedgerWriter, replayLedger } from "@agentledger/core";
import { getReader, getWriter } from "../ledger.js";

export const ClaimTaskInputSchema = z.object({
  task_id: z.string().describe("Task ID to claim"),
  agent_id: z.string().describe("ID of the agent claiming this task (becomes the actor)"),
  run_id: z.string().optional().describe("Run ID — inferred from ledger if omitted"),
});

export type ClaimTaskInput = z.infer<typeof ClaimTaskInputSchema>;

export async function claimTask(input: ClaimTaskInput) {
  const reader = getReader();
  const allEvents = await reader.readAll();

  // Infer run_id from the task's own events
  const taskEvents = allEvents.filter((e) => e.task_id === input.task_id);
  if (taskEvents.length === 0) {
    throw new Error(`Task "${input.task_id}" not found in ledger`);
  }

  const runId = input.run_id ?? taskEvents[0]!.run_id;
  const state = replayLedger(allEvents, runId);
  const task = state.tasks.find((t) => t.taskId === input.task_id);

  if (!task) {
    throw new Error(`Task "${input.task_id}" not found in run "${runId}"`);
  }

  if (task.status !== "pending") {
    throw new Error(
      `Task "${input.task_id}" cannot be claimed — current status: "${task.status}"`,
    );
  }

  const writer = getWriter();
  const event = await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: runId,
    task_id: input.task_id,
    timestamp: new Date().toISOString(),
    actor: input.agent_id,
    event_type: "TASK_ASSIGNED",
    payload: { owner: input.agent_id },
  });

  return {
    task: { ...task, status: "assigned" as const },
    event,
  };
}
