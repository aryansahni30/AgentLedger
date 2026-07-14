import { z } from "zod";
import { replayLedger } from "@agentledger/core";
import { getReader } from "../ledger.js";

export const GetTaskInputSchema = z.object({
  task_id: z.string().describe("Task ID to retrieve"),
  run_id: z.string().optional().describe("Run ID — inferred from ledger if omitted"),
});

export type GetTaskInput = z.infer<typeof GetTaskInputSchema>;

export async function getTask(input: GetTaskInput) {
  const reader = getReader();
  const allEvents = await reader.readAll();

  // Find events scoped to this task_id to infer run_id
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

  return task;
}
