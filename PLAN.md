# AgentLedger — Implementation Plan

**Status:** Phase 1 in progress  
**Stack:** TypeScript · pnpm workspaces · Zod · Vitest · Commander.js · simple-git

---

## Phase 1: Monorepo Skeleton + Schemas + Ledger Core
**Goal:** Working hash-chained ledger with all Zod schemas. Foundation everything else builds on.

### Deliverables
- [ ] pnpm workspace root (`package.json`, `pnpm-workspace.yaml`)
- [ ] TypeScript strict mode + path aliases (`tsconfig.json` root + per-package)
- [ ] `packages/core` — schema barrel + ledger writer/reader
  - [ ] `src/schemas/index.ts` — all Zod schemas matching `.brain/schemas.md`
  - [ ] `src/ledger/hashChain.ts` — `computeHash(previousHash, payload)`, `isValidHash()`
  - [ ] `src/ledger/LedgerWriter.ts` — `appendEvent()`, `getLastEventHash()`
  - [ ] `src/ledger/LedgerReader.ts` — `readAll()`, `readByRunId()`, `readByTaskId()`, `verifyChain()`
  - [ ] `src/ledger/index.ts` — barrel
- [ ] `packages/cli` — Commander.js skeleton
  - [ ] `agentledger --help` works
  - [ ] `agentledger init` stub (creates `.agentledger/` dir + `config.json`)
- [ ] `vitest.config.ts` + integration test: append 3 events, verify chain, read back
- [ ] All builds pass: `pnpm build`, `pnpm test`, `pnpm typecheck`

### Key invariants
- Hash chain: `hash = SHA-256(previous_hash + JSON.stringify(event.payload))`
- First event: `previous_hash = "genesis"`
- Single writer: `LedgerWriter` is the only thing that calls `appendEvent`
- JSONL format: one JSON object per line, newline-terminated

---

## Phase 2: Task Graph + Planner
**Goal:** IntentContract → validated TaskGraph. `TASK_CREATED` events written to ledger.

### Deliverables
- [ ] `src/planner/createPlan.ts` — mock planner (IntentContract → TaskGraph)
- [ ] `src/planner/validateTaskGraph.ts` — cycle detection + overlapping ownership check
- [ ] `TASK_CREATED` events written via orchestrator after planning
- [ ] `agentledger tasks view` CLI command (reads `tasks.json`, pretty-prints)
- [ ] Planner unit tests: valid graph, cycle rejection, overlap rejection

---

## Phase 3: Git Worktree + Config Init
**Goal:** `agentledger init` fully implemented. Per-task worktrees created and torn down.

### Deliverables
- [ ] `src/git/createTaskWorktree.ts` — git worktree add + branch `agentledger/{taskId}`
- [ ] `src/git/applySparseCheckout.ts` — sparse-checkout to `allowedFiles`
- [ ] `src/git/cleanupWorktree.ts` — remove worktree + delete branch
- [ ] `agentledger init` fully implemented: creates `.agentledger/` layout, writes `config.json`
- [ ] `WorktreeHandle` returned, `WORKTREE_CREATED` event written by orchestrator
- [ ] Git module unit tests (requires a real git repo fixture)

---

## Phase 4: Worker Execution
**Goal:** Mock worker runs inside worktree, returns structured `WorkerResult` to orchestrator.

### Deliverables
- [ ] `src/worker/runWorker.ts` — mock implementation (reads + modifies files in worktree)
- [ ] `WorkerResult` schema validated at return boundary (Zod parse)
- [ ] Patch artifact generated: `.agentledger/patches/{task_id}.patch` (via `git diff`)
- [ ] Orchestrator appends `TASK_STARTED`, `TOOL_CALLED`, `FILE_EDIT_PROPOSED`, `PATCH_PROPOSED` events
- [ ] Worker unit tests with temp repo fixture

---

## Phase 5: Verifier
**Goal:** Real boundary checking and command execution before accepting any worker output.

### Deliverables
- [ ] `src/verifier/diffWorktree.ts` — list files modified in task branch vs base
- [ ] `src/verifier/checkFileBoundaries.ts` — diff vs `allowedFiles`/`blockedFiles`, emit violations
- [ ] `src/verifier/runVerificationCommands.ts` — real exit codes, stdout/stderr captured
- [ ] `BOUNDARY_VIOLATION`, `VERIFICATION_FAILED`, `VERIFICATION_PASSED` events
- [ ] `agentledger verify` CLI command
- [ ] Run summary output: tasks, files modified, verification results, final status
- [ ] Verifier unit tests: passing case, boundary violation case, failed command case

---

## Phase 6: Orchestrator Loop + Replay
**Goal:** Full end-to-end with mock worker. `agentledger run` works. `agentledger replay` works.

### Deliverables
- [ ] `src/orchestrator/runOrchestrator.ts` — sequential task loop (dependency order)
- [ ] Merge accepted task branch into run output branch
- [ ] `src/replay/replayLedger.ts` — `LedgerEvent[]` → `RunState`
- [ ] `src/replay/verifyChain.ts` — hash chain integrity
- [ ] Invalid state transition detection (e.g. `completed` → `running`)
- [ ] `agentledger replay` CLI command
- [ ] `agentledger run "<intent>"` — end-to-end with mock worker
- [ ] Integration test: full run, verify ledger, replay, confirm states match

---

## Phase 7: Unhappy-Path Test Fixtures (internal only)
**Goal:** Prove the harness catches real failure modes. Not the public demo — internal Vitest coverage.

### Deliverables
- [ ] Scripted mock worker that writes to a blocked file → `BOUNDARY_VIOLATION` caught
- [ ] Scripted mock worker that returns `success: true` but `npm test` exits non-zero → `VERIFICATION_FAILED` caught
- [ ] Both scenarios in Vitest integration tests
- [ ] CLI output for both failure cases reviewed and confirmed correct
- [ ] **Do not record public demo here** — fixtures are artificial

---

## Phase 8: Real LLM Integration + Public Demo
**Goal:** Real model, real failure, real catch. This is the artifact for the portfolio.

### Deliverables
- [ ] `src/adapters/anthropic.ts` — Claude API worker adapter
- [ ] Planner prompt: intent → structured TaskGraph (Zod-validated, retry on schema failure)
- [ ] Worker prompt: task + context → structured `WorkerResult` (Zod-validated, retry)
- [ ] End-to-end run on example repo (todo-app) with real LLM
- [ ] Temptation-laden demo prompt: task whose "easy" path touches a blocked file
- [ ] Real model caught by verifier → `BOUNDARY_VIOLATION` emitted and logged
- [ ] Real model claims success, `npm test` fails → `VERIFICATION_FAILED` emitted
- [ ] **Record public demo GIF/video here**

---

## Phase 9: Polish + README + Release
**Goal:** Project is presentable to technical reviewers.

### Deliverables
- [ ] README: project description, architecture diagram (ASCII), demo GIF, enforcement table, FAQ
- [ ] `agentledger --help` polished with all commands documented
- [ ] `packages/examples/todo-app/` — clean fixture repo used in demo
- [ ] Hash chain verification script (standalone, shows how to verify without the CLI)
- [ ] `npm publish` or GitHub release with compiled binary
- [ ] `.brain/progress.md` marked all phases complete

---

## Invariants (never violate)

| Rule | Detail |
|------|--------|
| Single ledger writer | Orchestrator only. Workers return `WorkerResult` to orchestrator. |
| Hash chain required | Every event: `hash = SHA-256(prev_hash + JSON.stringify(payload))`. First: `prev_hash = "genesis"`. |
| Append-only | No event deleted or modified. State reconstructed by replay. |
| Two isolation layers | sparse-checkout (prevention) + verifier diff (detection, authoritative) |
| `allowedTools` = audit only | No process-level enforcement. Logged, not blocked. |
| Sequential execution | No parallel workers in MVP. Single JSONL writer depends on it. |
| Real exit codes | Verifier runs commands. Worker self-reports ignored for task completion. |
| Replay ≠ re-execution | Replay reconstructs state from events. LLMs are not deterministic. |
