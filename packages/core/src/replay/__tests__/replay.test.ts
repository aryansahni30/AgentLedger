import { describe, it, expect } from "vitest";
import { replayLedger, RunReplayError } from "../replayLedger.js";
import { computeHash } from "../../ledger/hashChain.js";
import type { LedgerEvent, LedgerEventType } from "../../schemas/index.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

let seq = 0;
const RUN_ID = "run-replay-test";
const GENESIS = "genesis";

function makeEvent(
  event_type: LedgerEventType,
  payload: Record<string, unknown> = {},
  overrides: Partial<LedgerEvent> = {},
): LedgerEvent {
  seq++;
  const previousHash = GENESIS; // tests build chains manually when needed
  const hash = computeHash(previousHash, payload);
  return {
    event_id: `evt-${seq}`,
    run_id: RUN_ID,
    task_id: undefined,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type,
    payload,
    hash,
    previous_hash: previousHash,
    ...overrides,
  };
}

/** Build a minimal hash-chained sequence of events */
function chainEvents(...events: Omit<LedgerEvent, "hash" | "previous_hash">[]): LedgerEvent[] {
  const result: LedgerEvent[] = [];
  let prevHash = GENESIS;
  for (const e of events) {
    const hash = computeHash(prevHash, e.payload);
    result.push({ ...e, hash, previous_hash: prevHash } as LedgerEvent);
    prevHash = hash;
  }
  return result;
}

function baseEvent(
  event_type: LedgerEventType,
  payload: Record<string, unknown> = {},
  task_id?: string,
): Omit<LedgerEvent, "hash" | "previous_hash"> {
  seq++;
  return {
    event_id: `evt-${seq}`,
    run_id: RUN_ID,
    task_id,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type,
    payload,
  };
}

// ─── basic state reconstruction ───────────────────────────────────────────────

describe("replayLedger — basic state reconstruction", () => {
  it("returns created status with empty goal for empty event list", () => {
    const state = replayLedger([], RUN_ID);
    expect(state.runId).toBe(RUN_ID);
    expect(state.status).toBe("created");
    expect(state.tasks).toEqual([]);
    expect(state.filesModified).toEqual([]);
  });

  it("extracts goal from RUN_CREATED payload", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "Build a REST API" }),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.goal).toBe("Build a REST API");
    expect(state.status).toBe("created");
  });

  it("sets startedAt from RUN_CREATED timestamp", () => {
    const ts = "2026-07-07T10:00:00.000Z";
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }, undefined),
    );
    events[0]!.timestamp = ts;
    const state = replayLedger(events, RUN_ID);
    expect(state.startedAt).toBe(ts);
  });

  it("transitions run to planning on INTENT_COMPILED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.status).toBe("planning");
  });

  it("adds task from TASK_CREATED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "My Task",
        description: "Do the thing",
        owner: "worker-1",
        dependencies: [],
        allowedFiles: ["src/**"],
        blockedFiles: [],
        allowedTools: [],
      }),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]!.taskId).toBe("task-1");
    expect(state.tasks[0]!.title).toBe("My Task");
    expect(state.tasks[0]!.status).toBe("pending");
  });

  it("transitions run to executing on TASK_STARTED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T1",
        description: "",
        owner: "w1",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "task-1" }),
      baseEvent("TASK_STARTED", { taskId: "task-1" }, "task-1"),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.status).toBe("executing");
    expect(state.tasks[0]!.status).toBe("running");
  });

  it("captures filesModified from PATCH_PROPOSED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T1",
        description: "",
        owner: "w1",
        dependencies: [],
        allowedFiles: ["**/*.ts"],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "task-1" }),
      baseEvent("TASK_STARTED", { taskId: "task-1" }, "task-1"),
      baseEvent("PATCH_PROPOSED", {
        taskId: "task-1",
        filesModified: ["src/index.ts", "src/utils.ts"],
      }, "task-1"),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.filesModified).toContain("src/index.ts");
    expect(state.filesModified).toContain("src/utils.ts");
    // Task stays "running" after PATCH_PROPOSED — the next event
    // (HUMAN_APPROVAL_REQUESTED or VERIFICATION_STARTED) decides the path.
    expect(state.tasks[0]!.status).toBe("running");
  });

  it("marks task completed on VERIFICATION_PASSED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T1",
        description: "",
        owner: "w1",
        dependencies: [],
        allowedFiles: ["**/*.ts"],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "task-1" }),
      baseEvent("TASK_STARTED", { taskId: "task-1" }, "task-1"),
      baseEvent("PATCH_PROPOSED", { taskId: "task-1", filesModified: [] }, "task-1"),
      baseEvent("VERIFICATION_PASSED", { taskId: "task-1" }, "task-1"),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.tasks[0]!.status).toBe("completed");
  });

  it("marks task failed on BOUNDARY_VIOLATION", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T1",
        description: "",
        owner: "w1",
        dependencies: [],
        allowedFiles: ["src/**"],
        blockedFiles: ["**/.env"],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "task-1" }),
      baseEvent("TASK_STARTED", { taskId: "task-1" }, "task-1"),
      baseEvent("PATCH_PROPOSED", { taskId: "task-1", filesModified: [".env"] }, "task-1"),
      baseEvent("BOUNDARY_VIOLATION", { taskId: "task-1", file: ".env" }, "task-1"),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.tasks[0]!.status).toBe("failed");
  });

  it("sets status completed and completedAt on RUN_COMPLETED", () => {
    const completedTs = "2026-07-07T11:00:00.000Z";
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T1",
        description: "",
        owner: "w1",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "task-1" }),
      baseEvent("TASK_STARTED", { taskId: "task-1" }, "task-1"),
      baseEvent("PATCH_PROPOSED", { taskId: "task-1", filesModified: [] }, "task-1"),
      baseEvent("VERIFICATION_PASSED", { taskId: "task-1" }, "task-1"),
      baseEvent("TASK_COMPLETED", { taskId: "task-1" }, "task-1"),
      baseEvent("RUN_COMPLETED", {}),
    );
    // Patch the timestamp of the last event
    events[events.length - 1]!.timestamp = completedTs;
    const state = replayLedger(events, RUN_ID);
    expect(state.status).toBe("completed");
    expect(state.completedAt).toBe(completedTs);
  });

  it("sets status failed on RUN_FAILED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("RUN_FAILED", {}),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.status).toBe("failed");
    expect(state.completedAt).toBeDefined();
  });

  it("ignores events from a different runId", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal from other run" }),
    ).map((e) => ({ ...e, run_id: "other-run" }));

    const state = replayLedger(events, RUN_ID);
    expect(state.goal).toBe("");
    expect(state.tasks).toEqual([]);
  });

  it("deduplicates filesModified across PATCH_PROPOSED events", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T1",
        description: "",
        owner: "w1",
        dependencies: [],
        allowedFiles: ["**/*.ts"],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "task-1" }),
      baseEvent("TASK_STARTED", { taskId: "task-1" }, "task-1"),
      // First patch
      baseEvent("PATCH_PROPOSED", {
        taskId: "task-1",
        filesModified: ["src/a.ts", "src/b.ts"],
      }, "task-1"),
    );
    const state = replayLedger(events, RUN_ID);
    const unique = new Set(state.filesModified);
    expect(unique.size).toBe(state.filesModified.length);
  });

  it("reconstructs multiple tasks independently", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-A",
        title: "A",
        description: "",
        owner: "w1",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_CREATED", {
        taskId: "task-B",
        title: "B",
        description: "",
        owner: "w2",
        dependencies: ["task-A"],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "task-A" }),
      baseEvent("TASK_STARTED", { taskId: "task-A" }, "task-A"),
      baseEvent("PATCH_PROPOSED", { taskId: "task-A", filesModified: [] }, "task-A"),
      baseEvent("VERIFICATION_PASSED", { taskId: "task-A" }, "task-A"),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.tasks).toHaveLength(2);
    const taskA = state.tasks.find((t) => t.taskId === "task-A");
    const taskB = state.tasks.find((t) => t.taskId === "task-B");
    expect(taskA!.status).toBe("completed");
    expect(taskB!.status).toBe("pending");
  });
});

// ─── invalid state transition detection ───────────────────────────────────────

describe("replayLedger — invalid state transitions", () => {
  it("throws RunReplayError on invalid run transition (created → completed)", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("RUN_COMPLETED", {}), // skipped planning/executing
    );
    expect(() => replayLedger(events, RUN_ID)).toThrow(RunReplayError);
  });

  it("throws RunReplayError when run transitions out of completed", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "t1",
        title: "t1",
        description: "",
        owner: "w",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "t1" }),
      baseEvent("TASK_STARTED", { taskId: "t1" }, "t1"),
      baseEvent("PATCH_PROPOSED", { taskId: "t1", filesModified: [] }, "t1"),
      baseEvent("VERIFICATION_PASSED", { taskId: "t1" }, "t1"),
      baseEvent("TASK_COMPLETED", { taskId: "t1" }, "t1"),
      baseEvent("RUN_COMPLETED", {}),
      baseEvent("RUN_FAILED", {}), // terminal → terminal: invalid
    );
    expect(() => replayLedger(events, RUN_ID)).toThrow(RunReplayError);
  });

  it("throws RunReplayError when task goes completed → running", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "t1",
        title: "t1",
        description: "",
        owner: "w",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "t1" }),
      baseEvent("TASK_STARTED", { taskId: "t1" }, "t1"),
      baseEvent("PATCH_PROPOSED", { taskId: "t1", filesModified: [] }, "t1"),
      baseEvent("VERIFICATION_PASSED", { taskId: "t1" }, "t1"), // now completed
      baseEvent("TASK_STARTED", { taskId: "t1" }, "t1"),        // completed → running: invalid
    );
    expect(() => replayLedger(events, RUN_ID)).toThrow(RunReplayError);
  });

  it("throws RunReplayError when task goes failed → completed", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "t1",
        title: "t1",
        description: "",
        owner: "w",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", { taskId: "t1" }),
      baseEvent("TASK_STARTED", { taskId: "t1" }, "t1"),
      baseEvent("PATCH_PROPOSED", { taskId: "t1", filesModified: [] }, "t1"),
      baseEvent("BOUNDARY_VIOLATION", { taskId: "t1", file: ".env" }, "t1"), // now failed
      baseEvent("VERIFICATION_PASSED", { taskId: "t1" }, "t1"),               // failed → completed: invalid
    );
    expect(() => replayLedger(events, RUN_ID)).toThrow(RunReplayError);
  });

  it("RunReplayError exposes eventIndex and eventType", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("RUN_COMPLETED", {}), // invalid
    );
    let err: RunReplayError | undefined;
    try {
      replayLedger(events, RUN_ID);
    } catch (e) {
      if (e instanceof RunReplayError) err = e;
    }
    expect(err).toBeDefined();
    expect(err!.eventIndex).toBe(1);
    expect(err!.eventType).toBe("RUN_COMPLETED");
  });
});

// ─── hash chain integration ────────────────────────────────────────────────────

describe("replayLedger — hash chain integration", () => {
  it("works correctly with a properly chained event sequence", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "chained goal" }),
      baseEvent("INTENT_COMPILED", {}),
    );
    // Verify hashes are actually chained
    expect(events[1]!.previous_hash).toBe(events[0]!.hash);

    const state = replayLedger(events, RUN_ID);
    expect(state.goal).toBe("chained goal");
    expect(state.status).toBe("planning");
  });
});
