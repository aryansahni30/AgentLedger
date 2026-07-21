# schemas.md

Canonical Zod schema definitions. This file is the source of truth.  
When schemas change, update here first, then propagate to `packages/core/src/schemas/`.

---

## LedgerEventType

```typescript
const LedgerEventTypeSchema = z.enum([
  "RUN_CREATED",
  "INTENT_COMPILED",
  "TASK_CREATED",
  "TASK_ASSIGNED",
  "TASK_STARTED",
  "WORKTREE_CREATED",        // logs which branch/worktree backs each task
  "CONTEXT_READ",
  "TOOL_CALLED",
  "FILE_EDIT_PROPOSED",
  "PATCH_PROPOSED",
  "VERIFICATION_STARTED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "BOUNDARY_VIOLATION",
  // Lie Detector (plugin Stop hook). CLAIM_DETECTED records what was claimed;
  // the following event records what checking it found.
  "CLAIM_DETECTED",
  "CLAIM_VERIFIED",
  "CLAIM_FALSIFIED",
  "CLAIM_UNVERIFIABLE",
  "HUMAN_APPROVAL_REQUESTED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "RUN_COMPLETED",
  "RUN_FAILED",
]);

type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;
```

---

## LedgerEvent

```typescript
const LedgerEventSchema = z.object({
  event_id: z.string(),
  run_id: z.string(),
  task_id: z.string().optional(),
  timestamp: z.string().datetime(),
  actor: z.string(),
  event_type: LedgerEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  hash: z.string(),           // SHA-256 of (previous_hash + JSON.stringify(payload)) — REQUIRED
  previous_hash: z.string(),  // "genesis" for first event — REQUIRED
});

type LedgerEvent = z.infer<typeof LedgerEventSchema>;
```

Hash chain: `hash = SHA-256(previous_hash + JSON.stringify(event.payload))`  
First event: `previous_hash = "genesis"`

---

## IntentContract

```typescript
const IntentContractSchema = z.object({
  runId: z.string(),
  goal: z.string(),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  budget: z.object({
    maxTokens: z.number().optional(),
    maxUsd: z.number().optional(),
    maxToolCalls: z.number().optional(),
  }).optional(),
  approvalRequiredFor: z.array(z.string()).optional(),
});

type IntentContract = z.infer<typeof IntentContractSchema>;
```

---

## AgentTask

```typescript
const TaskStatusSchema = z.enum([
  "pending",
  "assigned",
  "running",
  "awaiting_verification",
  "completed",
  "failed",
]);

const AgentTaskSchema = z.object({
  taskId: z.string(),
  runId: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  dependencies: z.array(z.string()),    // taskIds this task depends on
  allowedFiles: z.array(z.string()),    // glob patterns — enforced via sparse-checkout + verifier diff
  blockedFiles: z.array(z.string()),    // glob patterns — enforced via verifier diff
  allowedTools: z.array(z.string()),    // AUDIT ONLY — not technically enforced for LLM workers
  expectedOutputs: z.array(z.string()),
  successCriteria: z.array(z.string()),
  status: TaskStatusSchema,
});

type AgentTask = z.infer<typeof AgentTaskSchema>;
```

---

## TaskGraph

```typescript
const TaskGraphSchema = z.object({
  runId: z.string(),
  tasks: z.array(AgentTaskSchema),
});

type TaskGraph = z.infer<typeof TaskGraphSchema>;
```

---

## WorktreeHandle

```typescript
const WorktreeHandleSchema = z.object({
  taskId: z.string(),
  branch: z.string(),        // "agentledger/{taskId}"
  worktreePath: z.string(),  // absolute path to the worktree checkout
});

type WorktreeHandle = z.infer<typeof WorktreeHandleSchema>;
```

---

## WorkerContext

```typescript
const WorkerContextSchema = z.object({
  task: AgentTaskSchema,
  relevantContext: z.record(z.string(), z.unknown()),
  worktreePath: z.string(),
  allowedFiles: z.array(z.string()),
  blockedFiles: z.array(z.string()),
  allowedTools: z.array(z.string()),
  outputSchema: z.record(z.string(), z.unknown()),
});

type WorkerContext = z.infer<typeof WorkerContextSchema>;
```

---

## WorkerResult

```typescript
const WorkerResultSchema = z.object({
  taskId: z.string(),
  summary: z.string(),
  filesRead: z.array(z.string()),
  filesModified: z.array(z.string()),
  patchPath: z.string().optional(),
  worktreeBranch: z.string(),
  output: z.record(z.string(), z.unknown()),
});

type WorkerResult = z.infer<typeof WorkerResultSchema>;
```

---

## VerificationCommand

```typescript
const VerificationCommandSchema = z.object({
  name: z.string(),
  command: z.string(),
  required: z.boolean().default(true),
});

type VerificationCommand = z.infer<typeof VerificationCommandSchema>;
```

---

## CommandResult

```typescript
const CommandResultSchema = z.object({
  name: z.string(),
  command: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
});

type CommandResult = z.infer<typeof CommandResultSchema>;
```

---

## BoundaryCheckResult

```typescript
const BoundaryViolationSchema = z.object({
  violationType: z.enum(["BLOCKED_FILE_MODIFIED", "UNOWNED_FILE_MODIFIED", "UNEXPECTED_FILE"]),
  file: z.string(),
  message: z.string(),
});

const BoundaryCheckResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(BoundaryViolationSchema),
});

type BoundaryCheckResult = z.infer<typeof BoundaryCheckResultSchema>;
```

---

## VerificationResult

```typescript
const VerificationResultSchema = z.object({
  taskId: z.string(),
  passed: z.boolean(),
  boundaryCheck: BoundaryCheckResultSchema,
  commandResults: z.array(CommandResultSchema),
});

type VerificationResult = z.infer<typeof VerificationResultSchema>;
```

---

## RunState (replay output)

```typescript
const RunStatusSchema = z.enum([
  "created",
  "planning",
  "executing",
  "verifying",
  "completed",
  "failed",
]);

const RunStateSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  goal: z.string(),
  tasks: z.array(AgentTaskSchema),
  filesModified: z.array(z.string()),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

type RunState = z.infer<typeof RunStateSchema>;
```

---

## Config (agentledger.config.json)

```typescript
const AgentLedgerConfigSchema = z.object({
  version: z.string(),
  verification: z.object({
    commands: z.record(z.string(), z.string()),  // name → shell command
    required: z.array(z.string()),               // which names must pass
  }),
  budget: z.object({
    maxTokens: z.number().optional(),
    maxUsd: z.number().optional(),
    maxToolCalls: z.number().optional(),
  }).optional(),
});

type AgentLedgerConfig = z.infer<typeof AgentLedgerConfigSchema>;
```

---

## ProjectEntry / ProjectRegistry (~/.agentledger/projects.json)

Cross-project registry. SessionStart appends the current repo; the server reads
the file to discover which ledgers to watch. `path` is the canonical realpath and
is unique per entry (how the server locates the ledger). `name` is the basename
and is the project *identifier* used by the API and UI, matching claude-mem — two
repos with the same basename share an identifier and their sessions interleave,
but both paths are kept so neither ledger is lost.

```typescript
const ProjectEntrySchema = z.object({
  path: z.string().min(1),     // canonical realpath — unique, locates the ledger
  name: z.string().min(1),     // basename — the API/UI project identifier
  firstSeen: z.string(),       // ISO timestamp
  lastSeen: z.string(),        // ISO timestamp, advanced on every SessionStart
});

const ProjectRegistrySchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectEntrySchema),
});

type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;
```

Writes are serialized with `proper-lockfile` (concurrent SessionStarts race).
Reads never throw: a corrupt or partially-written file yields `[]` or the salvageable rows.

