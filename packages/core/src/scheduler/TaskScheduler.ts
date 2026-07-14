import type { AgentTask } from "../schemas/index.js";

export type SchedulerTaskStatus = "pending" | "running" | "completed" | "failed";

export interface SchedulerStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

/**
 * Tracks task readiness based on dependency completion.
 * Single responsibility: who is ready to run, who is done.
 *
 * Invariants:
 * - Tasks become ready only when ALL dependencies are "completed".
 * - When a task fails, all transitive dependents are immediately marked "failed".
 * - isDone() returns true only when no task is "pending" or "running".
 */
export class TaskScheduler {
  private readonly tasks: Map<string, AgentTask>;
  private readonly statuses: Map<string, SchedulerTaskStatus>;
  /** Map from taskId → set of taskIds that directly depend on it */
  private readonly dependents: Map<string, Set<string>>;

  constructor(tasks: AgentTask[]) {
    this.tasks = new Map(tasks.map((t) => [t.taskId, t]));
    this.statuses = new Map(tasks.map((t) => [t.taskId, "pending"]));
    this.dependents = buildDependentIndex(tasks);
  }

  getStatus(taskId: string): SchedulerTaskStatus {
    const status = this.statuses.get(taskId);
    if (status === undefined) {
      throw new Error(`Unknown taskId: "${taskId}"`);
    }
    return status;
  }

  getReadyTasks(): AgentTask[] {
    const ready: AgentTask[] = [];
    for (const [taskId, status] of this.statuses) {
      if (status !== "pending") continue;
      const task = this.tasks.get(taskId)!;
      if (this.allDepsCompleted(task)) {
        ready.push(task);
      }
    }
    return ready;
  }

  isDone(): boolean {
    for (const status of this.statuses.values()) {
      if (status === "pending" || status === "running") return false;
    }
    return true;
  }

  markRunning(taskId: string): void {
    this.assertKnown(taskId);
    this.statuses.set(taskId, "running");
  }

  markCompleted(taskId: string): void {
    this.assertKnown(taskId);
    this.statuses.set(taskId, "completed");
  }

  markFailed(taskId: string): void {
    this.assertKnown(taskId);
    this.cascadeFail(taskId);
  }

  getStats(): SchedulerStats {
    const stats: SchedulerStats = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const status of this.statuses.values()) {
      stats[status]++;
    }
    return stats;
  }

  // ─── private helpers ─────────────────────────────────────────────────────────

  private allDepsCompleted(task: AgentTask): boolean {
    return task.dependencies.every(
      (depId) => this.statuses.get(depId) === "completed",
    );
  }

  private cascadeFail(taskId: string): void {
    // BFS to mark the failed task and all transitive dependents as failed
    const queue: string[] = [taskId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentStatus = this.statuses.get(current);
      if (currentStatus === "completed") continue; // completed tasks are not cascaded
      this.statuses.set(current, "failed");
      const deps = this.dependents.get(current);
      if (deps) {
        for (const dep of deps) {
          if (this.statuses.get(dep) !== "completed" && this.statuses.get(dep) !== "failed") {
            queue.push(dep);
          }
        }
      }
    }
  }

  private assertKnown(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown taskId: "${taskId}"`);
    }
  }
}

function buildDependentIndex(tasks: AgentTask[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      let set = index.get(depId);
      if (!set) {
        set = new Set();
        index.set(depId, set);
      }
      set.add(task.taskId);
    }
  }
  return index;
}
