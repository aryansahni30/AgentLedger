import type { LedgerEvent, AgentTask, PriorTaskContext } from "../schemas/index.js";

/**
 * Pure function — builds prior-task context for a worker prompt.
 *
 * Reads PATCH_PROPOSED events for each task this task depends on.
 * The worker can then understand what upstream tasks already changed
 * and avoid duplicating or undoing that work.
 *
 * Returns an empty array when the task has no dependencies or when
 * no upstream tasks have emitted PATCH_PROPOSED yet.
 */
export function buildPriorTaskContext(
  events: LedgerEvent[],
  task: AgentTask,
): PriorTaskContext[] {
  if (task.dependencies.length === 0) return [];

  const depSet = new Set(task.dependencies);

  // Build title map from TASK_CREATED events
  const titleByTaskId = new Map<string, string>();
  for (const event of events) {
    if (event.run_id !== task.runId) continue;
    if (event.event_type !== "TASK_CREATED") continue;
    const taskId = resolveTaskId(event);
    if (taskId && depSet.has(taskId)) {
      titleByTaskId.set(
        taskId,
        typeof event.payload["title"] === "string" ? event.payload["title"] : taskId,
      );
    }
  }

  // Take the latest PATCH_PROPOSED per dependency task
  const latestPatch = new Map<string, LedgerEvent>();
  for (const event of events) {
    if (event.run_id !== task.runId) continue;
    if (event.event_type !== "PATCH_PROPOSED") continue;
    const taskId = resolveTaskId(event);
    if (taskId && depSet.has(taskId)) {
      latestPatch.set(taskId, event);
    }
  }

  const result: PriorTaskContext[] = [];
  for (const depId of task.dependencies) {
    const patch = latestPatch.get(depId);
    if (!patch) continue;
    result.push({
      taskId: depId,
      title: titleByTaskId.get(depId) ?? depId,
      summary:
        typeof patch.payload["summary"] === "string" ? patch.payload["summary"] : "",
      filesModified: Array.isArray(patch.payload["filesModified"])
        ? (patch.payload["filesModified"] as string[])
        : [],
    });
  }

  return result;
}

function resolveTaskId(event: LedgerEvent): string | undefined {
  return (
    event.task_id ??
    (typeof event.payload["taskId"] === "string" ? event.payload["taskId"] : undefined)
  );
}
