import type { TaskGraph, AgentTask } from "../schemas/index.js";

export type ValidationError =
  | { type: "DUPLICATE_TASK_ID"; taskId: string }
  | { type: "MISSING_DEPENDENCY"; taskId: string; missingDep: string }
  | { type: "DEPENDENCY_CYCLE"; cycle: string[] }
  | { type: "OVERLAPPING_OWNERSHIP"; taskA: string; taskB: string; file: string };

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

export function validateTaskGraph(graph: TaskGraph): ValidationResult {
  const errors: ValidationError[] = [];

  const taskIds = new Set<string>();
  for (const task of graph.tasks) {
    if (taskIds.has(task.taskId)) {
      errors.push({ type: "DUPLICATE_TASK_ID", taskId: task.taskId });
    }
    taskIds.add(task.taskId);
  }

  for (const task of graph.tasks) {
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep)) {
        errors.push({
          type: "MISSING_DEPENDENCY",
          taskId: task.taskId,
          missingDep: dep,
        });
      }
    }
  }

  const cycle = detectCycle(graph.tasks);
  if (cycle !== null) {
    errors.push({ type: "DEPENDENCY_CYCLE", cycle });
  }

  const overlapErrors = detectOwnershipOverlap(graph.tasks);
  errors.push(...overlapErrors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Topological sort / DFS cycle detection.
 * Returns the cycle as an array of taskIds if found, null otherwise.
 */
function detectCycle(tasks: AgentTask[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const task of tasks) {
    adjacency.set(task.taskId, [...task.dependencies]);
  }

  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const task of tasks) {
    color.set(task.taskId, WHITE);
    parent.set(task.taskId, null);
  }

  let foundCycle: string[] | null = null;

  function dfs(nodeId: string): boolean {
    color.set(nodeId, GRAY);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const neighborColor = color.get(neighbor) ?? WHITE;

      if (neighborColor === GRAY) {
        // Reconstruct cycle
        const cycle: string[] = [neighbor, nodeId];
        let current = nodeId;
        while (current !== neighbor) {
          const p = parent.get(current);
          if (p === undefined || p === null) break;
          cycle.push(p);
          current = p;
        }
        foundCycle = cycle.reverse();
        return true;
      }

      if (neighborColor === WHITE) {
        parent.set(neighbor, nodeId);
        if (dfs(neighbor)) return true;
      }
    }

    color.set(nodeId, BLACK);
    return false;
  }

  for (const task of tasks) {
    if ((color.get(task.taskId) ?? WHITE) === WHITE) {
      if (dfs(task.taskId)) break;
    }
  }

  return foundCycle;
}

/**
 * For tasks that could run in parallel (no dependency between them),
 * check that their allowedFiles patterns don't literally overlap.
 * We compare exact string matches (glob pattern equality) — full minimatch
 * evaluation is post-MVP.
 */
function detectOwnershipOverlap(tasks: AgentTask[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const taskA = tasks[i];
      const taskB = tasks[j];

      if (taskA === undefined || taskB === undefined) continue;

      // Skip if one depends on the other (sequential, not parallel)
      const aDepB = taskA.dependencies.includes(taskB.taskId);
      const bDepA = taskB.dependencies.includes(taskA.taskId);
      if (aDepB || bDepA) continue;

      for (const fileA of taskA.allowedFiles) {
        for (const fileB of taskB.allowedFiles) {
          if (fileA === fileB) {
            errors.push({
              type: "OVERLAPPING_OWNERSHIP",
              taskA: taskA.taskId,
              taskB: taskB.taskId,
              file: fileA,
            });
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Returns tasks in topological order (dependencies before dependents).
 * Assumes graph has already been validated (no cycles).
 */
export function topoSort(tasks: AgentTask[]): AgentTask[] {
  const taskMap = new Map<string, AgentTask>();
  for (const task of tasks) {
    taskMap.set(task.taskId, task);
  }

  const visited = new Set<string>();
  const result: AgentTask[] = [];

  function visit(taskId: string): void {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const task = taskMap.get(taskId);
    if (task === undefined) return;

    for (const dep of task.dependencies) {
      visit(dep);
    }

    result.push(task);
  }

  for (const task of tasks) {
    visit(task.taskId);
  }

  return result;
}
