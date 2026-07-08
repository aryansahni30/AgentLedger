# architecture.md

## Module Map

```
packages/
  core/src/
    ledger/      # single writer, hash-chain, append, read, query, replay
    planner/     # intent → validated task graph
    worker/      # executes one task inside an assigned git worktree
    verifier/    # boundary diff + command runner + accept/reject
    replay/      # reconstruct RunState from LedgerEvent[]
    schemas/     # all Zod schemas (source of truth for types)
    git/         # worktree create, sparse-checkout, diff, merge, cleanup
  cli/src/
    commands/    # one file per CLI command
    index.ts     # Commander/oclif entry
  examples/
    todo-app/
    github-issue-runner/
  visualizer/    # post-MVP only
```

Target repo run state lives in `.agentledger/` (created by `agentledger init`):
```
.agentledger/
  config.json
  ledger.jsonl       # the ledger — single writer, append-only
  tasks.json         # current task graph snapshot
  artifacts/         # structured worker outputs
  patches/           # per-task git patches
  worktrees/         # git worktree checkouts (active during a run)
  runs/              # per-run metadata
```

---

## Data Flow

```
User: agentledger run "Add email validation..."
         │
         ▼
    Intent Contract
    (goal, constraints, successCriteria, riskLevel)
         │
         ▼
    Planner
    (intent → TaskGraph, validates no overlapping ownership)
         │
         ▼
    Orchestrator loop (sequential in MVP):
      for each task (in dependency order):
        │
        ├─ git/: createTaskWorktree(task)
        │         → branch: agentledger/{task_id}
        │         → sparse-checkout: task.allowedFiles
        │
        ├─ worker/: runWorker(task, context, worktree)
        │         → executes inside worktree
        │         → returns WorkerResult (structured, not self-reported success)
        │
        ├─ ledger/: orchestrator appends events on worker's behalf
        │         → WORKTREE_CREATED, TASK_STARTED, TOOL_CALLED,
        │           PATCH_PROPOSED, etc.
        │
        ├─ verifier/: verifyTask(task, result, worktree)
        │         → git diff branch vs allowedFiles/blockedFiles
        │         → run configured commands (npm test, typecheck, lint)
        │         → real exit codes — worker self-report ignored
        │
        ├─ if PASS: mergeTaskBranch → output branch; emit TASK_COMPLETED
        └─ if FAIL: emit BOUNDARY_VIOLATION or VERIFICATION_FAILED; task → failed

         ▼
    agentledger replay  →  reconstruct RunState from ledger.jsonl
```

---

## Module Responsibilities

### `core/ledger`
- Append events (orchestrator only — workers never write directly)
- Compute `hash = SHA-256(previous_hash + JSON.stringify(event_payload))`
- Verify chain integrity
- Query by run_id / task_id / event_type
- Replay: reduce event log → RunState

Key functions:
```typescript
appendEvent(event: Omit<LedgerEvent, 'hash'>): Promise<void>
readEvents(runId?: string): Promise<LedgerEvent[]>
replayRun(runId: string): Promise<RunState>
verifyChain(runId: string): Promise<boolean>
```

### `core/git`
- Create per-task worktree + branch (`agentledger/{task_id}`)
- Apply sparse-checkout to `allowedFiles` (best-effort prevention layer)
- Diff worktree branch against declared boundaries (authoritative detection layer)
- Merge accepted branch into run's output branch
- Clean up worktrees on completion or failure

Key functions:
```typescript
createTaskWorktree(task: AgentTask): Promise<WorktreeHandle>
diffWorktree(handle: WorktreeHandle): Promise<string[]>   // returns modified file paths
mergeTaskBranch(handle: WorktreeHandle, targetBranch: string): Promise<void>
cleanupWorktree(handle: WorktreeHandle): Promise<void>
```

### `core/planner`
- Parse intent into structured TaskGraph
- Validate: no dependency cycles, no overlapping `allowedFiles` between parallel tasks
- Write `TASK_CREATED` events per task
- MVP: rule-based or LLM-assisted; mocked is acceptable

Key functions:
```typescript
createPlan(intent: IntentContract): Promise<TaskGraph>
validateTaskGraph(graph: TaskGraph): ValidationResult
```

### `core/worker`
- Receives: task + context + worktree handle + allowed tools list
- Executes inside worktree (reads/edits only files in the worktree checkout)
- Returns structured `WorkerResult` — no side-channel success claims
- Does NOT write to the ledger — returns result to orchestrator

Key functions:
```typescript
runWorker(task: AgentTask, context: WorkerContext, worktree: WorktreeHandle): Promise<WorkerResult>
```

### `core/verifier`
- Layer 1: diff `worktree.branch` vs `task.allowedFiles` + `task.blockedFiles`
- Layer 2: run `config.verification.commands` — capture stdout/stderr/exitCode
- Emit `BOUNDARY_VIOLATION` or `VERIFICATION_FAILED` on failure
- Never use worker's self-reported status as input

Key functions:
```typescript
verifyTask(task: AgentTask, result: WorkerResult, worktree: WorktreeHandle): Promise<VerificationResult>
checkFileBoundaries(task: AgentTask, modifiedFiles: string[]): BoundaryCheckResult
runVerificationCommands(commands: VerificationCommand[]): Promise<CommandResult[]>
```

### `core/replay`
- Reduce `LedgerEvent[]` → `RunState` (task statuses, run status, file modifications)
- Detect invalid state transitions (e.g., `completed` → `running`)
- Used by `agentledger replay` CLI command

---

## Key Design Decisions + Why

### Single-writer ledger
Workers return results to the orchestrator. The orchestrator appends all events. This sidesteps file-locking and concurrent-write problems for sequential MVP. When parallel execution ships, this changes to an append queue — but not in v1.

### Hash chaining is mandatory in MVP
`hash = SHA-256(previous_hash + serialized_payload)`. Without this, the ledger is a structured log, not an immutable audit log. The project's credibility claim ("immutable") is only defensible if the chain is there. Not optional.

### Two isolation layers
Sparse-checkout gives physical prevention (imperfect — a worker with shell access can escape). Verifier diff gives independent detection. Both are required; neither alone is sufficient. This is analogous to defense-in-depth in security.

### Sequential execution for MVP
Parallel workers require: concurrent-safe ledger writes, confirming worktree isolation holds under concurrent git object store access, merge conflict resolution between task branches. None of this is necessary to prove the thesis. Ship sequential, design the interfaces so parallel can be layered in.

### allowedTools is audit-only
An LLM worker with shell access cannot be technically prevented from calling tools outside `allowedTools`. Sparse-checkout handles files; nothing handles tool calls at the process level. The verifier audits ledger events post-hoc. The README must say this explicitly — "detection, not prevention" — or it's a dishonest claim.

### Planner is intentionally thin
The harness is the engineering story. A mediocre planner + strong harness = reliable results. A brilliant planner + no harness = unreliable results. Do not let planner complexity dominate Phase 1-6 build time.
