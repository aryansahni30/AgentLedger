import type {
  LedgerEvent,
  RunState,
  RunStatus,
  AgentTask,
  TaskStatus,
} from "../schemas/index.js";
import { RunStateSchema } from "../schemas/index.js";

// Valid forward-only status transitions for a run
const VALID_RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  created: ["planning", "failed"],
  planning: ["executing", "failed"],
  executing: ["verifying", "completed", "failed"],
  verifying: ["executing", "completed", "failed"],
  completed: [],
  failed: [],
};

// Valid forward-only status transitions for a task
const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["assigned", "failed"],
  assigned: ["running", "failed"],
  running: ["awaiting_verification", "completed", "failed"],
  awaiting_verification: ["completed", "failed"],
  completed: [],
  failed: [],
};

export class RunReplayError extends Error {
  constructor(
    message: string,
    public readonly eventIndex: number,
    public readonly eventType: string,
  ) {
    super(message);
    this.name = "RunReplayError";
  }
}

function assertRunTransition(
  current: RunStatus,
  next: RunStatus,
  index: number,
  eventType: string,
): void {
  if (!VALID_RUN_TRANSITIONS[current].includes(next)) {
    throw new RunReplayError(
      `Invalid run state transition: "${current}" → "${next}" (event ${index}: ${eventType})`,
      index,
      eventType,
    );
  }
}

function assertTaskTransition(
  taskId: string,
  current: TaskStatus,
  next: TaskStatus,
  index: number,
  eventType: string,
): void {
  if (!VALID_TASK_TRANSITIONS[current].includes(next)) {
    throw new RunReplayError(
      `Invalid task status transition for "${taskId}": "${current}" → "${next}" (event ${index}: ${eventType})`,
      index,
      eventType,
    );
  }
}

/**
 * Pure function — reconstructs RunState from a sequence of ledger events
 * for a given runId. Events for other runs are ignored.
 *
 * Throws RunReplayError on invalid state transitions (append-only violation).
 *
 * NOTE: "replay" means *reconstructing state*, not re-executing agents.
 * LLM agents are not deterministic; the *protocol* is.
 */
export function replayLedger(events: LedgerEvent[], runId: string): RunState {
  // Mutable working state — only mutated inside this function
  let status: RunStatus = "created";
  let goal = "";
  let startedAt: string | undefined;
  let completedAt: string | undefined;
  const tasks = new Map<string, AgentTask>();
  const filesModified: string[] = [];

  const runEvents = events.filter((e) => e.run_id === runId);

  for (let i = 0; i < runEvents.length; i++) {
    const event = runEvents[i]!;
    const { event_type, payload, timestamp } = event;

    switch (event_type) {
      case "RUN_CREATED": {
        status = "created";
        goal = typeof payload["goal"] === "string" ? payload["goal"] : "";
        startedAt = timestamp;
        break;
      }

      case "INTENT_COMPILED": {
        assertRunTransition(status, "planning", i, event_type);
        status = "planning";
        break;
      }

      case "TASK_CREATED": {
        const taskId =
          event.task_id ??
          (typeof payload["taskId"] === "string" ? payload["taskId"] : undefined);
        if (taskId) {
          const task: AgentTask = {
            taskId,
            runId,
            title: typeof payload["title"] === "string" ? payload["title"] : taskId,
            description: typeof payload["description"] === "string" ? payload["description"] : "",
            owner: typeof payload["owner"] === "string" ? payload["owner"] : "orchestrator",
            dependencies: Array.isArray(payload["dependencies"])
              ? (payload["dependencies"] as string[])
              : [],
            allowedFiles: Array.isArray(payload["allowedFiles"])
              ? (payload["allowedFiles"] as string[])
              : [],
            blockedFiles: Array.isArray(payload["blockedFiles"])
              ? (payload["blockedFiles"] as string[])
              : [],
            allowedTools: Array.isArray(payload["allowedTools"])
              ? (payload["allowedTools"] as string[])
              : [],
            expectedOutputs: [],
            successCriteria: [],
            status: "pending",
          };
          tasks.set(taskId, task);
        }
        break;
      }

      case "TASK_ASSIGNED": {
        const taskId =
          event.task_id ??
          (typeof payload["taskId"] === "string" ? payload["taskId"] : undefined);
        if (taskId) {
          const task = tasks.get(taskId);
          if (task) {
            assertTaskTransition(taskId, task.status, "assigned", i, event_type);
            tasks.set(taskId, { ...task, status: "assigned" });
          }
        }
        break;
      }

      case "TASK_STARTED": {
        if (status === "planning" || status === "created") {
          assertRunTransition(status, "executing", i, event_type);
          status = "executing";
        }
        const taskId = event.task_id ?? (typeof payload["taskId"] === "string" ? payload["taskId"] : undefined);
        if (taskId) {
          const task = tasks.get(taskId);
          if (task) {
            assertTaskTransition(taskId, task.status, "running", i, event_type);
            tasks.set(taskId, { ...task, status: "running" });
          }
        }
        break;
      }

      case "PATCH_PROPOSED": {
        const files = payload["filesModified"];
        if (Array.isArray(files)) {
          for (const f of files) {
            if (typeof f === "string" && !filesModified.includes(f)) {
              filesModified.push(f);
            }
          }
        }
        const taskId = event.task_id ?? (typeof payload["taskId"] === "string" ? payload["taskId"] : undefined);
        if (taskId) {
          const task = tasks.get(taskId);
          if (task) {
            assertTaskTransition(taskId, task.status, "awaiting_verification", i, event_type);
            tasks.set(taskId, { ...task, status: "awaiting_verification" });
          }
        }
        break;
      }

      case "VERIFICATION_STARTED": {
        if (status !== "verifying") {
          assertRunTransition(status, "verifying", i, event_type);
          status = "verifying";
        }
        break;
      }

      case "VERIFICATION_PASSED":
      case "TASK_COMPLETED": {
        const taskId = event.task_id ?? (typeof payload["taskId"] === "string" ? payload["taskId"] : undefined);
        if (taskId) {
          const task = tasks.get(taskId);
          // Idempotent: already completed (e.g. VERIFICATION_PASSED then TASK_COMPLETED) — skip
          if (task && task.status !== "completed") {
            // Allow awaiting_verification → completed or running → completed (direct)
            if (task.status !== "awaiting_verification" && task.status !== "running") {
              assertTaskTransition(taskId, task.status, "completed", i, event_type);
            }
            tasks.set(taskId, { ...task, status: "completed" });
          }
        }
        break;
      }

      case "BOUNDARY_VIOLATION":
      case "VERIFICATION_FAILED":
      case "TASK_FAILED": {
        const taskId = event.task_id ?? (typeof payload["taskId"] === "string" ? payload["taskId"] : undefined);
        if (taskId) {
          const task = tasks.get(taskId);
          // Idempotent: multiple failure events (BV + VF + TASK_FAILED) can fire for one task
          if (task && task.status !== "failed") {
            assertTaskTransition(taskId, task.status, "failed", i, event_type);
            tasks.set(taskId, { ...task, status: "failed" });
          }
        }
        break;
      }

      case "RUN_COMPLETED": {
        assertRunTransition(status, "completed", i, event_type);
        status = "completed";
        completedAt = timestamp;
        break;
      }

      case "RUN_FAILED": {
        assertRunTransition(status, "failed", i, event_type);
        status = "failed";
        completedAt = timestamp;
        break;
      }

      // Events that don't affect RunState reconstruction
      case "WORKTREE_CREATED":
      case "CONTEXT_READ":
      case "TOOL_CALLED":
      case "FILE_EDIT_PROPOSED":
      case "HUMAN_APPROVAL_REQUESTED":
        break;
    }
  }

  return RunStateSchema.parse({
    runId,
    status,
    goal,
    tasks: Array.from(tasks.values()),
    filesModified,
    startedAt,
    completedAt,
  });
}
