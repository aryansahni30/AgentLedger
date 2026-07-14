import { z } from "zod";

export const LedgerEventTypeSchema = z.enum([
  "RUN_CREATED",
  "INTENT_COMPILED",
  "TASK_CREATED",
  "TASK_ASSIGNED",
  "TASK_STARTED",
  "WORKTREE_CREATED",
  "CONTEXT_READ",
  "TOOL_CALLED",
  "TOOL_DENIED",
  "FILE_EDIT_PROPOSED",
  "PATCH_PROPOSED",
  "PATCH_RISK_DETECTED",
  "POLICY_EVALUATED",
  "RISK_THRESHOLD_BREACHED",
  "HUMAN_APPROVAL_REQUESTED",
  "HUMAN_APPROVAL_GRANTED",
  "HUMAN_APPROVAL_REJECTED",
  "VERIFICATION_STARTED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "BOUNDARY_VIOLATION",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "RUN_COMPLETED",
  "RUN_FAILED",
]);

export const LedgerEventSchema = z.object({
  event_id: z.string(),
  run_id: z.string(),
  task_id: z.string().optional(),
  timestamp: z.string().datetime(),
  actor: z.string(),
  event_type: LedgerEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  hash: z.string(),
  previous_hash: z.string(),
});

export const TaskStatusSchema = z.enum([
  "pending",
  "assigned",
  "running",
  "awaiting_approval",
  "awaiting_verification",
  "completed",
  "failed",
]);

export const AgentTaskSchema = z.object({
  taskId: z.string(),
  runId: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  dependencies: z.array(z.string()),
  allowedFiles: z.array(z.string()),
  blockedFiles: z.array(z.string()),
  allowedTools: z.array(z.string()),
  expectedOutputs: z.array(z.string()),
  successCriteria: z.array(z.string()),
  status: TaskStatusSchema,
  /** Optional path to a per-task governance.json, relative to the .agentledger/ directory */
  governancePolicyFile: z.string().optional(),
});

export const TaskGraphSchema = z.object({
  runId: z.string(),
  tasks: z.array(AgentTaskSchema),
});

export const IntentContractSchema = z.object({
  runId: z.string(),
  goal: z.string(),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  budget: z
    .object({
      maxTokens: z.number().optional(),
      maxUsd: z.number().optional(),
      maxToolCalls: z.number().optional(),
    })
    .optional(),
  approvalRequiredFor: z.array(z.string()).optional(),
});

export const WorktreeHandleSchema = z.object({
  taskId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
});

export const WorkerContextSchema = z.object({
  task: AgentTaskSchema,
  relevantContext: z.record(z.string(), z.unknown()),
  worktreePath: z.string(),
  allowedFiles: z.array(z.string()),
  blockedFiles: z.array(z.string()),
  allowedTools: z.array(z.string()),
  outputSchema: z.record(z.string(), z.unknown()),
});

export const ToolDenialSchema = z.object({
  toolName: z.string(),
  path: z.string(),
  reason: z.string(),
  violationType: z.enum(["BLOCKED_FILE", "UNOWNED_FILE"]),
});

export const WorkerResultSchema = z.object({
  taskId: z.string(),
  summary: z.string(),
  filesRead: z.array(z.string()),
  filesModified: z.array(z.string()),
  patchPath: z.string().optional(),
  worktreeBranch: z.string(),
  toolDenials: z.array(ToolDenialSchema).default([]),
  output: z.record(z.string(), z.unknown()),
});

export const VerificationCommandSchema = z.object({
  name: z.string(),
  command: z.string(),
  required: z.boolean().default(true),
});

export const CommandResultSchema = z.object({
  name: z.string(),
  command: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
});

export const BoundaryViolationSchema = z.object({
  violationType: z.enum([
    "BLOCKED_FILE_MODIFIED",
    "UNOWNED_FILE_MODIFIED",
    "UNEXPECTED_FILE",
  ]),
  file: z.string(),
  message: z.string(),
});

export const BoundaryCheckResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(BoundaryViolationSchema),
});

export const VerificationResultSchema = z.object({
  taskId: z.string(),
  passed: z.boolean(),
  boundaryCheck: BoundaryCheckResultSchema,
  commandResults: z.array(CommandResultSchema),
});

export const RunStatusSchema = z.enum([
  "created",
  "planning",
  "executing",
  "verifying",
  "paused",
  "completed",
  "failed",
]);

export const RunStateSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  goal: z.string(),
  operator: z.string().optional(),
  tasks: z.array(AgentTaskSchema),
  filesModified: z.array(z.string()),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

export const ApprovalTriggerSchema = z.enum([
  "all",
  "high_risk_keywords",
  "new_dependencies",
  "blocked_files_nearby",
]);

export const ApprovalPolicySchema = z.object({
  requireApprovalFor: z.array(ApprovalTriggerSchema).default(["high_risk_keywords"]),
  /** "post_patch" = after worker finishes, before verification */
  mode: z.enum(["post_patch"]).default("post_patch"),
  /** Optional timeout in seconds before an unanswered request auto-rejects */
  timeoutSeconds: z.number().int().min(60).optional(),
});

export const PendingApprovalSchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  requestedAt: z.string().datetime(),
  reasons: z.array(z.string()),
  filesModified: z.array(z.string()),
  summary: z.string(),
});

// ─── Phase C: Multi-dev coordination types ────────────────────────────────────

export const PriorTaskContextSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  summary: z.string(),
  filesModified: z.array(z.string()),
});

export const CompletedTaskSummarySchema = z.object({
  taskId: z.string(),
  title: z.string(),
  summary: z.string(),
  filesModified: z.array(z.string()),
});

export const PendingTaskSummarySchema = z.object({
  taskId: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  blockedBy: z.array(z.string()),
});

export const FailedTaskSummarySchema = z.object({
  taskId: z.string(),
  title: z.string(),
  failureReason: z.string(),
});

export const AwaitingApprovalSummarySchema = z.object({
  taskId: z.string(),
  title: z.string(),
  requestedAt: z.string(),
});

export const HandoffDocumentSchema = z.object({
  runId: z.string(),
  goal: z.string(),
  runStatus: RunStatusSchema,
  completedTasks: z.array(CompletedTaskSummarySchema),
  pendingTasks: z.array(PendingTaskSummarySchema),
  failedTasks: z.array(FailedTaskSummarySchema),
  awaitingApproval: z.array(AwaitingApprovalSummarySchema),
  allFilesModified: z.array(z.string()),
  suggestedNextAction: z.string(),
});

// ─── Phase D: Enterprise Governance types ─────────────────────────────────────

export const PatchRiskSeveritySchema = z.enum(["critical", "high", "medium"]);
export const PatchRiskCategorySchema = z.enum([
  "secret",
  "schema_mutation",
  "auth_code",
  "dependency_change",
]);

export const PatchRiskSchema = z.object({
  pattern: z.string(),
  severity: PatchRiskSeveritySchema,
  category: PatchRiskCategorySchema,
  filePath: z.string(),
  lineNumber: z.number().int().min(1),
  lineContext: z.string(),
});

export const GovernancePolicyRuleSchema = z.object({
  type: z.enum(["deny_if", "require_approval_if", "warn_if"]),
  categories: z.array(PatchRiskCategorySchema),
  minSeverity: PatchRiskSeveritySchema.optional(),
});

export const RiskThresholdActionSchema = z.enum(["warn", "pause", "abort"]);

export const GovernancePolicySchema = z.object({
  rules: z.array(GovernancePolicyRuleSchema),
  /** Cumulative run risk score (0-100) that triggers thresholdAction */
  riskThreshold: z.number().int().min(0).max(100).optional(),
  /** What to do when riskThreshold is breached. Default "warn". */
  thresholdAction: RiskThresholdActionSchema.optional(),
});

export const PolicyDecisionSchema = z.object({
  action: z.enum(["allow", "warn", "deny", "require_approval"]),
  reasons: z.array(z.string()),
  risks: z.array(PatchRiskSchema),
});

export const ApprovalRecordSchema = z.object({
  taskId: z.string(),
  requestedAt: z.string(),
  grantedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  reasons: z.array(z.string()),
});

export const AuditTaskRecordSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  filesModified: z.array(z.string()),
  patchRisks: z.array(PatchRiskSchema),
  toolDenials: z.array(ToolDenialSchema),
  boundaryViolations: z.array(BoundaryViolationSchema),
  policyDecision: PolicyDecisionSchema.optional(),
  approvalRecord: ApprovalRecordSchema.optional(),
});

export const RiskScoreBreakdownSchema = z.object({
  secret_exposure: z.number().min(0).max(40),
  schema_change: z.number().min(0).max(30),
  auth_change: z.number().min(0).max(20),
  boundary_violation: z.number().min(0).max(10),
  tool_denial: z.number().min(0).max(10),
});

export const RiskScoreSchema = z.object({
  total: z.number().int().min(0).max(100),
  breakdown: RiskScoreBreakdownSchema,
});

export const LeaderboardEntrySchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  title: z.string(),
  riskScore: z.number().int().min(0).max(100),
  denyCount: z.number().int().min(0),
  requireApprovalCount: z.number().int().min(0),
  boundaryViolationCount: z.number().int().min(0),
  toolDenialCount: z.number().int().min(0),
});

export const PolicyLeaderboardSchema = z.object({
  generatedAt: z.string().datetime(),
  entries: z.array(LeaderboardEntrySchema),
});

export const GovernanceSummarySchema = z.object({
  policyDecisionCounts: z.object({
    allow: z.number().int().min(0),
    warn: z.number().int().min(0),
    require_approval: z.number().int().min(0),
    deny: z.number().int().min(0),
  }),
  thresholdBreached: z.boolean(),
  thresholdBreachAction: RiskThresholdActionSchema.optional(),
});

export const AuditReportSchema = z.object({
  runId: z.string(),
  goal: z.string(),
  runStatus: RunStatusSchema,
  generatedAt: z.string().datetime(),
  tasks: z.array(AuditTaskRecordSchema),
  allFilesModified: z.array(z.string()),
  riskScore: RiskScoreSchema,
  approvalsSummary: z.object({
    total: z.number().int().min(0),
    granted: z.number().int().min(0),
    rejected: z.number().int().min(0),
    pending: z.number().int().min(0),
  }),
  governanceSummary: GovernanceSummarySchema,
});

// ─── Phase A: Handoff Brief types ─────────────────────────────────────────────

export const FailureReasonSchema = z.enum([
  "boundary_violation",
  "verification_failed",
  "governance_denied",
  "human_approval_rejected",
  "tool_denial",
  "tool_call_limit_exceeded",
  "unknown",
]);

export const FailureContextSchema = z.object({
  violatedFile: z.string().optional(),
  violationType: z.string().optional(),
  governanceCategory: z.string().optional(),
  toolName: z.string().optional(),
  exitCode: z.number().optional(),
  detail: z.string().optional(),
});

export const FailedTaskDetailSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  reason: FailureReasonSchema,
  context: FailureContextSchema.optional(),
  attemptedFiles: z.array(z.string()),
});

export const FileInventorySchema = z.object({
  mergedFiles: z.array(z.string()),
  worktreeFiles: z.array(z.string()),
  allFiles: z.array(z.string()),
});

export const UnresolvedRiskSchema = z.object({
  taskId: z.string(),
  category: PatchRiskCategorySchema,
  severity: PatchRiskSeveritySchema,
  filePath: z.string(),
  pattern: z.string(),
});

export const ResumptionActionSchema = z.enum([
  "approve_pending",
  "retry_failed_task",
  "resume_run",
  "run_completed",
  "investigate_failure",
]);

export const ResumptionGuidanceSchema = z.object({
  action: ResumptionActionSchema,
  targetTaskId: z.string().optional(),
  command: z.string(),
  detail: z.string(),
});

export const HandoffBriefSchema = z.object({
  generatedAt: z.string().datetime(),
  runId: z.string(),
  goal: z.string(),
  operator: z.string().optional(),
  runStatus: RunStatusSchema,
  completedTasks: z.array(CompletedTaskSummarySchema),
  failedTasks: z.array(FailedTaskDetailSchema),
  inProgressTasks: z.array(PendingTaskSummarySchema),
  pendingTasks: z.array(PendingTaskSummarySchema),
  awaitingApproval: z.array(AwaitingApprovalSummarySchema),
  fileInventory: FileInventorySchema,
  unresolvedRisks: z.array(UnresolvedRiskSchema),
  resumptionGuidance: ResumptionGuidanceSchema,
  contextSummary: z.string(),
});

// ─── Plugin / Observer mode types ─────────────────────────────────────────────

export const RunModeSchema = z.enum(["orchestrated", "observed"]);

/** Typed payload for the RUN_CREATED ledger event */
export const RunCreatedPayloadSchema = z.object({
  goal: z.string(),
  riskLevel: z.string().optional(),
  operator: z.string().optional(),
  run_mode: RunModeSchema.default("orchestrated"),
});

export const AgentLedgerConfigSchema = z.object({
  version: z.string(),
  verification: z.object({
    commands: z.record(z.string(), z.string()),
    required: z.array(z.string()),
  }),
  budget: z
    .object({
      maxTokens: z.number().optional(),
      maxUsd: z.number().optional(),
      maxToolCalls: z.number().optional(),
    })
    .optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
});

export type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type TaskGraph = z.infer<typeof TaskGraphSchema>;
export type IntentContract = z.infer<typeof IntentContractSchema>;
export type WorktreeHandle = z.infer<typeof WorktreeHandleSchema>;
export type WorkerContext = z.infer<typeof WorkerContextSchema>;
export type ToolDenial = z.infer<typeof ToolDenialSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type VerificationCommand = z.infer<typeof VerificationCommandSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type BoundaryViolation = z.infer<typeof BoundaryViolationSchema>;
export type BoundaryCheckResult = z.infer<typeof BoundaryCheckResultSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type AgentLedgerConfig = z.infer<typeof AgentLedgerConfigSchema>;
export type ApprovalTrigger = z.infer<typeof ApprovalTriggerSchema>;
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;
export type PriorTaskContext = z.infer<typeof PriorTaskContextSchema>;
export type CompletedTaskSummary = z.infer<typeof CompletedTaskSummarySchema>;
export type PendingTaskSummary = z.infer<typeof PendingTaskSummarySchema>;
export type FailedTaskSummary = z.infer<typeof FailedTaskSummarySchema>;
export type AwaitingApprovalSummary = z.infer<typeof AwaitingApprovalSummarySchema>;
export type HandoffDocument = z.infer<typeof HandoffDocumentSchema>;

export type PatchRiskSeverity = z.infer<typeof PatchRiskSeveritySchema>;
export type PatchRiskCategory = z.infer<typeof PatchRiskCategorySchema>;
export type PatchRisk = z.infer<typeof PatchRiskSchema>;
export type GovernancePolicyRule = z.infer<typeof GovernancePolicyRuleSchema>;
export type RiskThresholdAction = z.infer<typeof RiskThresholdActionSchema>;
export type GovernancePolicy = z.infer<typeof GovernancePolicySchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export type AuditTaskRecord = z.infer<typeof AuditTaskRecordSchema>;
export type RiskScoreBreakdown = z.infer<typeof RiskScoreBreakdownSchema>;
export type RiskScore = z.infer<typeof RiskScoreSchema>;
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export type PolicyLeaderboard = z.infer<typeof PolicyLeaderboardSchema>;
export type GovernanceSummary = z.infer<typeof GovernanceSummarySchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type FailureReason = z.infer<typeof FailureReasonSchema>;
export type FailureContext = z.infer<typeof FailureContextSchema>;
export type FailedTaskDetail = z.infer<typeof FailedTaskDetailSchema>;
export type FileInventory = z.infer<typeof FileInventorySchema>;
export type UnresolvedRisk = z.infer<typeof UnresolvedRiskSchema>;
export type ResumptionAction = z.infer<typeof ResumptionActionSchema>;
export type ResumptionGuidance = z.infer<typeof ResumptionGuidanceSchema>;
export type HandoffBrief = z.infer<typeof HandoffBriefSchema>;
export type RunMode = z.infer<typeof RunModeSchema>;
export type RunCreatedPayload = z.infer<typeof RunCreatedPayloadSchema>;
