import { describe, it, expect } from "vitest";
import { generateAuditReport, computeRiskScore } from "../auditReport.js";
import type { LedgerEvent, AuditTaskRecord, PatchRisk, BoundaryViolation, ToolDenial } from "../../schemas/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RUN_ID = "run-audit-1";
let seq = 0;

function makeEvent(overrides: Partial<LedgerEvent> & Pick<LedgerEvent, "event_type">): LedgerEvent {
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

function makeMinimalRun(runId = RUN_ID): LedgerEvent[] {
  return [
    makeEvent({ event_type: "RUN_CREATED", payload: { goal: "Test goal" } }),
    makeEvent({ event_type: "INTENT_COMPILED", payload: { taskCount: 1 } }),
    makeEvent({
      event_type: "TASK_CREATED",
      task_id: "task-1",
      payload: { title: "Task One", owner: "dev-a", dependencies: [], allowedFiles: [], blockedFiles: [] },
    }),
    makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-1", payload: { owner: "dev-a" } }),
    makeEvent({ event_type: "TASK_STARTED", task_id: "task-1", payload: { worktreePath: "/tmp/wt" } }),
    makeEvent({
      event_type: "PATCH_PROPOSED",
      task_id: "task-1",
      payload: { filesModified: ["src/app.ts"], summary: "Added feature" },
    }),
    makeEvent({ event_type: "VERIFICATION_STARTED", task_id: "task-1", payload: { commandCount: 1 } }),
    makeEvent({ event_type: "VERIFICATION_PASSED", task_id: "task-1", payload: {} }),
    makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-1", payload: { filesModified: ["src/app.ts"] } }),
    makeEvent({ run_id: runId, event_type: "RUN_COMPLETED", payload: { completedTasks: ["task-1"], failedTasks: [] } }),
  ];
}

beforeEach(() => { seq = 0; });

// ─── Basic structure ──────────────────────────────────────────────────────────

describe("generateAuditReport — basic structure", () => {
  it("returns correct runId", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.runId).toBe(RUN_ID);
  });

  it("returns correct goal", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.goal).toBe("Test goal");
  });

  it("returns correct runStatus", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.runStatus).toBe("completed");
  });

  it("includes generatedAt as ISO string", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(() => new Date(report.generatedAt)).not.toThrow();
  });

  it("task count matches run", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.tasks).toHaveLength(1);
  });

  it("allFilesModified contains PATCH_PROPOSED files", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.allFilesModified).toContain("src/app.ts");
  });
});

// ─── Patch risks ──────────────────────────────────────────────────────────────

describe("generateAuditReport — patch risks", () => {
  it("extracts patch risks from PATCH_RISK_DETECTED event", () => {
    const risk: PatchRisk = {
      pattern: "api_key_assignment",
      severity: "critical",
      category: "secret",
      filePath: "src/config.ts",
      lineNumber: 3,
      lineContext: 'const API_KEY = "secret"',
    };
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "PATCH_RISK_DETECTED",
        task_id: "task-1",
        payload: { risks: [risk], count: 1 },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.tasks[0]!.patchRisks).toHaveLength(1);
    expect(report.tasks[0]!.patchRisks[0]!.category).toBe("secret");
  });

  it("returns empty patchRisks when no PATCH_RISK_DETECTED", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.tasks[0]!.patchRisks).toHaveLength(0);
  });
});

// ─── Tool denials ─────────────────────────────────────────────────────────────

describe("generateAuditReport — tool denials", () => {
  it("extracts tool denials from TOOL_DENIED events", () => {
    const denial: ToolDenial = {
      toolName: "write_file",
      path: ".env",
      reason: "File is blocked",
      violationType: "BLOCKED_FILE",
    };
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "TOOL_DENIED",
        task_id: "task-1",
        payload: { ...denial },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.tasks[0]!.toolDenials).toHaveLength(1);
    expect(report.tasks[0]!.toolDenials[0]!.path).toBe(".env");
  });
});

// ─── Boundary violations ──────────────────────────────────────────────────────

describe("generateAuditReport — boundary violations", () => {
  it("extracts boundary violations from BOUNDARY_VIOLATION events", () => {
    const bv: BoundaryViolation = {
      violationType: "BLOCKED_FILE_MODIFIED",
      file: ".env",
      message: "File is blocked",
    };
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "BOUNDARY_VIOLATION",
        task_id: "task-1",
        payload: { ...bv },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.tasks[0]!.boundaryViolations).toHaveLength(1);
    expect(report.tasks[0]!.boundaryViolations[0]!.file).toBe(".env");
  });
});

// ─── Approval record ──────────────────────────────────────────────────────────

describe("generateAuditReport — approval record", () => {
  it("builds approvalRecord when HUMAN_APPROVAL_REQUESTED exists", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "HUMAN_APPROVAL_REQUESTED",
        task_id: "task-1",
        payload: { reasons: ["high_risk"], filesModified: [], summary: "test" },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.tasks[0]!.approvalRecord).toBeDefined();
    expect(report.tasks[0]!.approvalRecord?.reasons).toContain("high_risk");
  });

  it("approvalRecord.grantedAt set from HUMAN_APPROVAL_GRANTED", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "HUMAN_APPROVAL_REQUESTED",
        task_id: "task-1",
        payload: { reasons: [], filesModified: [], summary: "test" },
      }),
      makeEvent({
        event_type: "HUMAN_APPROVAL_GRANTED",
        task_id: "task-1",
        payload: {},
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.tasks[0]!.approvalRecord?.grantedAt).toBeDefined();
  });

  it("approvalRecord undefined when no approval events", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.tasks[0]!.approvalRecord).toBeUndefined();
  });
});

// ─── Approvals summary ────────────────────────────────────────────────────────

describe("generateAuditReport — approvalsSummary", () => {
  it("total=0 when no approvals", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.approvalsSummary.total).toBe(0);
    expect(report.approvalsSummary.granted).toBe(0);
  });

  it("counts granted approval correctly", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({ event_type: "HUMAN_APPROVAL_REQUESTED", task_id: "task-1", payload: { reasons: [], filesModified: [], summary: "" } }),
      makeEvent({ event_type: "HUMAN_APPROVAL_GRANTED", task_id: "task-1", payload: {} }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.approvalsSummary.total).toBe(1);
    expect(report.approvalsSummary.granted).toBe(1);
    expect(report.approvalsSummary.pending).toBe(0);
  });
});

// ─── governanceSummary ────────────────────────────────────────────────────────

describe("generateAuditReport — governanceSummary", () => {
  it("all counts are 0 when no policy decisions", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    const { policyDecisionCounts } = report.governanceSummary;
    expect(policyDecisionCounts.allow).toBe(0);
    expect(policyDecisionCounts.warn).toBe(0);
    expect(policyDecisionCounts.require_approval).toBe(0);
    expect(policyDecisionCounts.deny).toBe(0);
  });

  it("thresholdBreached is false when no RISK_THRESHOLD_BREACHED event", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.governanceSummary.thresholdBreached).toBe(false);
  });

  it("thresholdBreachAction is undefined when no breach", () => {
    const report = generateAuditReport(makeMinimalRun(), RUN_ID);
    expect(report.governanceSummary.thresholdBreachAction).toBeUndefined();
  });

  it("counts allow policy decisions", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-1",
        payload: { decision: { action: "allow", reasons: [], risks: [] } },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.governanceSummary.policyDecisionCounts.allow).toBe(1);
  });

  it("counts warn policy decisions", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-1",
        payload: { decision: { action: "warn", reasons: ["dep"], risks: [] } },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.governanceSummary.policyDecisionCounts.warn).toBe(1);
  });

  it("counts require_approval policy decisions", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-1",
        payload: { decision: { action: "require_approval", reasons: ["schema"], risks: [] } },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.governanceSummary.policyDecisionCounts.require_approval).toBe(1);
  });

  it("counts deny policy decisions", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-1",
        payload: { decision: { action: "deny", reasons: ["secret"], risks: [] } },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.governanceSummary.policyDecisionCounts.deny).toBe(1);
  });

  it("thresholdBreached is true when RISK_THRESHOLD_BREACHED event exists", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "RISK_THRESHOLD_BREACHED",
        payload: { actualScore: 75, threshold: 60, action: "abort" },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.governanceSummary.thresholdBreached).toBe(true);
  });

  it("thresholdBreachAction populated from RISK_THRESHOLD_BREACHED event", () => {
    const events = [
      ...makeMinimalRun(),
      makeEvent({
        event_type: "RISK_THRESHOLD_BREACHED",
        payload: { actualScore: 75, threshold: 60, action: "abort" },
      }),
    ];
    const report = generateAuditReport(events, RUN_ID);
    expect(report.governanceSummary.thresholdBreachAction).toBe("abort");
  });

  it("multiple tasks with different decisions each increment correct counter", () => {
    const events = makeMinimalRun();
    // Add a second task
    events.push(
      makeEvent({
        event_type: "TASK_CREATED",
        task_id: "task-2",
        payload: { title: "Task Two", owner: "dev-b", dependencies: [], allowedFiles: [], blockedFiles: [] },
      }),
      makeEvent({ event_type: "TASK_ASSIGNED", task_id: "task-2", payload: { owner: "dev-b" } }),
      makeEvent({ event_type: "TASK_STARTED", task_id: "task-2", payload: {} }),
      makeEvent({ event_type: "TASK_COMPLETED", task_id: "task-2", payload: {} }),
    );
    // Policy decisions for both tasks
    events.push(
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-1",
        payload: { decision: { action: "warn", reasons: ["dep"], risks: [] } },
      }),
      makeEvent({
        event_type: "POLICY_EVALUATED",
        task_id: "task-2",
        payload: { decision: { action: "deny", reasons: ["secret"], risks: [] } },
      }),
    );
    const report = generateAuditReport(events, RUN_ID);
    expect(report.governanceSummary.policyDecisionCounts.warn).toBe(1);
    expect(report.governanceSummary.policyDecisionCounts.deny).toBe(1);
    expect(report.governanceSummary.policyDecisionCounts.allow).toBe(0);
  });
});

// ─── computeRiskScore ─────────────────────────────────────────────────────────

describe("computeRiskScore", () => {
  function makeRecord(overrides: Partial<AuditTaskRecord> = {}): AuditTaskRecord {
    return {
      taskId: "task-1",
      title: "Task",
      status: "completed",
      filesModified: [],
      patchRisks: [],
      toolDenials: [],
      boundaryViolations: [],
      ...overrides,
    };
  }

  it("returns 0 for clean tasks", () => {
    expect(computeRiskScore([makeRecord()]).total).toBe(0);
  });

  it("adds 20 per secret finding", () => {
    const risk: PatchRisk = { pattern: "p", severity: "critical", category: "secret", filePath: "f", lineNumber: 1, lineContext: "" };
    const score = computeRiskScore([makeRecord({ patchRisks: [risk] })]);
    expect(score.breakdown.secret_exposure).toBe(20);
  });

  it("caps secret_exposure at 40", () => {
    const risk: PatchRisk = { pattern: "p", severity: "critical", category: "secret", filePath: "f", lineNumber: 1, lineContext: "" };
    const score = computeRiskScore([makeRecord({ patchRisks: [risk, risk, risk, risk, risk] })]);
    expect(score.breakdown.secret_exposure).toBe(40);
  });

  it("adds 15 per schema_mutation finding", () => {
    const risk: PatchRisk = { pattern: "p", severity: "high", category: "schema_mutation", filePath: "f", lineNumber: 1, lineContext: "" };
    const score = computeRiskScore([makeRecord({ patchRisks: [risk] })]);
    expect(score.breakdown.schema_change).toBe(15);
  });

  it("caps schema_change at 30", () => {
    const risk: PatchRisk = { pattern: "p", severity: "high", category: "schema_mutation", filePath: "f", lineNumber: 1, lineContext: "" };
    const score = computeRiskScore([makeRecord({ patchRisks: [risk, risk, risk, risk] })]);
    expect(score.breakdown.schema_change).toBe(30);
  });

  it("adds 5 per boundary violation", () => {
    const bv: BoundaryViolation = { violationType: "BLOCKED_FILE_MODIFIED", file: "f", message: "m" };
    const score = computeRiskScore([makeRecord({ boundaryViolations: [bv] })]);
    expect(score.breakdown.boundary_violation).toBe(5);
  });

  it("caps total at 100", () => {
    const secrets: PatchRisk[] = Array(10).fill({ pattern: "p", severity: "critical" as const, category: "secret" as const, filePath: "f", lineNumber: 1, lineContext: "" });
    const schemas: PatchRisk[] = Array(10).fill({ pattern: "p", severity: "high" as const, category: "schema_mutation" as const, filePath: "f", lineNumber: 1, lineContext: "" });
    const score = computeRiskScore([makeRecord({ patchRisks: [...secrets, ...schemas] })]);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it("total is sum of breakdown components", () => {
    const risk: PatchRisk = { pattern: "p", severity: "critical", category: "secret", filePath: "f", lineNumber: 1, lineContext: "" };
    const score = computeRiskScore([makeRecord({ patchRisks: [risk] })]);
    const expected = score.breakdown.secret_exposure + score.breakdown.schema_change + score.breakdown.auth_change + score.breakdown.boundary_violation + score.breakdown.tool_denial;
    expect(score.total).toBe(Math.min(expected, 100));
  });
});
