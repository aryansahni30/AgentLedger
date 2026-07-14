import { describe, it, expect, beforeEach } from "vitest";
import { generateHandoffBrief } from "../generateHandoffBrief.js";
import type { LedgerEvent } from "../../schemas/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RUN_ID = "run-brief-1";
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
    makeEvent({ event_type: "RUN_CREATED", payload: { goal: "Add caching layer", riskLevel: "medium" } }),
    makeEvent({ event_type: "INTENT_COMPILED", payload: {} }),
  ];
}

function taskCreated(taskId: string, title: string, deps: string[] = []): LedgerEvent {
  return makeEvent({
    event_type: "TASK_CREATED",
    task_id: taskId,
    payload: { title, owner: "dev-a", dependencies: deps, allowedFiles: ["src/**"], blockedFiles: [".env"] },
  });
}

beforeEach(() => { seq = 0; });

// ─── Basic structure ──────────────────────────────────────────────────────────

describe("generateHandoffBrief — basic structure", () => {
  it("returns correct runId, goal, generatedAt", () => {
    const events = baseRun();
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.runId).toBe(RUN_ID);
    expect(brief.goal).toBe("Add caching layer");
    expect(brief.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("empty run has all task arrays empty", () => {
    const events = baseRun();
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.completedTasks).toHaveLength(0);
    expect(brief.failedTasks).toHaveLength(0);
    expect(brief.pendingTasks).toHaveLength(0);
    expect(brief.inProgressTasks).toHaveLength(0);
    expect(brief.awaitingApproval).toHaveLength(0);
  });

  it("fileInventory has empty arrays for empty run", () => {
    const events = baseRun();
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.fileInventory.mergedFiles).toHaveLength(0);
    expect(brief.fileInventory.worktreeFiles).toHaveLength(0);
    expect(brief.fileInventory.allFiles).toHaveLength(0);
  });

  it("contextSummary is non-empty string", () => {
    const events = baseRun();
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(typeof brief.contextSummary).toBe("string");
    expect(brief.contextSummary.length).toBeGreaterThan(0);
  });

  it("contextSummary includes runId and goal", () => {
    const events = baseRun();
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.contextSummary).toContain(RUN_ID);
    expect(brief.contextSummary).toContain("Add caching layer");
  });

  it("contextSummary never exceeds 2000 chars", () => {
    // Build a run with many tasks to stress the truncation
    const events = baseRun();
    for (let i = 1; i <= 20; i++) {
      events.push(taskCreated(`task-${i}`, `Very long task title number ${i} that goes on and on`, []));
    }
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.contextSummary.length).toBeLessThanOrEqual(2000);
  });
});

// ─── Failure classification — boundary_violation ─────────────────────────────

describe("generateHandoffBrief — classifyFailure: boundary_violation", () => {
  function makeBoundaryViolationRun(): LedgerEvent[] {
    return [
      ...baseRun(),
      taskCreated("task-1", "Patch auth"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "BOUNDARY_VIOLATION",
        task_id: "task-1",
        payload: { file: ".env", violationType: "BLOCKED_FILE_MODIFIED", message: "touched blocked file .env" },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
  }

  it("reason is boundary_violation", () => {
    const brief = generateHandoffBrief(makeBoundaryViolationRun(), RUN_ID);
    expect(brief.failedTasks[0]!.reason).toBe("boundary_violation");
  });

  it("context.violatedFile captured", () => {
    const brief = generateHandoffBrief(makeBoundaryViolationRun(), RUN_ID);
    expect(brief.failedTasks[0]!.context?.violatedFile).toBe(".env");
  });

  it("context.violationType captured", () => {
    const brief = generateHandoffBrief(makeBoundaryViolationRun(), RUN_ID);
    expect(brief.failedTasks[0]!.context?.violationType).toBe("BLOCKED_FILE_MODIFIED");
  });

  it("context.detail captured from message", () => {
    const brief = generateHandoffBrief(makeBoundaryViolationRun(), RUN_ID);
    expect(brief.failedTasks[0]!.context?.detail).toBe("touched blocked file .env");
  });
});

// ─── Failure classification — verification_failed ────────────────────────────

describe("generateHandoffBrief — classifyFailure: verification_failed", () => {
  function makeVerificationFailRun(): LedgerEvent[] {
    return [
      ...baseRun(),
      taskCreated("task-1", "Run tests"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "VERIFICATION_FAILED",
        task_id: "task-1",
        payload: { exitCode: 1, reason: "npm test exited with code 1" },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
  }

  it("reason is verification_failed", () => {
    const brief = generateHandoffBrief(makeVerificationFailRun(), RUN_ID);
    expect(brief.failedTasks[0]!.reason).toBe("verification_failed");
  });

  it("context.exitCode captured", () => {
    const brief = generateHandoffBrief(makeVerificationFailRun(), RUN_ID);
    expect(brief.failedTasks[0]!.context?.exitCode).toBe(1);
  });

  it("context.detail captured from reason field", () => {
    const brief = generateHandoffBrief(makeVerificationFailRun(), RUN_ID);
    expect(brief.failedTasks[0]!.context?.detail).toBe("npm test exited with code 1");
  });
});

// ─── Failure classification — governance_denied ───────────────────────────────

describe("generateHandoffBrief — classifyFailure: governance_denied", () => {
  function makeGovernanceDenyRun(): LedgerEvent[] {
    return [
      ...baseRun(),
      taskCreated("task-1", "Mutate schema"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-1",
        payload: { action: "deny", reasons: ["schema_mutation detected", "critical severity"] },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
  }

  it("reason is governance_denied", () => {
    const brief = generateHandoffBrief(makeGovernanceDenyRun(), RUN_ID);
    expect(brief.failedTasks[0]!.reason).toBe("governance_denied");
  });

  it("context.detail is joined reasons", () => {
    const brief = generateHandoffBrief(makeGovernanceDenyRun(), RUN_ID);
    expect(brief.failedTasks[0]!.context?.detail).toBe("schema_mutation detected; critical severity");
  });

  it("POLICY_EVALUATED with action=allow does NOT trigger governance_denied", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Safe task"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-1",
        payload: { action: "allow", reasons: [] },
      }),
      // Later fails for a different reason
      makeEvent({
        event_type: "VERIFICATION_FAILED",
        task_id: "task-1",
        payload: { exitCode: 2, reason: "lint failed" },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.failedTasks[0]!.reason).toBe("verification_failed");
  });
});

// ─── Failure classification — human_approval_rejected ────────────────────────

describe("generateHandoffBrief — classifyFailure: human_approval_rejected", () => {
  it("reason is human_approval_rejected", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Deploy to prod"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "HUMAN_APPROVAL_REQUESTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "HUMAN_APPROVAL_REJECTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.failedTasks[0]!.reason).toBe("human_approval_rejected");
  });

  it("context is undefined for human_approval_rejected (no structured context)", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Deploy to prod"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "HUMAN_APPROVAL_REJECTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.failedTasks[0]!.context).toBeUndefined();
  });
});

// ─── Failure classification — tool_denial ────────────────────────────────────

describe("generateHandoffBrief — classifyFailure: tool_denial", () => {
  it("reason is tool_denial", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Run deploy script"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "TOOL_DENIED",
        task_id: "task-1",
        payload: { toolName: "Bash", violationType: "UNOWNED_FILE" },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.failedTasks[0]!.reason).toBe("tool_denial");
  });

  it("context.toolName and violationType captured", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Run deploy script"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "TOOL_DENIED",
        task_id: "task-1",
        payload: { toolName: "Bash", violationType: "BLOCKED_FILE" },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.failedTasks[0]!.context?.toolName).toBe("Bash");
    expect(brief.failedTasks[0]!.context?.violationType).toBe("BLOCKED_FILE");
  });
});

// ─── Failure classification — unknown fallback ────────────────────────────────

describe("generateHandoffBrief — classifyFailure: unknown fallback", () => {
  it("reason is unknown when no recognizable failure event", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Mystery failure"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.failedTasks[0]!.reason).toBe("unknown");
  });
});

// ─── File inventory ───────────────────────────────────────────────────────────

describe("generateHandoffBrief — fileInventory", () => {
  function completedTaskWithFiles(files: string[]): LedgerEvent[] {
    return [
      ...baseRun(),
      taskCreated("task-1", "Completed work"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-1",
        payload: { summary: "done", filesModified: files },
      }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
    ];
  }

  it("completed task files appear in mergedFiles", () => {
    const brief = generateHandoffBrief(completedTaskWithFiles(["src/a.ts", "src/b.ts"]), RUN_ID);
    expect(brief.fileInventory.mergedFiles).toContain("src/a.ts");
    expect(brief.fileInventory.mergedFiles).toContain("src/b.ts");
  });

  it("completed task files NOT in worktreeFiles", () => {
    const brief = generateHandoffBrief(completedTaskWithFiles(["src/a.ts"]), RUN_ID);
    expect(brief.fileInventory.worktreeFiles).not.toContain("src/a.ts");
  });

  it("failed task files appear in worktreeFiles not mergedFiles", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Failed work"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-1",
        payload: { summary: "partial", filesModified: ["src/broken.ts"] },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.fileInventory.worktreeFiles).toContain("src/broken.ts");
    expect(brief.fileInventory.mergedFiles).not.toContain("src/broken.ts");
  });

  it("allFiles is union of merged and worktree, no duplicates", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Completed"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-1",
        payload: { summary: "", filesModified: ["src/shared.ts", "src/done.ts"] },
      }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
      taskCreated("task-2", "Failed"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-2", payload: { owner: "dev-b" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-2", payload: {} }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-2",
        payload: { summary: "", filesModified: ["src/shared.ts", "src/wip.ts"] },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-2", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    const all = brief.fileInventory.allFiles;
    // No duplicates
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("src/shared.ts");
    expect(all).toContain("src/done.ts");
    expect(all).toContain("src/wip.ts");
  });
});

// ─── Unresolved risks ─────────────────────────────────────────────────────────

describe("generateHandoffBrief — unresolvedRisks", () => {
  it("risks on non-completed tasks surface as unresolvedRisks", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Risky work"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_RISK_DETECTED",
        task_id: "task-1",
        payload: {
          risks: [
            { category: "secret", severity: "critical", filePath: "src/config.ts", pattern: "API_KEY" },
          ],
        },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.unresolvedRisks).toHaveLength(1);
    expect(brief.unresolvedRisks[0]!.category).toBe("secret");
    expect(brief.unresolvedRisks[0]!.severity).toBe("critical");
    expect(brief.unresolvedRisks[0]!.filePath).toBe("src/config.ts");
  });

  it("risks on completed tasks do NOT surface as unresolvedRisks", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Done safely"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_RISK_DETECTED",
        task_id: "task-1",
        payload: {
          risks: [
            { category: "auth_code", severity: "high", filePath: "src/auth.ts", pattern: "password" },
          ],
        },
      }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.unresolvedRisks).toHaveLength(0);
  });

  it("risks sorted by severity: critical > high > medium", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Multi-risk work"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_RISK_DETECTED",
        task_id: "task-1",
        payload: {
          risks: [
            { category: "dependency_change", severity: "medium", filePath: "package.json", pattern: "lodash" },
            { category: "secret", severity: "critical", filePath: "src/config.ts", pattern: "SECRET" },
            { category: "auth_code", severity: "high", filePath: "src/auth.ts", pattern: "jwt" },
          ],
        },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    const severities = brief.unresolvedRisks.map((r) => r.severity);
    expect(severities[0]).toBe("critical");
    expect(severities[1]).toBe("high");
    expect(severities[2]).toBe("medium");
  });

  it("capped at top 5 risks", () => {
    const risks = Array.from({ length: 8 }, (_, i) => ({
      category: "schema_mutation",
      severity: "medium",
      filePath: `src/file-${i}.ts`,
      pattern: "ALTER TABLE",
    }));
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Mass schema change"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "PATCH_RISK_DETECTED", task_id: "task-1", payload: { risks } }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.unresolvedRisks.length).toBeLessThanOrEqual(5);
  });
});

// ─── Resumption guidance ──────────────────────────────────────────────────────

describe("generateHandoffBrief — resumptionGuidance", () => {
  it("action=run_completed when run is completed", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Done"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "RUN_COMPLETED", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.resumptionGuidance.action).toBe("run_completed");
  });

  it("action=approve_pending when tasks await approval", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Awaiting deploy approval"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "PATCH_PROPOSED", task_id: "task-1", payload: { summary: "", filesModified: [] } }),
      makeEvent({ event_type: "HUMAN_APPROVAL_REQUESTED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.resumptionGuidance.action).toBe("approve_pending");
    expect(brief.resumptionGuidance.targetTaskId).toBe("task-1");
    expect(brief.resumptionGuidance.command).toContain(RUN_ID);
  });

  it("action=retry_failed_task when tasks failed but work remains", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Failed step"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "VERIFICATION_FAILED", task_id: "task-1", payload: { exitCode: 1, reason: "tests fail" } }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
      // There's a pending task that can still run
      taskCreated("task-2", "Next step", []),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.resumptionGuidance.action).toBe("retry_failed_task");
    expect(brief.resumptionGuidance.targetTaskId).toBe("task-1");
  });

  it("action=investigate_failure when tasks failed and no remaining work", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Only task — failed"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "RUN_FAILED", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.resumptionGuidance.action).toBe("investigate_failure");
    expect(brief.resumptionGuidance.command).toContain("audit");
    expect(brief.resumptionGuidance.command).toContain(RUN_ID);
  });

  it("action=resume_run when tasks are pending but not failed or awaiting", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Pending ready task"),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.resumptionGuidance.action).toBe("resume_run");
    expect(brief.resumptionGuidance.command).toContain("resume");
    expect(brief.resumptionGuidance.command).toContain(RUN_ID);
  });

  it("guidance detail is non-empty string", () => {
    const brief = generateHandoffBrief(baseRun(), RUN_ID);
    expect(typeof brief.resumptionGuidance.detail).toBe("string");
    expect(brief.resumptionGuidance.detail.length).toBeGreaterThan(0);
  });
});

// ─── Task bucketing ───────────────────────────────────────────────────────────

describe("generateHandoffBrief — task status bucketing", () => {
  it("running task goes into inProgressTasks", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "In-flight task"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.inProgressTasks).toHaveLength(1);
    expect(brief.inProgressTasks[0]!.title).toBe("In-flight task");
    expect(brief.pendingTasks).toHaveLength(0);
  });

  it("awaiting_verification task goes into inProgressTasks", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Verifying"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "VERIFICATION_STARTED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.inProgressTasks).toHaveLength(1);
  });

  it("pending task with unfinished dep shows blockedBy", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "First"),
      taskCreated("task-2", "Second", ["task-1"]),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    const t2 = brief.pendingTasks.find((t) => t.taskId === "task-2");
    expect(t2?.blockedBy).toContain("task-1");
  });

  it("pending task with completed dep shows empty blockedBy", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "First"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
      taskCreated("task-2", "Second", ["task-1"]),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    const t2 = brief.pendingTasks.find((t) => t.taskId === "task-2");
    expect(t2?.blockedBy).toHaveLength(0);
  });

  it("awaiting_approval task goes into awaitingApproval with requestedAt", () => {
    const approvalTs = new Date(Date.UTC(2026, 0, 10)).toISOString();
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Needs sign-off"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "HUMAN_APPROVAL_REQUESTED",
        task_id: "task-1",
        timestamp: approvalTs,
        payload: {},
      }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.awaitingApproval).toHaveLength(1);
    expect(brief.awaitingApproval[0]!.requestedAt).toBe(approvalTs);
  });

  it("completed task carries filesModified from latest PATCH_PROPOSED", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Completed"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-1",
        payload: { summary: "first attempt", filesModified: ["src/old.ts"] },
      }),
      makeEvent({
        event_type: "PATCH_PROPOSED",
        task_id: "task-1",
        payload: { summary: "final", filesModified: ["src/new.ts"] },
      }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    // Last PATCH_PROPOSED wins
    expect(brief.completedTasks[0]!.filesModified).toContain("src/new.ts");
  });
});

// ─── contextSummary format ────────────────────────────────────────────────────

describe("generateHandoffBrief — contextSummary format", () => {
  it("includes COMPLETED section when tasks completed", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Done thing"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.contextSummary).toContain("COMPLETED");
    expect(brief.contextSummary).toContain("Done thing");
  });

  it("includes FAILED section when tasks failed", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Broken thing"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.contextSummary).toContain("FAILED");
    expect(brief.contextSummary).toContain("Broken thing");
  });

  it("includes AWAITING APPROVAL section", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Needs approval"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "HUMAN_APPROVAL_REQUESTED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.contextSummary).toContain("AWAITING APPROVAL");
  });

  it("includes NEXT and CMD lines", () => {
    const brief = generateHandoffBrief(baseRun(), RUN_ID);
    expect(brief.contextSummary).toContain("NEXT:");
    expect(brief.contextSummary).toContain("CMD:");
  });

  it("includes UNRESOLVED RISKS section when risks present", () => {
    const events = [
      ...baseRun(),
      taskCreated("task-1", "Risky"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({
        event_type: "PATCH_RISK_DETECTED",
        task_id: "task-1",
        payload: {
          risks: [{ category: "secret", severity: "high", filePath: "src/x.ts", pattern: "TOKEN" }],
        },
      }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-1", payload: {} }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.contextSummary).toContain("UNRESOLVED RISKS");
  });
});

// ─── Run isolation ────────────────────────────────────────────────────────────

describe("generateHandoffBrief — run isolation", () => {
  it("events from other runs are ignored", () => {
    const events = [
      ...baseRun(),
      makeEvent({
        event_type: "TASK_CREATED",
        run_id: "other-run",
        task_id: "task-99",
        payload: { title: "Not in this run", owner: "dev-z", dependencies: [], allowedFiles: [], blockedFiles: [] },
      }),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.pendingTasks.find((t) => t.taskId === "task-99")).toBeUndefined();
    expect(brief.completedTasks.find((t) => t.taskId === "task-99")).toBeUndefined();
  });
});

// ─── Mixed run ───────────────────────────────────────────────────────────────

describe("generateHandoffBrief — mixed run", () => {
  it("correctly partitions completed, failed, pending, in-progress", () => {
    const events = [
      ...baseRun(),
      // task-1: completed
      taskCreated("task-1", "Setup DB"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: {} }),
      // task-2: failed
      taskCreated("task-2", "Write migration", ["task-1"]),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-2", payload: { owner: "dev-b" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-2", payload: {} }),
      makeEvent({ event_type: "TASK_FAILED", task_id: "task-2", payload: {} }),
      // task-3: running
      taskCreated("task-3", "Update API"),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-3", payload: { owner: "dev-c" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-3", payload: {} }),
      // task-4: pending
      taskCreated("task-4", "Write docs", ["task-3"]),
    ];
    const brief = generateHandoffBrief(events, RUN_ID);
    expect(brief.completedTasks.map((t) => t.taskId)).toContain("task-1");
    expect(brief.failedTasks.map((t) => t.taskId)).toContain("task-2");
    expect(brief.inProgressTasks.map((t) => t.taskId)).toContain("task-3");
    expect(brief.pendingTasks.map((t) => t.taskId)).toContain("task-4");
  });
});
