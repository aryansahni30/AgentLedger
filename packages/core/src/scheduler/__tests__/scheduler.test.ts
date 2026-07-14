import { describe, it, expect, beforeEach } from "vitest";
import { TaskScheduler } from "../TaskScheduler.js";
import type { AgentTask } from "../../schemas/index.js";

function makeTask(
  taskId: string,
  dependencies: string[] = [],
  overrides: Partial<AgentTask> = {},
): AgentTask {
  return {
    taskId,
    runId: "run-test",
    title: `Task ${taskId}`,
    description: "test task",
    owner: "agent",
    dependencies,
    allowedFiles: [],
    blockedFiles: [],
    allowedTools: [],
    expectedOutputs: [],
    successCriteria: [],
    status: "pending",
    ...overrides,
  };
}

describe("TaskScheduler", () => {
  describe("construction", () => {
    it("accepts empty task list", () => {
      const s = new TaskScheduler([]);
      expect(s.isDone()).toBe(true);
    });

    it("initialises all tasks as pending", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b")]);
      expect(s.getStatus("a")).toBe("pending");
      expect(s.getStatus("b")).toBe("pending");
    });

    it("throws for unknown taskId in getStatus", () => {
      const s = new TaskScheduler([makeTask("a")]);
      expect(() => s.getStatus("unknown")).toThrow();
    });
  });

  describe("getReadyTasks", () => {
    it("returns all tasks with no dependencies initially", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b"), makeTask("c")]);
      const ready = s.getReadyTasks().map((t) => t.taskId);
      expect(ready.sort()).toEqual(["a", "b", "c"]);
    });

    it("returns only root tasks when others have deps", () => {
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b", ["a"]),
      ]);
      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["a"]);
    });

    it("does not return currently running tasks", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b")]);
      s.markRunning("a");
      const ready = s.getReadyTasks().map((t) => t.taskId);
      expect(ready).toEqual(["b"]);
      expect(ready).not.toContain("a");
    });

    it("returns dependent task once its dep is completed", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b", ["a"])]);
      s.markRunning("a");
      s.markCompleted("a");
      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["b"]);
    });

    it("does not return task until ALL deps completed", () => {
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b"),
        makeTask("c", ["a", "b"]),
      ]);
      s.markRunning("a");
      s.markCompleted("a");
      // b still pending — c must not be ready yet
      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["b"]);
    });

    it("returns task once all deps completed (multi-dep)", () => {
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b"),
        makeTask("c", ["a", "b"]),
      ]);
      s.markRunning("a");
      s.markCompleted("a");
      s.markRunning("b");
      s.markCompleted("b");
      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["c"]);
    });

    it("does not return task whose dep failed", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b", ["a"])]);
      s.markRunning("a");
      s.markFailed("a");
      expect(s.getReadyTasks()).toHaveLength(0);
    });

    it("returns empty list when all tasks are running or done", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b")]);
      s.markRunning("a");
      s.markRunning("b");
      expect(s.getReadyTasks()).toHaveLength(0);
    });

    it("returns completed tasks' siblings after one completes", () => {
      // a → c, b → c; a completes first, b still pending
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b"),
        makeTask("c", ["a", "b"]),
        makeTask("d"),
      ]);
      s.markRunning("a");
      s.markCompleted("a");
      // ready: b (no deps, not running) and d (no deps, not running)
      const ready = s.getReadyTasks().map((t) => t.taskId).sort();
      expect(ready).toEqual(["b", "d"]);
    });
  });

  describe("isDone", () => {
    it("returns false when tasks are pending", () => {
      const s = new TaskScheduler([makeTask("a")]);
      expect(s.isDone()).toBe(false);
    });

    it("returns false when tasks are running", () => {
      const s = new TaskScheduler([makeTask("a")]);
      s.markRunning("a");
      expect(s.isDone()).toBe(false);
    });

    it("returns true when all tasks completed", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b")]);
      s.markRunning("a");
      s.markCompleted("a");
      s.markRunning("b");
      s.markCompleted("b");
      expect(s.isDone()).toBe(true);
    });

    it("returns true when all tasks completed or failed", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b")]);
      s.markRunning("a");
      s.markFailed("a");
      s.markRunning("b");
      s.markCompleted("b");
      expect(s.isDone()).toBe(true);
    });

    it("returns true for empty task list", () => {
      expect(new TaskScheduler([]).isDone()).toBe(true);
    });

    it("returns true when all tasks skipped due to dep failure", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b", ["a"])]);
      s.markRunning("a");
      s.markFailed("a");
      // b can never run — scheduler auto-skips (marks failed) deps-of-failed
      expect(s.isDone()).toBe(true);
    });
  });

  describe("state transitions", () => {
    it("pending → running → completed is valid", () => {
      const s = new TaskScheduler([makeTask("a")]);
      s.markRunning("a");
      expect(s.getStatus("a")).toBe("running");
      s.markCompleted("a");
      expect(s.getStatus("a")).toBe("completed");
    });

    it("pending → running → failed is valid", () => {
      const s = new TaskScheduler([makeTask("a")]);
      s.markRunning("a");
      s.markFailed("a");
      expect(s.getStatus("a")).toBe("failed");
    });

    it("throws when marking unknown task running", () => {
      const s = new TaskScheduler([makeTask("a")]);
      expect(() => s.markRunning("z")).toThrow();
    });

    it("throws when marking unknown task completed", () => {
      const s = new TaskScheduler([makeTask("a")]);
      expect(() => s.markCompleted("z")).toThrow();
    });

    it("throws when marking unknown task failed", () => {
      const s = new TaskScheduler([makeTask("a")]);
      expect(() => s.markFailed("z")).toThrow();
    });
  });

  describe("getStats", () => {
    it("returns correct counts at each stage", () => {
      const s = new TaskScheduler([makeTask("a"), makeTask("b"), makeTask("c")]);
      expect(s.getStats()).toEqual({ pending: 3, running: 0, completed: 0, failed: 0 });

      s.markRunning("a");
      expect(s.getStats()).toEqual({ pending: 2, running: 1, completed: 0, failed: 0 });

      s.markCompleted("a");
      expect(s.getStats()).toEqual({ pending: 2, running: 0, completed: 1, failed: 0 });

      s.markRunning("b");
      s.markFailed("b");
      expect(s.getStats()).toEqual({ pending: 1, running: 0, completed: 1, failed: 1 });
    });
  });

  describe("dependency propagation (failed cascade)", () => {
    it("cascades failure two levels deep", () => {
      // a → b → c
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b", ["a"]),
        makeTask("c", ["b"]),
      ]);
      s.markRunning("a");
      s.markFailed("a");
      // b is auto-failed, c is auto-failed
      expect(s.getStats().failed).toBe(3);
      expect(s.isDone()).toBe(true);
    });

    it("does not cascade to tasks whose other deps are still ok", () => {
      // a fails, b completes, c depends on both a and b
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b"),
        makeTask("c", ["a", "b"]),
      ]);
      s.markRunning("a");
      s.markFailed("a");
      // c depends on a which failed → c also fails
      expect(s.getStatus("c")).toBe("failed");
      // b is unaffected
      expect(s.getStatus("b")).toBe("pending");
    });

    it("sibling with no dep on failed task remains ready", () => {
      const s = new TaskScheduler([
        makeTask("x"),
        makeTask("y"),
        makeTask("z", ["x"]),
      ]);
      s.markRunning("x");
      s.markFailed("x");
      // y has no dep on x — still ready
      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["y"]);
    });
  });

  describe("chain scenarios", () => {
    it("sequential chain: a → b → c completes correctly", () => {
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b", ["a"]),
        makeTask("c", ["b"]),
      ]);

      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["a"]);
      s.markRunning("a");
      s.markCompleted("a");

      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["b"]);
      s.markRunning("b");
      s.markCompleted("b");

      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["c"]);
      s.markRunning("c");
      s.markCompleted("c");

      expect(s.isDone()).toBe(true);
    });

    it("diamond: a → b, a → c, b + c → d", () => {
      const s = new TaskScheduler([
        makeTask("a"),
        makeTask("b", ["a"]),
        makeTask("c", ["a"]),
        makeTask("d", ["b", "c"]),
      ]);

      // Only a ready
      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["a"]);
      s.markRunning("a");
      s.markCompleted("a");

      // b and c unlocked
      const afterA = s.getReadyTasks().map((t) => t.taskId).sort();
      expect(afterA).toEqual(["b", "c"]);
      s.markRunning("b");
      s.markRunning("c");
      s.markCompleted("b");

      // d needs c too — not yet ready
      expect(s.getReadyTasks()).toHaveLength(0);

      s.markCompleted("c");
      expect(s.getReadyTasks().map((t) => t.taskId)).toEqual(["d"]);
      s.markRunning("d");
      s.markCompleted("d");
      expect(s.isDone()).toBe(true);
    });
  });
});
