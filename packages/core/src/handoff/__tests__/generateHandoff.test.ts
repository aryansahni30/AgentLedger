import { describe, it, expect, beforeEach } from "vitest";
import { generateHandoff } from "../generateHandoff.js";
import type { LedgerEvent } from "../../schemas/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RUN_ID = "run-handoff-1";
let seq = 0;

function makeEvent(
  overrides: Partial<LedgerEvent> & Pick<LedgerEvent, "event_type">,
): LedgerEvent {
  seq++;
  return {
    event_id: `evt-${seq}`,
    run_id: RUN_ID,
    timestamp: new Date(Date.UTC(2026, 0, seq)).toISOString(),
    actor: "orchestrator",
    payload: {},
    hash: `hash-${seq}`,
    previous_hash: `hash-${seq - 1}`,
    ...overrides,
  };
}

function baseRun(): LedgerEvent[] {
  return [
    makeEvent({ event_type: "RUN_CREATED", payload: { goal: "Add caching", riskLevel: "low" } }),
    makeEvent({ event_type: "INTENT_COMPILED", payload: {} }),
  ];
}

beforeEach(() => { seq = 0; });

// ─── Empty / minimal ─────────────────────────────────────────────────────────

describe("generateHandoff — minimal runs", () => {
  it("returns correct runId and goal", () => {
    const events = baseRun();
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.runId).toBe(RUN_ID);
    expect(doc.goal).toBe("Add caching");
  });

  it("all task arrays empty for a brand-new run with no tasks", () => {
    const events = baseRun();
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.completedTasks).toHaveLength(0);
    expect(doc.pendingTasks).toHaveLength(0);
    expect(doc.failedTasks).toHaveLength(0);
    expect(doc.awaitingApproval).toHaveLength(0);
  });

  it("run status is 'planning' after INTENT_COMPILED", () => {
    const events = baseRun();
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.runStatus).toBe("planning");
  });
});

// ─── Pending tasks ────────────────────────────────────────────────────────────

describe("generateHandoff — pending tasks", () => {
  it("surfaces pending task with correct metadata", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Write tests", owner: "dev-a", dependencies: [], allowedFiles: [], blockedFiles: [] },
      }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.pendingTasks).toHaveLength(1);
    expect(doc.pendingTasks[0]!.title).toBe("Write tests");
    expect(doc.pendingTasks[0]!.owner).toBe("dev-a");
    expect(doc.pendingTasks[0]!.blockedBy).toHaveLength(0);
  });

  it("blockedBy includes unfinished dependency IDs", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Migrate DB", owner: "dev-a", dependencies: [], allowedFiles: [], blockedFiles: [] },
      }),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-2",
        payload: { title: "Update API", owner: "dev-b", dependencies: ["task-1"], allowedFiles: [], blockedFiles: [] },
      }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    const task2 = doc.pendingTasks.find((t) => t.taskId === "task-2");
    expect(task2?.blockedBy).toContain("task-1");
  });
});

// ─── Completed tasks ──────────────────────────────────────────────────────────

describe("generateHandoff — completed tasks", () => {
  function completedTaskEvents(): LedgerEvent[] {
    return [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Add Redis", owner: "dev-a", dependencies: [], allowedFiles: ["src/**"], blockedFiles: [] },
      }),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-1",
        payload: { summary: "Added Redis cache layer", filesModified: ["src/cache.ts"] },
      }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "RUN_COMPLETED", payload: {} }),
    ];
  }

  it("completed task appears in completedTasks", () => {
    const doc = generateHandoff(completedTaskEvents(), RUN_ID);
    expect(doc.completedTasks).toHaveLength(1);
    expect(doc.completedTasks[0]!.title).toBe("Add Redis");
  });

  it("PATCH_PROPOSED summary captured in completed task", () => {
    const doc = generateHandoff(completedTaskEvents(), RUN_ID);
    expect(doc.completedTasks[0]!.summary).toBe("Added Redis cache layer");
    expect(doc.completedTasks[0]!.filesModified).toContain("src/cache.ts");
  });

  it("allFilesModified contains files from completed tasks", () => {
    const doc = generateHandoff(completedTaskEvents(), RUN_ID);
    expect(doc.allFilesModified).toContain("src/cache.ts");
  });

  it("runStatus is completed", () => {
    const doc = generateHandoff(completedTaskEvents(), RUN_ID);
    expect(doc.runStatus).toBe("completed");
  });

  it("suggestedNextAction says no action needed when run completed", () => {
    const doc = generateHandoff(completedTaskEvents(), RUN_ID);
    expect(doc.suggestedNextAction).toMatch(/no action needed/i);
  });
});

// ─── Failed tasks ─────────────────────────────────────────────────────────────

describe("generateHandoff — failed tasks", () => {
  it("failed task appears in failedTasks", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Refactor auth", owner: "dev-a", dependencies: [], allowedFiles: ["src/**"], blockedFiles: [] },
      }),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: { reason: "worker_error" } }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.failedTasks).toHaveLength(1);
    expect(doc.failedTasks[0]!.title).toBe("Refactor auth");
    expect(doc.failedTasks[0]!.failureReason).toBe("worker_error");
  });

  it("BOUNDARY_VIOLATION reason captured", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Task", owner: "dev-a", dependencies: [], allowedFiles: ["src/**"], blockedFiles: [".env"] },
      }),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "BOUNDARY_VIOLATION", task_id: "task-1", payload: { message: "touched .env" } }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.failedTasks[0]!.failureReason).toBe("BOUNDARY_VIOLATION");
  });

  it("suggestedNextAction references replay command when tasks failed", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Task", owner: "dev-a", dependencies: [], allowedFiles: ["src/**"], blockedFiles: [] },
      }),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: { reason: "worker_error" } }),
      makeEvent({ event_type: "RUN_FAILED", payload: {} }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.suggestedNextAction).toMatch(/replay/);
  });
});

// ─── Awaiting approval ────────────────────────────────────────────────────────

describe("generateHandoff — awaiting approval", () => {
  it("task awaiting approval appears in awaitingApproval", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Deploy DB migration", owner: "dev-a", dependencies: [], allowedFiles: ["migrations/**"], blockedFiles: [] },
      }),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "PATCH_PROPOSED", task_id: "task-1", payload: { summary: "Added migration", filesModified: ["migrations/001.sql"] } }),
      makeEvent({ event_type: "HUMAN_APPROVAL_REQUESTED", task_id: "task-1", payload: {} }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.awaitingApproval).toHaveLength(1);
    expect(doc.awaitingApproval[0]!.title).toBe("Deploy DB migration");
  });

  it("suggestedNextAction says to approve when awaiting", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-1",
        payload: { title: "Deploy", owner: "dev-a", dependencies: [], allowedFiles: ["migrations/**"], blockedFiles: [] },
      }),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "PATCH_PROPOSED", task_id: "task-1", payload: { summary: "", filesModified: [] } }),
      makeEvent({ event_type: "HUMAN_APPROVAL_REQUESTED", task_id: "task-1", payload: {} }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.suggestedNextAction).toMatch(/approve/i);
    expect(doc.suggestedNextAction).toContain(RUN_ID);
  });
});

// ─── Events from other runs ignored ──────────────────────────────────────────

describe("generateHandoff — run isolation", () => {
  it("events from other run IDs are ignored", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        run_id: "other-run",
        task_id: "task-99",
        payload: { title: "Unrelated", owner: "dev-z", dependencies: [], allowedFiles: [], blockedFiles: [] },
      }),
    ];
    const doc = generateHandoff(events, RUN_ID);
    expect(doc.pendingTasks.find((t) => t.taskId === "task-99")).toBeUndefined();
  });
});
