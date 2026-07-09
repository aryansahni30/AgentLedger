# progress.md

## Current Status

**Phase:** Phase 9 complete — all phases done; release ready  
**Last updated:** 2026-07-08

---

## Phase Checklist

### Phase 1: Core skeleton ✅
- [x] pnpm monorepo init (`packages/core`, `packages/cli`)
- [x] TypeScript config (strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] CLI skeleton (`agentledger --help`, `init` command) — Commander.js
- [x] Zod schemas (`packages/core/src/schemas/`) — all 16 types
- [x] Ledger writer with hash chaining (`appendEvent`) — SHA-256, single writer, JSONL
- [x] Ledger reader (`readAll`, `readByRunId`, `readByTaskId`, `verifyChain`)
- [x] 10 integration tests — all passing; chain tamper detection verified

### Phase 2: Task graph ✅
- [x] IntentContract schema + parsing
- [x] AgentTask schema
- [x] Static/mock planner (`createPlan`) — rule-based two-task graph
- [x] Task graph validation — cycle detection (DFS), overlapping ownership, missing deps, duplicate IDs
- [x] `topoSort` — dependency-ordered execution list
- [x] `agentledger tasks view` CLI command — colored status output
- [x] 18 planner/validator tests — all passing
- [x] Comprehensive gap tests added before Phase 3: 65 tests total, 4 test files
  - `hashChain.test.ts` — 14 unit tests (determinism, sensitivity, edge cases, chain sequence)
  - `ledger.edge.test.ts` — 13 tests (malformed JSONL, previous_hash tamper, payload round-trip, auto-dir creation, multi-session chain continuity)
  - Planner expanded: multi-error simultaneous, 3-way overlap, diamond topoSort, empty topoSort, goal/criteria propagation

### Phase 3: Worker execution + git isolation ✅
- [x] `core/git` module: `createTaskWorktree`, `cleanupWorktree`
- [x] Sparse-checkout applied to `allowedFiles` (portable: git config + info/sparse-checkout file + read-tree)
- [x] Mock worker execution inside worktree (`packages/core/src/worker/MockWorker.ts`)
- [x] Structured `WorkerResult` returned to orchestrator (Zod-validated)
- [x] Patch artifact generation (`generatePatch`, `listModifiedFiles`)
- [x] `git add -A --sparse` used in patch generation to capture out-of-bounds files for boundary detection
- [x] 32 tests (19 worktree + 13 mock worker) — all passing; 97 total across 6 test files
- Note: `WORKTREE_CREATED`, `TASK_STARTED`, `PATCH_PROPOSED` ledger events deferred to Phase 4 orchestrator integration

### Phase 4: Verifier ✅
- [x] `checkFileBoundaries` — minimatch glob matching vs `allowedFiles`/`blockedFiles`; blocked takes priority
- [x] `runVerificationCommands` — real exit codes, stdout/stderr/durationMs captured; short-circuits on required failure; never throws
- [x] `verifyTask` — full pipeline: boundary → commands (skipped on boundary fail) → VerificationResult
- [x] `agentledger verify` CLI command — colored output, BOUNDARY_VIOLATION display, VERIFICATION PASSED/FAILED verdict
- [x] 24 verifier tests — all passing; 121 total across 7 test files
- Note: BOUNDARY_VIOLATION / VERIFICATION_FAILED / VERIFICATION_PASSED ledger event emission deferred to orchestrator integration (Phase 5+ when run loop wires everything)

### Phase 5: Replay ✅
- [x] `replayLedger(events, runId) → RunState` — pure function, no I/O
- [x] `RunReplayError` — exposes `eventIndex` and `eventType` for debugging
- [x] Forward-only state machine for both `RunStatus` and `TaskStatus`
- [x] Task state reconstruction (TASK_CREATED → assigned → running → awaiting_verification → completed/failed)
- [x] Run summary reconstruction (goal, startedAt, completedAt, filesModified dedup)
- [x] Invalid state transition detection — throws `RunReplayError`
- [x] Completion idempotency — VERIFICATION_PASSED + TASK_COMPLETED for same task handled gracefully
- [x] `agentledger replay` CLI command — hash chain integrity check, per-run or all-runs display, colored output
- [x] 20 replay tests — all passing; 141 total across 8 test files
- Note: `verifyChain` was already implemented in Phase 1 `LedgerReader`; replay CLI uses it

### Phase 6: Unhappy-path test fixtures ✅
- [x] `BoundaryViolatingWorker` — writes to blocked file and omits it from self-report, claims success
- [x] `FalseSelfReportWorker` — stays within file boundaries, lies about tests passing
- [x] 10 integration tests in `unhappyPath.integration.test.ts` — all passing
  - Scenario 1 (BOUNDARY_VIOLATION): blocked file caught, unowned file caught, commands skipped, message contains filename, self-report omits blocked file
  - Scenario 2 (VERIFICATION_FAILED): required failing command rejects task, passing command accepts, stderr captured, durationMs recorded, optional failure does not block
- [x] Bug fix: `verifyTask` now correctly ignores optional command failures — only required failures block the task
- [x] 151 total tests across 9 test files — all passing

### Phase 7: Real LLM integration + public demo ✅
- [x] Anthropic SDK (`@anthropic-ai/sdk`) added to `packages/core`
- [x] Singleton client (`packages/core/src/llm/client.ts`) — reads `ANTHROPIC_API_KEY`; `_resetClient()` for tests
- [x] `extractJSON` + `retryWithSchema` — extracts JSON from markdown fences or bare JSON; retries 3× passing `lastError` back to generator
- [x] Planner prompt: system (JSON-only, TaskGraph schema, block .env/secrets) + user + retry variant
- [x] Worker prompt: system (allowedFiles/blockedFiles, CRITICAL RULES) + user message
- [x] `planWithLLM` — calls Anthropic, retries on schema failure, default model `claude-haiku-4-5-20251001`
- [x] `runWorkerLLM` — full Anthropic tool_use loop with 4 tools (`list_directory`, `read_file`, `write_file`, `task_complete`); `safeRelativePath` blocks path traversal; `actualFilesWritten` vs `selfReportedFilesModified`; max 40 tool calls
- [x] `gatherRepoContext` — top-level listing + README.md + src/ file tree (max 60 files, ignores `.git`/`node_modules`/`.agentledger`/`dist`/`coverage`)
- [x] `agentledger run "<request>"` — full orchestrator: RUN_CREATED → INTENT_COMPILED → TASK_CREATED × n → per-task (TASK_ASSIGNED → WORKTREE_CREATED → TASK_STARTED → PATCH_PROPOSED → BOUNDARY_VIOLATION? → VERIFICATION_PASSED/FAILED → TASK_COMPLETED/FAILED) → RUN_COMPLETED/RUN_FAILED
- [x] Mock planner fallback (`--mock-planner` flag); graceful LLM fallback on API error
- [x] `packages/examples/demo-repo` — db.ts + app.ts + .env (BLOCKED) + README + package.json; temptation scenario: add Redis caching → model tempted to write REDIS_URL to blocked .env
- [x] 35 new tests: 17 retryWithSchema, 18 prompt tests — 186 total across 11 test files, all passing
- [x] README.md written (architecture diagram, demo instructions, failure examples, honest disclaimers)
- [x] Demo GIF recorded — simulation script (VHS) showing BOUNDARY_VIOLATION + VERIFICATION_FAILED + replay

### Phase 8: Polish ✅
- [x] `.gitignore` at repo root (node_modules, dist, .agentledger, .env, source maps)
- [x] `demo.tape` — VHS script driving demo-simulate.sh via wrapper binary (avoids `$@` parsing in VHS Type strings)
- [x] `scripts/bin/agentledger` wrapper — thin bash wrapper routing demo commands to demo-simulate.sh
- [x] `scripts/demo-simulate.sh` — scripted simulation of both unhappy-path scenarios + replay output
- [x] Demo embedded in README.md as animated GIF

### Phase 9: Release ✅
- [x] `scripts/verify-chain.mjs` — standalone hash-chain verifier, no dependencies, Node.js >= 18
  - Checks `previous_hash` continuity and `hash` integrity per event
  - Quiet mode (`--quiet`/`-q`) for CI: outputs `OK N` / `FAIL N`, exits 0/1
  - Colored output with line numbers and event IDs for interactive use
- [x] README.md updated — "Standalone tools" section documenting verify-chain.mjs
- [x] 13 commits pushed to GitHub; all phases complete

---

## Blockers

None currently (pre-build).

---

## Decisions Still Open

None — all major decisions locked in `decisions.md`.

---

## Notes

- The public demo GIF is deliberately deferred to Phase 7. Phase 6 fixtures are test coverage, not the public story.
- OpenAI adapter can be added alongside Anthropic in Phase 7 — Anthropic is the priority since Claude Code is the demo environment.
- `agentledger run` is the integration test for Phases 1-6 combined. Don't wait until Phase 7 to test the full pipeline with mocked components.
