import type {
  LedgerEvent,
  AuditReport,
  AuditTaskRecord,
  GovernanceSummary,
  RiskScore,
  RiskScoreBreakdown,
  PatchRisk,
  ToolDenial,
  BoundaryViolation,
  PolicyDecision,
  ApprovalRecord,
} from "../schemas/index.js";
import { replayLedger } from "../replay/replayLedger.js";

// ─── Risk scoring weights ─────────────────────────────────────────────────────

const WEIGHTS = {
  secret_per_finding: 20,   // capped at 40
  schema_per_finding: 15,   // capped at 30
  auth_per_finding: 10,     // capped at 20
  boundary_per_violation: 5, // capped at 10
  tool_denial_per: 2,        // capped at 10
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, max: number): number {
  return Math.min(value, max);
}

export function computeRiskScore(tasks: AuditTaskRecord[]): RiskScore {
  let secretExposure = 0;
  let schemaChange = 0;
  let authChange = 0;
  let boundaryViolation = 0;
  let toolDenial = 0;

  for (const task of tasks) {
    for (const risk of task.patchRisks) {
      if (risk.category === "secret") secretExposure += WEIGHTS.secret_per_finding;
      else if (risk.category === "schema_mutation") schemaChange += WEIGHTS.schema_per_finding;
      else if (risk.category === "auth_code") authChange += WEIGHTS.auth_per_finding;
    }
    boundaryViolation += task.boundaryViolations.length * WEIGHTS.boundary_per_violation;
    toolDenial += task.toolDenials.length * WEIGHTS.tool_denial_per;
  }

  const breakdown: RiskScoreBreakdown = {
    secret_exposure: clamp(secretExposure, 40),
    schema_change: clamp(schemaChange, 30),
    auth_change: clamp(authChange, 20),
    boundary_violation: clamp(boundaryViolation, 10),
    tool_denial: clamp(toolDenial, 10),
  };

  const total = Math.min(
    breakdown.secret_exposure +
    breakdown.schema_change +
    breakdown.auth_change +
    breakdown.boundary_violation +
    breakdown.tool_denial,
    100,
  );

  return { total, breakdown };
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Pure function — reconstructs a full audit report for `runId` from events.
 * All data sourced from the ledger; no I/O.
 */
export function generateAuditReport(events: LedgerEvent[], runId: string): AuditReport {
  const runEvents = events.filter((e) => e.run_id === runId);
  const runState = replayLedger(runEvents, runId);

  // ── Build per-task records ─────────────────────────────────────────────────
  const taskRecords: AuditTaskRecord[] = runState.tasks.map((task) => {
    const taskEvents = runEvents.filter((e) => e.task_id === task.taskId);

    // patch risks from PATCH_RISK_DETECTED
    const patchRisks: PatchRisk[] = [];
    for (const ev of taskEvents) {
      if (ev.event_type === "PATCH_RISK_DETECTED") {
        const raw = ev.payload["risks"];
        if (Array.isArray(raw)) patchRisks.push(...(raw as PatchRisk[]));
      }
    }

    // tool denials from TOOL_DENIED
    const toolDenials: ToolDenial[] = [];
    for (const ev of taskEvents) {
      if (ev.event_type === "TOOL_DENIED") {
        const d = ev.payload as Partial<ToolDenial>;
        if (d.toolName && d.path && d.reason && d.violationType) {
          toolDenials.push(d as ToolDenial);
        }
      }
    }

    // boundary violations from BOUNDARY_VIOLATION events
    const boundaryViolations: BoundaryViolation[] = [];
    for (const ev of taskEvents) {
      if (ev.event_type === "BOUNDARY_VIOLATION") {
        const bv = ev.payload as Partial<BoundaryViolation>;
        if (bv.violationType && bv.file && bv.message) {
          boundaryViolations.push(bv as BoundaryViolation);
        }
      }
    }

    // policy decision from POLICY_EVALUATED
    let policyDecision: PolicyDecision | undefined;
    for (const ev of taskEvents) {
      if (ev.event_type === "POLICY_EVALUATED") {
        policyDecision = ev.payload["decision"] as PolicyDecision | undefined;
      }
    }

    // approval record
    let approvalRecord: ApprovalRecord | undefined;
    const approvalReq = taskEvents.find((e) => e.event_type === "HUMAN_APPROVAL_REQUESTED");
    const approvalGrant = taskEvents.find((e) => e.event_type === "HUMAN_APPROVAL_GRANTED");
    const approvalReject = taskEvents.find((e) => e.event_type === "HUMAN_APPROVAL_REJECTED");
    if (approvalReq) {
      const reasons = Array.isArray(approvalReq.payload["reasons"])
        ? (approvalReq.payload["reasons"] as string[])
        : [];
      approvalRecord = {
        taskId: task.taskId,
        requestedAt: approvalReq.timestamp,
        grantedAt: approvalGrant?.timestamp,
        rejectedAt: approvalReject?.timestamp,
        reasons,
      };
    }

    // files modified from PATCH_PROPOSED
    const filesModified: string[] = [];
    for (const ev of taskEvents) {
      if (ev.event_type === "PATCH_PROPOSED") {
        const raw = ev.payload["filesModified"];
        if (Array.isArray(raw)) filesModified.push(...(raw as string[]));
      }
    }

    return {
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      filesModified,
      patchRisks,
      toolDenials,
      boundaryViolations,
      policyDecision,
      approvalRecord,
    };
  });

  // ── Approvals summary ──────────────────────────────────────────────────────
  const totalApprovals = taskRecords.filter((t) => t.approvalRecord !== undefined).length;
  const granted = taskRecords.filter((t) => t.approvalRecord?.grantedAt !== undefined).length;
  const rejected = taskRecords.filter((t) => t.approvalRecord?.rejectedAt !== undefined).length;
  const pending = totalApprovals - granted - rejected;

  // ── All files modified (dedup) ─────────────────────────────────────────────
  const allFilesSet = new Set<string>();
  for (const t of taskRecords) t.filesModified.forEach((f) => allFilesSet.add(f));

  // ── Governance summary ────────────────────────────────────────────────────
  const policyDecisionCounts = { allow: 0, warn: 0, require_approval: 0, deny: 0 };
  for (const task of taskRecords) {
    if (task.policyDecision) {
      policyDecisionCounts[task.policyDecision.action]++;
    }
  }

  const thresholdBreachEvent = runEvents.find((e) => e.event_type === "RISK_THRESHOLD_BREACHED");
  const thresholdBreached = thresholdBreachEvent !== undefined;
  const thresholdBreachAction = thresholdBreachEvent?.payload["action"] as GovernanceSummary["thresholdBreachAction"];

  const governanceSummary: GovernanceSummary = {
    policyDecisionCounts,
    thresholdBreached,
    thresholdBreachAction,
  };

  const riskScore = computeRiskScore(taskRecords);

  return {
    runId,
    goal: runState.goal,
    runStatus: runState.status,
    generatedAt: new Date().toISOString(),
    tasks: taskRecords,
    allFilesModified: [...allFilesSet],
    riskScore,
    approvalsSummary: { total: totalApprovals, granted, rejected, pending },
    governanceSummary,
  };
}
