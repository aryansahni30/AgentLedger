import { describe, it, expect, beforeEach } from "vitest";
import { buildPriorTaskContext } from "../priorTaskContext.js";
import type { LedgerEvent, AgentTask } from "../../schemas/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RUN_ID = "run-ctx-1";
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

function makeTask(overrides: Partial<AgentTask> & Pick<AgentTask, "taskId">): AgentTask {
  return {
    runId: RUN_ID,
    title: overrides.taskId,
    description: "",
    owner: "dev-a",
    dependencies: [],
    allowedFiles: [],
    blockedFiles: [],
    allowedTools: [],
    expectedOutputs: [],
    successCriteria: [],
    status: "pending",
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

// ─── No dependencies ──────────────────────────────────────────────────────────

describe("buildPriorTaskContext — no dependencies", () => {
  it("returns empty array when task has no dependencies", () => {
    const events = [
      makeEvent({ event_type: "RUN_CREATED", payload: { goal: "test" } }),
    ];
    const task = makeTask({ taskId: "task-1", dependencies: [] });
    expect(buildPriorTaskContext(events, task)).toHaveLength(0);
  });
});

// ─── Dependency without PATCH_PROPOSED ───────────────────────────────────────

describe("buildPriorTaskContext — dependency without patch", () => {
  it("excludes dependency with no PATCH_PROPOSED event", () => {
    const events = [
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-dep",
        payload: { title: "Upstream task", dependencies: [] },
      }),
    ];
    const task = makeTask({ taskId: "task-1", dependencies: ["task-dep"] });
    const result = buildPriorTaskContext(events, task);
    expect(result).toHaveLength(0);
  });
});

// ─── Dependency with PATCH_PROPOSED ──────────────────────────────────────────

describe("buildPriorTaskContext — dependency with patch", () => {
  it("returns context entry for dependency with PATCH_PROPOSED", () => {
    const events = [
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-dep",
        payload: { title: "Add caching", dependencies: [] },
      }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-dep",
        payload: { summary: "Added Redis layer", filesModified: ["src/cache.ts"] },
      }),
    ];
    const task = makeTask({ taskId: "task-1", dependencies: ["task-dep"] });
    const result = buildPriorTaskContext(events, task);
    expect(result).toHaveLength(1);
    expect(result[0]!.taskId).toBe("task-dep");
    expect(result[0]!.title).toBe("Add caching");
    expect(result[0]!.summary).toBe("Added Redis layer");
    expect(result[0]!.filesModified).toEqual(["src/cache.ts"]);
  });

  it("falls back to taskId as title when TASK_CREATED missing", () => {
    const events = [
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-dep",
        payload: { summary: "Some patch", filesModified: [] },
      }),
    ];
    const task = makeTask({ taskId: "task-1", dependencies: ["task-dep"] });
    const result = buildPriorTaskContext(events, task);
    expect(result[0]!.title).toBe("task-dep");
  });
});

// ─── Multiple dependencies ────────────────────────────────────────────────────

describe("buildPriorTaskContext — multiple dependencies", () => {
  it("returns one entry per dependency that has a PATCH_PROPOSED", () => {
    const events = [
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-a",
        payload: { title: "Task A", dependencies: [] },
      }),
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-b",
        payload: { title: "Task B", dependencies: [] },
      }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-a",
        payload: { summary: "Done A", filesModified: ["a.ts"] },
      }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-b",
        payload: { summary: "Done B", filesModified: ["b.ts"] },
      }),
    ];
    const task = makeTask({ taskId: "task-c", dependencies: ["task-a", "task-b"] });
    const result = buildPriorTaskContext(events, task);
    expect(result).toHaveLength(2);
  });

  it("preserves dependency order in result", () => {
    const events = [
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-b",
        payload: { summary: "B", filesModified: [] },
      }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-a",
        payload: { summary: "A", filesModified: [] },
      }),
    ];
    // dependencies listed as [a, b]; result should follow that order
    const task = makeTask({ taskId: "task-c", dependencies: ["task-a", "task-b"] });
    const result = buildPriorTaskContext(events, task);
    expect(result[0]!.taskId).toBe("task-a");
    expect(result[1]!.taskId).toBe("task-b");
  });

  it("skips dependency with no patch, includes one with patch", () => {
    const events = [
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-a",
        payload: { title: "Task A", dependencies: [] },
      }),
      // task-b has no PATCH_PROPOSED
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-a",
        payload: { summary: "Done A", filesModified: ["a.ts"] },
      }),
    ];
    const task = makeTask({ taskId: "task-c", dependencies: ["task-a", "task-b"] });
    const result = buildPriorTaskContext(events, task);
    expect(result).toHaveLength(1);
    expect(result[0]!.taskId).toBe("task-a");
  });
});

// ─── Latest PATCH_PROPOSED wins ───────────────────────────────────────────────

describe("buildPriorTaskContext — latest patch wins", () => {
  it("uses the last PATCH_PROPOSED when multiple exist for same task", () => {
    const events = [
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-dep",
        payload: { summary: "First attempt", filesModified: ["old.ts"] },
      }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-dep",
        payload: { summary: "Revised attempt", filesModified: ["new.ts"] },
      }),
    ];
    const task = makeTask({ taskId: "task-1", dependencies: ["task-dep"] });
    const result = buildPriorTaskContext(events, task);
    expect(result[0]!.summary).toBe("Revised attempt");
    expect(result[0]!.filesModified).toContain("new.ts");
  });
});

// ─── Run isolation ────────────────────────────────────────────────────────────

describe("buildPriorTaskContext — run isolation", () => {
  it("ignores events from a different run_id", () => {
    const events = [
      makeEvent({
        event_type: "TASK_CREATED",
        run_id: "other-run",
        task_id: "task-dep",
        payload: { title: "Other task", dependencies: [] },
      }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        run_id: "other-run",
        task_id: "task-dep",
        payload: { summary: "Other patch", filesModified: ["x.ts"] },
      }),
    ];
    const task = makeTask({ taskId: "task-1", dependencies: ["task-dep"] });
    // task.runId = RUN_ID, but events are from "other-run"
    const result = buildPriorTaskContext(events, task);
    expect(result).toHaveLength(0);
  });
});
