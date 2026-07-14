import type { AgentTask } from "../schemas/index.js";
import { LedgerWriter } from "../ledger/LedgerWriter.js";

/**
 * Validates that a task can be reassigned.
 * Only `pending` tasks may be reassigned — tasks already running or failed
 * require separate recovery flows.
 *
 * Throws a descriptive Error on invalid input.
 */
export function validateReassignment(task: AgentTask, newOwner: string): void {
  if (!newOwner.trim()) {
    throw new Error("newOwner must be a non-empty string.");
  }
  if (task.status !== "pending") {
    throw new Error(
      `Cannot reassign task "${task.taskId}": status is "${task.status}" but must be "pending". ` +
        `Only pending tasks can be reassigned.`,
    );
  }
}

/**
 * Emits a TASK_ASSIGNED event carrying the new owner so replay can
 * reconstruct the reassignment from the ledger.
 *
 * Validates the task status before writing.
 */
export async function reassignTask(
  task: AgentTask,
  newOwner: string,
  writer: LedgerWriter,
): Promise<void> {
  validateReassignment(task, newOwner);

  await writer.appendEvent({
    event_id: LedgerWriter.createEventId(),
    run_id: task.runId,
    task_id: task.taskId,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type: "TASK_ASSIGNED",
    payload: {
      taskId: task.taskId,
      owner: newOwner,
    },
  });
}
