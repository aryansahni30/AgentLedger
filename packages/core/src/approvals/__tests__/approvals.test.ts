import { describe, it, expect } from "vitest";
import { shouldRequireApproval } from "../approvalPolicy.js";
import {
  getPendingApprovals,
  isApproved,
  isRejected,
  isAwaitingApproval,
} from "../approvalState.js";
import { computeHash } from "../../ledger/hashChain.js";
import type {
  AgentTask,
  ApprovalPolicy,
  LedgerEvent,
  LedgerEventType,
  WorkerResult,
} from "../../schemas/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GENESIS = "genesis";
const RUN_ID = "run-approval-test";
let seq = 0;

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

const mockTask: AgentTask = {
  taskId: "task-1",
  runId: RUN_ID,
  title: "Add Redis caching to user service",
  description: "Implement Redis caching for the user lookup endpoint",
  owner: "worker-1",
  dependencies: [],
  allowedFiles: ["src/user.ts", "src/cache.ts"],
  blockedFiles: [".env", "src/auth.ts"],
  allowedTools: ["read_file", "write_file"],
  expectedOutputs: [],
  successCriteria: [],
  status: "running",
};

const mockResult: WorkerResult = {
  taskId: "task-1",
  summary: "Added Redis caching to user service, updated cache.ts",
  filesRead: ["src/user.ts"],
  filesModified: ["src/user.ts", "src/cache.ts"],
  worktreeBranch: "agentledger/task-1",
  output: {},
};

const defaultPolicy: ApprovalPolicy = {
  requireApprovalFor: ["high_risk_keywords"],
  mode: "post_patch",
};

// ─── shouldRequireApproval ────────────────────────────────────────────────────

describe("shouldRequireApproval", () => {
  describe('trigger: "all"', () => {
    it("always requires approval", () => {
      const policy: ApprovalPolicy = { requireApprovalFor: ["all"], mode: "post_patch" };
      const result = shouldRequireApproval(mockTask, mockResult, policy);
      expect(result.required).toBe(true);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatch(/all/);
    });

    it("requires approval even for benign changes", () => {
      const benignResult: WorkerResult = {
        ...mockResult,
        summary: "Fixed a typo in README",
        filesModified: ["README.md"],
      };
      const policy: ApprovalPolicy = { requireApprovalFor: ["all"], mode: "post_patch" };
      const result = shouldRequireApproval(mockTask, benignResult, policy);
      expect(result.required).toBe(true);
    });
  });

  describe('trigger: "high_risk_keywords"', () => {
    it("fires on keyword in worker summary", () => {
      const result: WorkerResult = {
        ...mockResult,
        summary: "Updated authentication middleware to support OAuth",
        filesModified: ["src/middleware.ts"],
      };
      const decision = shouldRequireApproval(mockTask, result, defaultPolicy);
      expect(decision.required).toBe(true);
      expect(decision.reasons[0]).toMatch(/auth/);
    });

    it("fires on keyword in task title", () => {
      const task: AgentTask = {
        ...mockTask,
        title: "Update payment processing logic",
        description: "No-op description",
      };
      const result: WorkerResult = {
        ...mockResult,
        summary: "Just updated some files",
        filesModified: ["src/checkout.ts"],
      };
      const decision = shouldRequireApproval(task, result, defaultPolicy);
      expect(decision.required).toBe(true);
      expect(decision.reasons[0]).toMatch(/payment/);
    });

    it("fires on keyword in task description", () => {
      const task: AgentTask = {
        ...mockTask,
        title: "Routine update",
        description: "Modify the production database schema migration script",
      };
      const decision = shouldRequireApproval(task, mockResult, defaultPolicy);
      expect(decision.required).toBe(true);
      expect(decision.reasons[0]).toMatch(/prod|migration|schema/);
    });

    it("fires on keyword in filesModified path", () => {
      const result: WorkerResult = {
        ...mockResult,
        summary: "Updated config",
        filesModified: ["config/production.yaml"],
      };
      const decision = shouldRequireApproval(mockTask, result, defaultPolicy);
      expect(decision.required).toBe(true);
      expect(decision.reasons[0]).toMatch(/prod/);
    });

    it("is case-insensitive", () => {
      const result: WorkerResult = {
        ...mockResult,
        summary: "Updated AUTH middleware",
        filesModified: ["src/middleware.ts"],
      };
      const decision = shouldRequireApproval(mockTask, result, defaultPolicy);
      expect(decision.required).toBe(true);
    });

    it("does NOT fire on benign changes", () => {
      const task: AgentTask = {
        ...mockTask,
        title: "Fix typo in README",
        description: "Correct a spelling mistake",
      };
      const result: WorkerResult = {
        ...mockResult,
        summary: "Fixed typo",
        filesModified: ["README.md"],
      };
      const decision = shouldRequireApproval(task, result, defaultPolicy);
      expect(decision.required).toBe(false);
      expect(decision.reasons).toHaveLength(0);
    });

    it("includes at most 3 matched keywords in reason string", () => {
      const result: WorkerResult = {
        ...mockResult,
        summary: "Updated auth payment token credential admin billing",
        filesModified: ["src/misc.ts"],
      };
      const decision = shouldRequireApproval(mockTask, result, defaultPolicy);
      expect(decision.required).toBe(true);
      // Reason should contain up to 3 keywords
      const reason = decision.reasons[0]!;
      const commaCount = (reason.match(/,/g) ?? []).length;
      expect(commaCount).toBeLessThanOrEqual(2);
    });
  });

  describe('trigger: "new_dependencies"', () => {
    it("fires when package.json is modified", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["new_dependencies"],
        mode: "post_patch",
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["src/utils.ts", "package.json"],
      };
      const decision = shouldRequireApproval(mockTask, result, policy);
      expect(decision.required).toBe(true);
      expect(decision.reasons[0]).toMatch(/package\.json/);
    });

    it("fires when pnpm-lock.yaml is modified", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["new_dependencies"],
        mode: "post_patch",
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["pnpm-lock.yaml"],
      };
      const decision = shouldRequireApproval(mockTask, result, policy);
      expect(decision.required).toBe(true);
      expect(decision.reasons[0]).toMatch(/pnpm-lock\.yaml/);
    });

    it("fires on nested package.json path", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["new_dependencies"],
        mode: "post_patch",
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["packages/core/package.json"],
      };
      const decision = shouldRequireApproval(mockTask, result, policy);
      expect(decision.required).toBe(true);
    });

    it("does NOT fire for non-dependency files", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["new_dependencies"],
        mode: "post_patch",
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["src/utils.ts", "src/index.ts"],
      };
      const decision = shouldRequireApproval(mockTask, result, policy);
      expect(decision.required).toBe(false);
    });
  });

  describe('trigger: "blocked_files_nearby"', () => {
    it("fires when modified file is in same dir as blocked file", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["blocked_files_nearby"],
        mode: "post_patch",
      };
      const task: AgentTask = {
        ...mockTask,
        blockedFiles: ["src/auth.ts"],
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["src/user.ts"],
      };
      const decision = shouldRequireApproval(task, result, policy);
      expect(decision.required).toBe(true);
      expect(decision.reasons[0]).toMatch(/src/);
    });

    it("does NOT fire when files are in different directories", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["blocked_files_nearby"],
        mode: "post_patch",
      };
      const task: AgentTask = {
        ...mockTask,
        blockedFiles: ["config/secrets.ts"],
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["src/user.ts"],
      };
      const decision = shouldRequireApproval(task, result, policy);
      expect(decision.required).toBe(false);
    });

    it("does NOT fire for root-level files with empty dir overlap", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["blocked_files_nearby"],
        mode: "post_patch",
      };
      const task: AgentTask = {
        ...mockTask,
        blockedFiles: [".env"],
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["README.md"],
      };
      const decision = shouldRequireApproval(task, result, policy);
      expect(decision.required).toBe(false);
    });
  });

  describe("multiple triggers", () => {
    it("accumulates reasons from all fired triggers", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["all", "high_risk_keywords"],
        mode: "post_patch",
      };
      const result: WorkerResult = {
        ...mockResult,
        summary: "Updated auth service",
      };
      const decision = shouldRequireApproval(mockTask, result, policy);
      expect(decision.required).toBe(true);
      expect(decision.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it("returns required=false when no triggers fire", () => {
      const policy: ApprovalPolicy = {
        requireApprovalFor: ["new_dependencies", "blocked_files_nearby"],
        mode: "post_patch",
      };
      const task: AgentTask = {
        ...mockTask,
        blockedFiles: ["config/secrets.ts"],
      };
      const result: WorkerResult = {
        ...mockResult,
        filesModified: ["src/utils.ts"],
        summary: "Fixed utils",
      };
      const decision = shouldRequireApproval(task, result, policy);
      expect(decision.required).toBe(false);
      expect(decision.reasons).toHaveLength(0);
    });
  });
});

// ─── getPendingApprovals ──────────────────────────────────────────────────────

describe("getPendingApprovals", () => {
  it("returns empty array when no approval events exist", () => {
    const events = chainEvents(baseEvent("RUN_CREATED", { goal: "goal" }));
    expect(getPendingApprovals(events)).toEqual([]);
  });

  it("returns pending approval when HUMAN_APPROVAL_REQUESTED has no resolution", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent(
        "HUMAN_APPROVAL_REQUESTED",
        { reasons: ["high risk"], filesModified: ["src/auth.ts"], summary: "Updated auth" },
        "task-1",
      ),
    );
    const pending = getPendingApprovals(events);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.taskId).toBe("task-1");
    expect(pending[0]!.runId).toBe(RUN_ID);
    expect(pending[0]!.reasons).toEqual(["high risk"]);
    expect(pending[0]!.filesModified).toEqual(["src/auth.ts"]);
    expect(pending[0]!.summary).toBe("Updated auth");
  });

  it("excludes approved requests", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r"], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
    );
    expect(getPendingApprovals(events)).toHaveLength(0);
  });

  it("excludes rejected requests", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r"], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REJECTED", {}, "task-1"),
    );
    expect(getPendingApprovals(events)).toHaveLength(0);
  });

  it("returns multiple pending approvals from different tasks in same run", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r1"], filesModified: [], summary: "s1" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r2"], filesModified: [], summary: "s2" }, "task-2"),
    );
    const pending = getPendingApprovals(events);
    expect(pending).toHaveLength(2);
    const taskIds = pending.map((p) => p.taskId);
    expect(taskIds).toContain("task-1");
    expect(taskIds).toContain("task-2");
  });

  it("handles mixed resolved + pending correctly", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r1"], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r2"], filesModified: [], summary: "" }, "task-2"),
    );
    const pending = getPendingApprovals(events);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.taskId).toBe("task-2");
  });

  it("ignores events without task_id", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      // HUMAN_APPROVAL_REQUESTED without task_id — malformed, should be ignored
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: [], filesModified: [], summary: "" }),
    );
    // Should not include entries where taskId is undefined
    const pending = getPendingApprovals(events);
    expect(pending).toHaveLength(0);
  });
});

// ─── isApproved / isRejected / isAwaitingApproval ────────────────────────────

describe("isApproved", () => {
  it("returns false when no approval events exist", () => {
    const events = chainEvents(baseEvent("RUN_CREATED", { goal: "goal" }));
    expect(isApproved(events, "task-1")).toBe(false);
  });

  it("returns true after HUMAN_APPROVAL_GRANTED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: [], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
    );
    expect(isApproved(events, "task-1")).toBe(true);
  });

  it("returns false when only REJECTED exists", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: [], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REJECTED", {}, "task-1"),
    );
    expect(isApproved(events, "task-1")).toBe(false);
  });

  it("returns false when both GRANTED and REJECTED exist", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: [], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
      baseEvent("HUMAN_APPROVAL_REJECTED", {}, "task-1"),
    );
    expect(isApproved(events, "task-1")).toBe(false);
  });

  it("checks only the specific task ID", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: [], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
    );
    expect(isApproved(events, "task-2")).toBe(false);
  });
});

describe("isRejected", () => {
  it("returns false when no rejection event exists", () => {
    const events = chainEvents(baseEvent("RUN_CREATED", { goal: "goal" }));
    expect(isRejected(events, "task-1")).toBe(false);
  });

  it("returns true after HUMAN_APPROVAL_REJECTED", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: [], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REJECTED", { reason: "too risky" }, "task-1"),
    );
    expect(isRejected(events, "task-1")).toBe(true);
  });

  it("returns false when only GRANTED exists", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: [], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
    );
    expect(isRejected(events, "task-1")).toBe(false);
  });
});

describe("isAwaitingApproval", () => {
  it("returns false when no approval request exists", () => {
    const events = chainEvents(baseEvent("RUN_CREATED", { goal: "goal" }));
    expect(isAwaitingApproval(events, "task-1")).toBe(false);
  });

  it("returns true when unresolved HUMAN_APPROVAL_REQUESTED exists", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r"], filesModified: [], summary: "" }, "task-1"),
    );
    expect(isAwaitingApproval(events, "task-1")).toBe(true);
  });

  it("returns false once HUMAN_APPROVAL_GRANTED fires", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r"], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
    );
    expect(isAwaitingApproval(events, "task-1")).toBe(false);
  });

  it("returns false once HUMAN_APPROVAL_REJECTED fires", () => {
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "goal" }),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r"], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REJECTED", {}, "task-1"),
    );
    expect(isAwaitingApproval(events, "task-1")).toBe(false);
  });
});

// ─── replayLedger integration — approval state machine ───────────────────────

describe("replayLedger integration — approval state transitions", () => {
  // Import replayLedger only here to avoid circular dep at module level
  it("run transitions to paused on HUMAN_APPROVAL_REQUESTED", async () => {
    const { replayLedger } = await import("../../replay/replayLedger.js");
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "approve test" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T",
        description: "",
        owner: "w",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", {}, "task-1"),
      baseEvent("TASK_STARTED", {}, "task-1"),
      baseEvent("PATCH_PROPOSED", { filesModified: ["src/auth.ts"], summary: "s" }, "task-1"),
      baseEvent(
        "HUMAN_APPROVAL_REQUESTED",
        { reasons: ["auth keyword"], filesModified: ["src/auth.ts"], summary: "s" },
        "task-1",
      ),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.status).toBe("paused");
    expect(state.tasks[0]!.status).toBe("awaiting_approval");
  });

  it("run returns to executing after HUMAN_APPROVAL_GRANTED", async () => {
    const { replayLedger } = await import("../../replay/replayLedger.js");
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "approve test" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T",
        description: "",
        owner: "w",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", {}, "task-1"),
      baseEvent("TASK_STARTED", {}, "task-1"),
      baseEvent("PATCH_PROPOSED", { filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r"], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_GRANTED", {}, "task-1"),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.status).toBe("executing");
    expect(state.tasks[0]!.status).toBe("awaiting_verification");
  });

  it("task transitions to failed on HUMAN_APPROVAL_REJECTED", async () => {
    const { replayLedger } = await import("../../replay/replayLedger.js");
    const events = chainEvents(
      baseEvent("RUN_CREATED", { goal: "approve test" }),
      baseEvent("INTENT_COMPILED", {}),
      baseEvent("TASK_CREATED", {
        taskId: "task-1",
        title: "T",
        description: "",
        owner: "w",
        dependencies: [],
        allowedFiles: [],
        blockedFiles: [],
        allowedTools: [],
      }),
      baseEvent("TASK_ASSIGNED", {}, "task-1"),
      baseEvent("TASK_STARTED", {}, "task-1"),
      baseEvent("PATCH_PROPOSED", { filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REQUESTED", { reasons: ["r"], filesModified: [], summary: "" }, "task-1"),
      baseEvent("HUMAN_APPROVAL_REJECTED", { reason: "too risky" }, "task-1"),
    );
    const state = replayLedger(events, RUN_ID);
    expect(state.tasks[0]!.status).toBe("failed");
  });
});
