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
  "FILE_EDIT_PROPOSED",
  "PATCH_PROPOSED",
  "VERIFICATION_STARTED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "BOUNDARY_VIOLATION",
  "HUMAN_APPROVAL_REQUESTED",
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

export const WorkerResultSchema = z.object({
  taskId: z.string(),
  summary: z.string(),
  filesRead: z.array(z.string()),
  filesModified: z.array(z.string()),
  patchPath: z.string().optional(),
  worktreeBranch: z.string(),
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
  "completed",
  "failed",
]);

export const RunStateSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  goal: z.string(),
  tasks: z.array(AgentTaskSchema),
  filesModified: z.array(z.string()),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
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
});

export type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type TaskGraph = z.infer<typeof TaskGraphSchema>;
export type IntentContract = z.infer<typeof IntentContractSchema>;
export type WorktreeHandle = z.infer<typeof WorktreeHandleSchema>;
export type WorkerContext = z.infer<typeof WorkerContextSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type VerificationCommand = z.infer<typeof VerificationCommandSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type BoundaryViolation = z.infer<typeof BoundaryViolationSchema>;
export type BoundaryCheckResult = z.infer<typeof BoundaryCheckResultSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type AgentLedgerConfig = z.infer<typeof AgentLedgerConfigSchema>;
