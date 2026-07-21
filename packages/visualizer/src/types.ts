// ─── Mirrored from @agentledger/core schemas ─────────────────────────────────
// These are local copies so the visualizer has zero dependency on core.

export type RunStatus =
  | "created"
  | "planning"
  | "executing"
  | "verifying"
  | "paused"
  | "completed"
  | "failed";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "awaiting_approval"
  | "awaiting_verification"
  | "completed"
  | "failed";

export interface AgentTask {
  taskId: string;
  runId: string;
  title: string;
  description: string;
  owner: string;
  status: TaskStatus;
  dependencies: string[];
  allowedFiles: string[];
  blockedFiles: string[];
}

export interface RunState {
  runId: string;
  status: RunStatus;
  goal: string;
  operator?: string;
  tasks: AgentTask[];
  filesModified: string[];
  startedAt?: string;
  completedAt?: string;
  /** basename of the repo this run belongs to; server-tagged for filtering */
  project?: string;
}

/** One tracked project, from GET /api/projects — powers the selector + chain badge. */
export interface ProjectSummary {
  name: string;
  path: string;
  eventCount: number;
  sessionCount: number;
  chainValid: boolean;
  chainError?: string;
  lastActivity?: string;
}

export interface LeaderboardEntry {
  runId: string;
  taskId: string;
  title: string;
  riskScore: number;
  denyCount: number;
  requireApprovalCount: number;
  boundaryViolationCount: number;
  toolDenialCount: number;
}

export interface PolicyLeaderboard {
  generatedAt: string;
  entries: LeaderboardEntry[];
}

export interface LedgerEvent {
  event_id: string;
  run_id: string;
  task_id?: string;
  timestamp: string;
  actor: string;
  event_type: string;
  payload: Record<string, unknown>;
  hash: string;
  previous_hash: string;
}

// ─── Handoff Brief ───────────────────────────────────────────────────────────

export type FailureReason =
  | "boundary_violation"
  | "verification_failed"
  | "governance_denied"
  | "human_approval_rejected"
  | "tool_denial"
  | "tool_call_limit_exceeded"
  | "unknown";

export interface FailureContext {
  violatedFile?: string;
  violationType?: string;
  governanceCategory?: string;
  toolName?: string;
  exitCode?: number;
  detail?: string;
}

export interface FailedTaskDetail {
  taskId: string;
  title: string;
  reason: FailureReason;
  context?: FailureContext;
  attemptedFiles: string[];
}

export interface CompletedTaskSummary {
  taskId: string;
  title: string;
  summary: string;
  filesModified: string[];
}

export interface PendingTaskSummary {
  taskId: string;
  title: string;
  description: string;
  owner: string;
  blockedBy: string[];
}

export interface AwaitingApprovalSummary {
  taskId: string;
  title: string;
  requestedAt: string;
}

export interface FileInventory {
  mergedFiles: string[];
  worktreeFiles: string[];
  allFiles: string[];
}

export interface UnresolvedRisk {
  taskId: string;
  category: "secret" | "schema_mutation" | "auth_code" | "dependency_change";
  severity: "critical" | "high" | "medium";
  filePath: string;
  pattern: string;
}

export type ResumptionAction =
  | "approve_pending"
  | "retry_failed_task"
  | "resume_run"
  | "run_completed"
  | "investigate_failure";

export interface ResumptionGuidance {
  action: ResumptionAction;
  targetTaskId?: string;
  command: string;
  detail: string;
}

export interface HandoffBrief {
  generatedAt: string;
  runId: string;
  goal: string;
  operator?: string;
  runStatus: RunStatus;
  completedTasks: CompletedTaskSummary[];
  failedTasks: FailedTaskDetail[];
  inProgressTasks: PendingTaskSummary[];
  pendingTasks: PendingTaskSummary[];
  awaitingApproval: AwaitingApprovalSummary[];
  fileInventory: FileInventory;
  unresolvedRisks: UnresolvedRisk[];
  resumptionGuidance: ResumptionGuidance;
  contextSummary: string;
}

// ─── API response envelopes ───────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}
