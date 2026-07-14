import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateReassignment, reassignTask } from "../reassignTask.js";
import type { AgentTask } from "../../schemas/index.js";
import { LedgerWriter } from "../../ledger/LedgerWriter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "task-1",
    runId: "run-1",
    title: "My Task",
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

// ─── validateReassignment ─────────────────────────────────────────────────────

describe("validateReassignment — valid cases", () => {
  it("does not throw for a pending task with valid owner", () => {
    expect(() => validateReassignment(makeTask(), "dev-b")).not.toThrow();
  });

  it("accepts owner strings with spaces (trimmed check only)", () => {
    expect(() => validateReassignment(makeTask(), "dev team")).not.toThrow();
  });
});

describe("validateReassignment — invalid status", () => {
  const nonPendingStatuses = [
    "assigned",
    "running",
    "awaiting_verification",
    "completed",
    "failed",
  ] as const;

  for (const status of nonPendingStatuses) {
    it(`throws when task status is "${status}"`, () => {
      expect(() => validateReassignment(makeTask({ status }), "dev-b")).toThrow(
        /pending/,
      );
    });

    it(`error message includes current status "${status}"`, () => {
      expect(() => validateReassignment(makeTask({ status }), "dev-b")).toThrow(
        status,
      );
    });
  }
});

describe("validateReassignment — invalid owner", () => {
  it("throws for empty string owner", () => {
    expect(() => validateReassignment(makeTask(), "")).toThrow(/non-empty/i);
  });

  it("throws for whitespace-only owner", () => {
    expect(() => validateReassignment(makeTask(), "   ")).toThrow(/non-empty/i);
  });
});

// ─── reassignTask ─────────────────────────────────────────────────────────────

describe("reassignTask — emits correct event", () => {
  let appendEvent: ReturnType<typeof vi.fn>;
  let writer: LedgerWriter;

  beforeEach(() => {
    appendEvent = vi.fn().mockResolvedValue(undefined);
    writer = { appendEvent } as unknown as LedgerWriter;
  });

  it("calls appendEvent once", async () => {
    await reassignTask(makeTask(), "dev-b", writer);
    expect(appendEvent).toHaveBeenCalledOnce();
  });

  it("emits TASK_ASSIGNED event type", async () => {
    await reassignTask(makeTask(), "dev-b", writer);
    const emitted = appendEvent.mock.calls[0]![0];
    expect(emitted.event_type).toBe("TASK_ASSIGNED");
  });

  it("emits event with correct run_id", async () => {
    await reassignTask(makeTask({ runId: "run-abc" }), "dev-b", writer);
    const emitted = appendEvent.mock.calls[0]![0];
    expect(emitted.run_id).toBe("run-abc");
  });

  it("emits event with correct task_id", async () => {
    await reassignTask(makeTask({ taskId: "task-42" }), "dev-b", writer);
    const emitted = appendEvent.mock.calls[0]![0];
    expect(emitted.task_id).toBe("task-42");
  });

  it("emits event with new owner in payload", async () => {
    await reassignTask(makeTask(), "dev-b", writer);
    const emitted = appendEvent.mock.calls[0]![0];
    expect(emitted.payload["owner"]).toBe("dev-b");
  });

  it("emits event with taskId in payload", async () => {
    await reassignTask(makeTask({ taskId: "task-42" }), "dev-b", writer);
    const emitted = appendEvent.mock.calls[0]![0];
    expect(emitted.payload["taskId"]).toBe("task-42");
  });
});

describe("reassignTask — validation propagated", () => {
  let writer: LedgerWriter;

  beforeEach(() => {
    writer = { appendEvent: vi.fn() } as unknown as LedgerWriter;
  });

  it("throws and does not write when task is not pending", async () => {
    await expect(
      reassignTask(makeTask({ status: "running" }), "dev-b", writer),
    ).rejects.toThrow(/pending/);
    expect((writer.appendEvent as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("throws and does not write when owner is empty", async () => {
    await expect(reassignTask(makeTask(), "", writer)).rejects.toThrow(/non-empty/i);
    expect((writer.appendEvent as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
