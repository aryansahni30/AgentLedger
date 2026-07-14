import { describe, it, expect, beforeEach } from "vitest";
import { buildLeaderboard } from "../leaderboard.js";
import type { LedgerEvent } from "../../schemas/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let seq = 0;
beforeEach(() => { seq = 0; });

function makeEvent(
  runId: string,
  overrides: Partial<LedgerEvent> & Pick<LedgerEvent, "event_type">,
): LedgerEvent {
  seq++;
  return {
    event_id: `evt-${seq}`,
    run_id: runId,
    timestamp: new Date(Date.UTC(2026, 0, seq)).toISOString(),
    actor: "orchestrator",
    payload: {},
    hash: `hash-${seq}`,
    previous_hash: `hash-${seq - 1}`,
    ...overrides,
  };
}

function makeMinimalRun(runId: string, taskId: string): LedgerEvent[] {
  return [
    makeEvent(runId, { event_type: "RUN_CREATED", payload: { goal: `Goal for ${runId}` } }),
    makeEvent(runId, { event_type: "INTENT_COMPILED", payload: { taskCount: 1 } }),
    makeEvent(runId, {
      event_type: "TASK_CREATED",
      task_id: taskId,
      payload: { title: `Task ${taskId}`, owner: "dev-a", dependencies: [], allowedFiles: [], blockedFiles: [] },
    }),
    makeEvent(runId, { event_type: "TASK_ASSIGNED", task_id: taskId, payload: { owner: "dev-a" } }),
    makeEvent(runId, { event_type: "TASK_STARTED", task_id: taskId, payload: { worktreePath: "/tmp/wt" } }),
    makeEvent(runId, { event_type: "PATCH_PROPOSED", task_id: taskId, payload: { filesModified: [], summary: "done" } }),
    makeEvent(runId, { event_type: "VERIFICATION_STARTED", task_id: taskId, payload: {} }),
    makeEvent(runId, { event_type: "VERIFICATION_PASSED", task_id: taskId, payload: {} }),
    makeEvent(runId, { event_type: "TASK_COMPLETED", task_id: taskId, payload: {} }),
    makeEvent(runId, { event_type: "RUN_COMPLETED", payload: { completedTasks: [taskId], failedTasks: [] } }),
  ];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildLeaderboard", () => {
  describe("empty / no-risk baseline", () => {
    it("returns empty entries for empty event list", () => {
      const lb = buildLeaderboard([]);
      expect(lb.entries).toHaveLength(0);
    });

    it("generatedAt is a valid ISO datetime string", () => {
      const lb = buildLeaderboard([]);
      expect(() => new Date(lb.generatedAt)).not.toThrow();
      expect(new Date(lb.generatedAt).getFullYear()).toBeGreaterThanOrEqual(2026);
    });

    it("clean task produces entry with riskScore 0", () => {
      const events = makeMinimalRun("run-1", "task-1");
      const lb = buildLeaderboard(events);
      expect(lb.entries).toHaveLength(1);
      expect(lb.entries[0]!.riskScore).toBe(0);
    });

    it("clean task has zero deny and require_approval counts", () => {
      const events = makeMinimalRun("run-1", "task-1");
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.denyCount).toBe(0);
      expect(lb.entries[0]!.requireApprovalCount).toBe(0);
    });

    it("clean task has zero boundary and tool denial counts", () => {
      const events = makeMinimalRun("run-1", "task-1");
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.boundaryViolationCount).toBe(0);
      expect(lb.entries[0]!.toolDenialCount).toBe(0);
    });

    it("entry carries correct runId and taskId", () => {
      const events = makeMinimalRun("run-abc", "task-xyz");
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.runId).toBe("run-abc");
      expect(lb.entries[0]!.taskId).toBe("task-xyz");
    });

    it("entry title matches TASK_CREATED title", () => {
      const events = makeMinimalRun("run-1", "task-1");
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.title).toBe("Task task-1");
    });
  });

  describe("policy decision counts", () => {
    it("denyCount increments for deny policyDecision", () => {
      const events = [
        ...makeMinimalRun("run-1", "task-1"),
        makeEvent("run-1", {
          event_type: "POLICY_EVALUATED",
          task_id: "task-1",
          payload: { decision: { action: "deny", reasons: ["secret"], risks: [] } },
        }),
      ];
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.denyCount).toBe(1);
    });

    it("requireApprovalCount increments for require_approval policyDecision", () => {
      const events = [
        ...makeMinimalRun("run-1", "task-1"),
        makeEvent("run-1", {
          event_type: "POLICY_EVALUATED",
          task_id: "task-1",
          payload: { decision: { action: "require_approval", reasons: ["schema"], risks: [] } },
        }),
      ];
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.requireApprovalCount).toBe(1);
    });

    it("warn and allow policyDecision do not affect deny/requireApproval counts", () => {
      const events = [
        ...makeMinimalRun("run-1", "task-1"),
        makeEvent("run-1", {
          event_type: "POLICY_EVALUATED",
          task_id: "task-1",
          payload: { decision: { action: "warn", reasons: ["dep"], risks: [] } },
        }),
      ];
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.denyCount).toBe(0);
      expect(lb.entries[0]!.requireApprovalCount).toBe(0);
    });
  });

  describe("boundary violations and tool denials", () => {
    it("boundaryViolationCount matches BOUNDARY_VIOLATION event count", () => {
      const events = [
        ...makeMinimalRun("run-1", "task-1"),
        makeEvent("run-1", {
          event_type: "BOUNDARY_VIOLATION",
          task_id: "task-1",
          payload: { violationType: "BLOCKED_FILE_MODIFIED", file: ".env", message: "blocked" },
        }),
        makeEvent("run-1", {
          event_type: "BOUNDARY_VIOLATION",
          task_id: "task-1",
          payload: { violationType: "UNOWNED_FILE_MODIFIED", file: "other.ts", message: "unowned" },
        }),
      ];
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.boundaryViolationCount).toBe(2);
    });

    it("toolDenialCount matches TOOL_DENIED event count", () => {
      const events = [
        ...makeMinimalRun("run-1", "task-1"),
        makeEvent("run-1", {
          event_type: "TOOL_DENIED",
          task_id: "task-1",
          payload: { toolName: "write_file", path: ".env", reason: "blocked", violationType: "BLOCKED_FILE" },
        }),
      ];
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.toolDenialCount).toBe(1);
    });
  });

  describe("risk score", () => {
    it("riskScore > 0 for task with patch risks", () => {
      const events = [
        ...makeMinimalRun("run-1", "task-1"),
        makeEvent("run-1", {
          event_type: "PATCH_RISK_DETECTED",
          task_id: "task-1",
          payload: {
            risks: [{
              pattern: "api_key",
              severity: "critical",
              category: "secret",
              filePath: "src/config.ts",
              lineNumber: 1,
              lineContext: "const KEY = 'x'",
            }],
          },
        }),
      ];
      const lb = buildLeaderboard(events);
      expect(lb.entries[0]!.riskScore).toBeGreaterThan(0);
    });
  });

  describe("cross-run aggregation", () => {
    it("entries from multiple runs all appear", () => {
      const eventsA = makeMinimalRun("run-A", "task-a1");
      const eventsB = makeMinimalRun("run-B", "task-b1");
      const lb = buildLeaderboard([...eventsA, ...eventsB]);
      expect(lb.entries).toHaveLength(2);
      const runIds = lb.entries.map((e) => e.runId);
      expect(runIds).toContain("run-A");
      expect(runIds).toContain("run-B");
    });

    it("entries from same run with multiple tasks all appear", () => {
      const base = [
        makeEvent("run-1", { event_type: "RUN_CREATED", payload: { goal: "goal" } }),
        makeEvent("run-1", { event_type: "INTENT_COMPILED", payload: { taskCount: 2 } }),
        makeEvent("run-1", {
          event_type: "TASK_CREATED",
          task_id: "task-1",
          payload: { title: "Task 1", owner: "dev-a", dependencies: [], allowedFiles: [], blockedFiles: [] },
        }),
        makeEvent("run-1", {
          event_type: "TASK_CREATED",
          task_id: "task-2",
          payload: { title: "Task 2", owner: "dev-b", dependencies: ["task-1"], allowedFiles: [], blockedFiles: [] },
        }),
        makeEvent("run-1", { event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
        makeEvent("run-1", { event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
        makeEvent("run-1", { event_type: "PATCH_PROPOSED", task_id: "task-1", payload: { filesModified: [], summary: "" } }),
        makeEvent("run-1", { event_type: "VERIFICATION_STARTED", task_id: "task-1", payload: {} }),
        makeEvent("run-1", { event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
        makeEvent("run-1", { event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
        makeEvent("run-1", { event_type: "TASK_ASSIGNED", task_id: "task-2", payload: { owner: "dev-b" } }),
        makeEvent("run-1", { event_type: "TASK_STARTED", task_id: "task-2", payload: {} }),
        makeEvent("run-1", { event_type: "PATCH_PROPOSED", task_id: "task-2", payload: { filesModified: [], summary: "" } }),
        makeEvent("run-1", { event_type: "VERIFICATION_STARTED", task_id: "task-2", payload: {} }),
        makeEvent("run-1", { event_type: "VERIFICATION_PASSED", task_id: "task-2", payload: {} }),
        makeEvent("run-1", { event_type: "TASK_COMPLETED", task_id: "task-2", payload: {} }),
        makeEvent("run-1", { event_type: "RUN_COMPLETED", payload: { completedTasks: ["task-1", "task-2"], failedTasks: [] } }),
      ];
      const lb = buildLeaderboard(base);
      expect(lb.entries).toHaveLength(2);
    });
  });

  describe("sorting", () => {
    it("entries sorted by riskScore descending", () => {
      const eventsA = makeMinimalRun("run-A", "task-a");
      // Add a secret risk to run-A so it has higher score
      eventsA.push(
        makeEvent("run-A", {
          event_type: "PATCH_RISK_DETECTED",
          task_id: "task-a",
          payload: {
            risks: [{
              pattern: "api_key",
              severity: "critical",
              category: "secret",
              filePath: "f.ts",
              lineNumber: 1,
              lineContext: "",
            }],
          },
        }),
      );
      const eventsB = makeMinimalRun("run-B", "task-b");
      const lb = buildLeaderboard([...eventsA, ...eventsB]);
      expect(lb.entries[0]!.runId).toBe("run-A");
      expect(lb.entries[0]!.riskScore).toBeGreaterThan(lb.entries[1]!.riskScore);
    });

    it("ties in riskScore maintain stable order (taskId alphabetical)", () => {
      const eventsA = makeMinimalRun("run-A", "task-a");
      const eventsB = makeMinimalRun("run-B", "task-b");
      const lb = buildLeaderboard([...eventsA, ...eventsB]);
      // Both have score 0 — stable sort: task-a before task-b
      expect(lb.entries[0]!.taskId).toBe("task-a");
    });
  });
});
