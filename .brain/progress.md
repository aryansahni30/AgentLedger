# progress.md

## Current Status

**Phase:** Plugin v2 "The Trust Layer" — Phases 1-4 complete (stats, claim detection, warning zone, standalone skills)  
**Last updated:** 2026-07-15

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

### Phase 11: Human Approval Gates ✅
- [x] `packages/core/src/approvals/approvalPolicy.ts` — `shouldRequireApproval(task, workerResult, policy) → ApprovalDecision`; 4 triggers: `all`, `high_risk_keywords`, `new_dependencies`, `blocked_files_nearby`
- [x] `packages/core/src/approvals/approvalState.ts` — `getPendingApprovals`, `isApproved`, `isRejected`, `isAwaitingApproval`; all pure functions over ledger events
- [x] `packages/core/src/approvals/index.ts` — barrel re-export
- [x] `packages/core/src/index.ts` — approvals barrel wired in
- [x] `packages/cli/src/commands/run.ts` — approval gate inserted after PATCH_PROPOSED; emits HUMAN_APPROVAL_REQUESTED, preserves worktree, exits with instructions
- [x] `packages/cli/src/commands/resume.ts` — reconstructs run from ledger; handles awaiting_approval (checks for grant/reject), reruns verifier on preserved worktree; emits RUN_COMPLETED/RUN_FAILED
- [x] `packages/cli/src/commands/approvals.ts` — `listApprovals`, `approveRun` (HUMAN_APPROVAL_GRANTED), `rejectRun` (HUMAN_APPROVAL_REJECTED)
- [x] `packages/cli/src/index.ts` — `resume <runId>` + `approvals list/approve/reject` commands registered
- [x] `replay.test.ts` bug fix — PATCH_PROPOSED now leaves task in `running` (not `awaiting_verification`); next event decides path
- [x] 40 new approval tests in `approvals/__tests__/approvals.test.ts` — all passing
- [x] **225 total tests across 12 test files — all passing**
- Key design: approval checked post-PATCH_PROPOSED, pre-VERIFICATION_STARTED; worktree preserved during pause; WorkerResult reconstructed from PATCH_PROPOSED + WORKTREE_CREATED payloads on resume

### Phase 12: Real-Time Write Blocking (Phase B) ✅
- [x] `packages/core/src/llm/writeBoundaryGuard.ts` — pure `checkWritePermission(relativePath, allowedFiles, blockedFiles)` with no I/O; mirrors verifier priority (blocked first, then unowned)
- [x] `ToolDenialSchema` + `ToolDenial` type added to schemas; `WorkerResultSchema` extended with `toolDenials: z.array(ToolDenialSchema).default([])`
- [x] `"TOOL_DENIED"` added to `LedgerEventTypeSchema`
- [x] `WorkerLedgerOpts` interface exported from `workerLLM.ts` and `llm/index.ts` — carries `{writer, runId, taskId}` for real-time event emission
- [x] `execWriteFile` in `workerLLM.ts` + `workerTogetherLLM.ts` — boundary check BEFORE disk write; denied writes push to `toolDenials[]`, emit `TOOL_DENIED` ledger event, return denial message to model for course-correction
- [x] `run.ts` — constructs `ledgerOpts` from orchestrator's `LedgerWriter`; passes to workers; displays real-time denial summary after task completes
- [x] 15 new tests in `writeBoundaryGuard.test.ts` — all passing (blocked exact/glob, priority, dot files, unowned, edge cases)
- [x] **246 total tests across 14 test files — all passing**
- Key design: Single-writer invariant preserved (orchestrator's writer instance reused in worker, never a new writer); prevention layer (real-time) + detection layer (verifier) both active independently

### Phase 13: Multi-Dev Coordination (Phase C) ✅
- [x] `packages/core/src/handoff/generateHandoff.ts` — pure `generateHandoff(events, runId) → HandoffDocument`; two-pass: replayLedger for status, raw event scan for PATCH_PROPOSED summaries + HUMAN_APPROVAL_REQUESTED timestamps; `buildSuggestedAction()` produces actionable strings
- [x] `packages/core/src/context/priorTaskContext.ts` — pure `buildPriorTaskContext(events, task) → PriorTaskContext[]`; reads TASK_CREATED titles + latest PATCH_PROPOSED summaries for each dependency; returns `[]` when no dependencies or no patches
- [x] `packages/core/src/llm/prompts/priorContextBuilder.ts` — `formatPriorContextForPrompt(priorContext) → string`; injected between task metadata and Tools section in worker prompt
- [x] `packages/core/src/reassignment/reassignTask.ts` — `validateReassignment` (pending-only guard, non-empty owner), `reassignTask` (emits TASK_ASSIGNED with `owner` in payload)
- [x] `replayLedger.ts` — TASK_ASSIGNED now reads `payload["owner"]` to update task owner on replay
- [x] `workerLLM.ts` + `workerTogetherLLM.ts` — `priorContext?: PriorTaskContext[]` added as optional 4th param; backwards-compatible
- [x] `run.ts` — reads all ledger events before each task, calls `buildPriorTaskContext`, passes to worker, logs upstream count
- [x] `agentledger handoff [-r <runId>] [--json] [-d <dir>]` CLI command — colored pretty-print or JSON
- [x] `agentledger assign <runId> <taskId> <newOwner> [-d <dir>]` CLI command — replay + reassignTask
- [x] 6 Zod schemas + 6 types added to `schemas/index.ts` (PriorTaskContext, CompletedTaskSummary, PendingTaskSummary, FailedTaskSummary, AwaitingApprovalSummary, HandoffDocument)
- [x] 47 new tests (16 generateHandoff + 9 priorTaskContext + 22 reassignTask) — all passing
- [x] Build fix: `exactOptionalPropertyTypes` required `?? false` for optional bool in CLI index
- [x] **293 total tests across 16 core + 1 CLI test files — all passing**
- Key design: Single-writer invariant preserved (reader used for prior context, existing writer unchanged); pure function principle (all new core functions are I/O-free)

### Phase 14: Enterprise Governance (Phase D) ✅
- [x] `packages/core/src/governance/patchScanner.ts` — pure `scanPatch(diff: string): PatchRisk[]`; parses unified diff headers + hunk positions + `+` lines; 4 categories: secret (critical), schema_mutation (high), auth_code (medium), dependency_change (medium); lineContext truncated to 120 chars
- [x] `packages/core/src/governance/policyEngine.ts` — `DEFAULT_GOVERNANCE_POLICY` (deny secret/critical, require_approval schema/high + auth/medium, warn dep_change/medium); `evaluatePolicy(task, risks, policy?) → PolicyDecision`; precedence deny > require_approval > warn > allow; `loadGovernancePolicy(dir)` reads `governance.json` with fallback
- [x] `packages/core/src/governance/auditReport.ts` — `computeRiskScore(tasks): RiskScore`; per-category caps (secret×20 cap 40, schema×15 cap 30, auth×10 cap 20, boundary×5 cap 10, tool_denial×2 cap 10); total capped at 100; `generateAuditReport(events, runId): AuditReport` pure function from ledger events
- [x] `packages/core/src/governance/index.ts` + `core/src/index.ts` wired
- [x] `packages/core/src/git/getWorktreeDiff.ts` — `git add -A` then `git diff --cached HEAD`; captures untracked new files
- [x] 11 new Zod schemas + types added to `schemas/index.ts` (PatchRiskSeverity, PatchRiskCategory, PatchRisk, GovernancePolicyRule, GovernancePolicy, PolicyDecision, ApprovalRecord, AuditTaskRecord, RiskScoreBreakdown, RiskScore, AuditReport)
- [x] `PATCH_RISK_DETECTED` + `POLICY_EVALUATED` added to `LedgerEventTypeSchema`
- [x] `run.ts` — governance scan inserted after PATCH_PROPOSED: loadGovernancePolicy → getWorktreeDiff → scanPatch → evaluatePolicy → emit PATCH_RISK_DETECTED (if risks) + POLICY_EVALUATED; deny → TASK_FAILED + skip; warn → continue; require_approval → HUMAN_APPROVAL_REQUESTED + pause
- [x] `packages/cli/src/commands/audit.ts` + `agentledger audit [-r <runId>] [--json]` CLI command
- [x] `packages/cli/src/index.ts` — audit command registered
- [x] Bug fixes: `PolicyAction` type alias replaces `typeof topAction` narrowing; `replayLedger.ts` treats `BOUNDARY_VIOLATION` idempotent when task already "completed"; `makeMinimalRun()` in tests gets `INTENT_COMPILED` event; patchScanner external import pattern strips `^[+]` prefix (content already stripped)
- [x] 57 new tests (22 patchScanner + 18 policyEngine + 17 auditReport) — all passing
- [x] **350 total tests across 19 core + 1 CLI test files — all passing**
- Key design: All governance modules are pure functions; single-writer invariant preserved (governance reads diff/events, orchestrator writes governance events); `require_approval` routes through same HUMAN_APPROVAL_REQUESTED event as Phase 11 gate

### Phase 15: Agent Handoff Brief (Phase A) ✅
- [x] 8 new Zod schemas in `schemas/index.ts`: `FailureReason` (enum), `FailureContext`, `FailedTaskDetail`, `FileInventory`, `UnresolvedRisk`, `ResumptionAction` (enum), `ResumptionGuidance`, `HandoffBrief`
- [x] `packages/core/src/handoff/generateHandoffBrief.ts` — pure `generateHandoffBrief(events, runId) → HandoffBrief`
  - `classifyFailure()` — scans task events chronologically; returns first recognizable failure cause: `boundary_violation` | `verification_failed` | `governance_denied` | `human_approval_rejected` | `tool_denial` | `unknown` + structured context
  - `buildFileInventory()` — PATCH_PROPOSED files → `mergedFiles` (completed tasks) vs `worktreeFiles` (non-completed); `allFiles` = deduped union
  - `extractUnresolvedRisks()` — PATCH_RISK_DETECTED on non-completed tasks; sorted critical > high > medium; capped at 5
  - `buildResumptionGuidance()` — 5-branch decision tree: run_completed → approve_pending → retry_failed_task → investigate_failure → resume_run
  - `buildContextSummary()` — dense ~2000 char narrative with unicode (✓ ✗ ⏳ ↺ → ⚠) for pasting into new agent context
- [x] `packages/core/src/handoff/index.ts` — exports `generateHandoffBrief` alongside existing `generateHandoff`
- [x] 48 new tests in `generateHandoffBrief.test.ts` — all 5 failure reason paths, file inventory (merged/worktree/allFiles/dedup), unresolved risks (filtering, sorting, cap), all 5 resumption guidance branches, contextSummary format
- [x] `packages/cli/src/commands/handoff.ts` — `--brief` (colored HandoffBrief output with typed failure reasons, risks, file inventory sections) + `--agent-prompt` (ready-to-paste LLM context prompt with AGENT_PROMPT_TEMPLATE)
- [x] `packages/cli/src/index.ts` — `--brief` and `--agent-prompt` flags wired to `handoff` command
- [x] **398 total tests across 20 test files — all passing**
- Key design: `HandoffBrief` is strictly additive alongside `HandoffDocument` (no breaking change); pure function principle maintained; `--agent-prompt` emits a template with `{CONTEXT_SUMMARY}`, `{ACTION}`, `{COMMAND}` substituted

### Phase E: React + Vite Visualizer ✅
- [x] `packages/visualizer/` — new workspace package `@agentledger/visualizer`; React 18 + Vite 5 + TypeScript
- [x] `src/types.ts` — local mirrors of all server response types; zero dependency on `@agentledger/core`
- [x] `SSEProvider` / `SSEContext` — single shared `EventSource` connection; broadcasts to all hook subscribers via `Set<Listener>`; exposes `connected` boolean; auto-reconnects (3s delay)
- [x] `useSSE(onEvent)` — subscribes via `useSSEContext().subscribe`; stable ref pattern; returns unsubscribe
- [x] `useRuns()` — fetch `/api/runs` on mount + debounced SSE refetch (200ms); `{ runs, loading, error, refresh }`
- [x] `useLeaderboard()` — same debounce pattern; fetches `/api/leaderboard`
- [x] `useEventFeed()` — appends SSE events to state array; caps at MAX_EVENTS=100
- [x] Components: `StatusBadge`, `RunList`, `RunDetail`, `TaskCard`, `EventFeed`, `Leaderboard`
- [x] `App.tsx` — CSS Grid layout (header / sidebar / main / event-feed panel); tab switching (Runs / Leaderboard); live connection indicator
- [x] `src/styles/index.css` — dark theme with CSS custom properties; all layout, components, status colors
- [x] Vite proxy: `/api` → `http://localhost:3000`
- [x] 5 component tests (StatusBadge) with `@testing-library/react` — all passing
- [x] Production build: 149.8 kB JS + 6.17 kB CSS, zero TypeScript errors
- [x] **511 total tests across all packages (5 new) — all passing**
- Key design: Single SSE connection shared across all hooks via Context; local `types.ts` mirrors keep visualizer self-contained; `EventSource` is browser-native — no SSE library needed

### Phase D: Express API Server + SSE Stream ✅
- [x] `packages/server/` — new workspace package `@agentledger/server`; fully independent of CLI
- [x] `FileWatcher` — `fs.watch` + 100ms debounce + line-count tracking + `_reading` in-flight guard; `start()` loads existing events into `eventStore` via `onNewEvents` callback
- [x] `SSEManager` — `Map<id, Response>`; replays historical events from shared `_eventStore` ref on `addClient(sinceEventId?)`; `broadcast(event)` pushes to all live clients; `closeAll()` on shutdown
- [x] Routes: `GET /api/runs`, `GET /api/runs/:runId` (replayLedger per run), `GET /api/leaderboard` (buildLeaderboard), `GET /api/events` (SSE), `GET /api/events/stats` (clientCount + eventCount)
- [x] `createApp(opts)` factory — mounts all routers, no signal handlers
- [x] `createServer(opts) → { port, close }` — wires FileWatcher→eventStore→SSEManager; `listen(0)` for dynamic port in tests; `close()` stops watcher + SSE clients + http.Server
- [x] `packages/cli/src/commands/serve.ts` — imports only `createServer`; owns `SIGINT`/`SIGTERM` handlers
- [x] `agentledger serve [--port <n>] [-d <dir>]` CLI command wired in `index.ts`
- [x] `@agentledger/server` added to CLI `package.json` as `workspace:*`
- [x] 7 integration tests (2 files): 4 REST route tests (routes.integration.test.ts) + 3 SSE tests (sseIntegration.test.ts) — all using Node built-in `http` module, no supertest
- [x] **506 total tests across all packages — all passing**
- Key design: `packages/server/` has zero dependency on `packages/cli/`; CLI imports only `createServer`; single-writer invariant preserved (server is read-only; no ledger writes); dynamic port `listen(0)` used for test isolation; `pnpm install` added express + cors deps (+39 packages)

### Phase 11 (Plugin): Claude Code Observer/Enforcer Plugin ✅
- [x] `packages/plugin/` — new workspace package `agentledger-plugin`; zero build step (plain ESM scripts)
- [x] `RunModeSchema` + `RunCreatedPayloadSchema` + `RunMode` + `RunCreatedPayload` types added to `schemas/index.ts`
- [x] `run_mode: "orchestrated"` added to RUN_CREATED payload in `cli/src/commands/run.ts`
- [x] `scripts/state.js` — `readSessionState`, `writeSessionState`, `clearSessionState` with `proper-lockfile`; state lives in `.agentledger/session.json`; default shape: `{ runId: null, previousHash: genesis_hash, dirty: false, sessionStart: ISO }`
- [x] `scripts/server-manager.js` — `ensureServerRunning()` — GET /health, spawn detached if not up, poll 2s max; non-fatal
- [x] `scripts/summary.js` — `buildSessionSummary(projectDir)` reads ledger + verifyChain + replayLedger; `formatSummary()` formats compact console block
- [x] `scripts/hooks/session-start.js` — ensure `.agentledger/` + default `config.json`; start dashboard (non-blocking); writes summary via Claude Code SessionStart JSON envelope on stdout with both `hookSpecificOutput.additionalContext` (model context injection) and `systemMessage` (user-visible terminal banner). Raw text does NOT work — must use JSON envelope per Claude Code hook contract (matched claude-mem/ECC plugin pattern)
- [x] `scripts/hooks/pre-tool-use.js` — Layer 1: minimatch block on Edit/Write to `blockedFiles`; emits TOOL_DENIED event (with `file_path` + `matched_pattern`); exits code 2 (Claude Code block protocol); lazy-inits observed run if none active
- [x] `scripts/hooks/post-tool-use.js` — lazy run init on first Edit/Write (RUN_CREATED observed + INTENT_COMPILED); records TOOL_CALLED for Edit/Write/Bash
- [x] `scripts/hooks/session-end.js` — Layer 2: git diff boundary check + test command run; emits BOUNDARY_VIOLATION / VERIFICATION_PASSED/FAILED / RUN_COMPLETED/FAILED; clears session state
- [x] `hooks/hooks.json` — nested object format mirroring settings.json; SessionStart/PreToolUse(Edit|Write)/PostToolUse(Edit|Write|Bash)/SessionEnd
- [x] `skills/ledger.md`, `skills/verify.md`, `skills/handoff.md`, `skills/audit.md` — 4 slash commands; rewritten as proper SKILL.md with YAML frontmatter, delegating to CLI commands
- [x] `PLUGIN_README.md` — install command, enforcement gap documented, config.json reference
- [x] `pnpm install` confirms workspace recognition; 4 dependencies resolved
- [x] `packages/cli/src/commands/verify.ts` — dual-mode: orchestrator (tasks.json exists) vs observed (no tasks.json); observed mode checks `blockedFiles` + `testCommand` from plugin-style config.json against cwd
- [x] 7 pre-tool-use tests updated + 1 new lazy-init test — all passing

### Phase 10: MCP Server ✅
- [x] `packages/mcp-server/` — new workspace package, publishable as `agentledger-mcp` on npm
- [x] 5 MCP tools over stdio transport (no HTTP):
  - `append_event` — hash-chained event append; auto-generates `event_id` if omitted
  - `get_task` — replay ledger → AgentTask; infers `run_id` from ledger if omitted
  - `claim_task` — assert pending + emit TASK_ASSIGNED + return updated task
  - `query_ledger` — filter events by run_id / task_id / event_type; last N in append order
  - `get_run_summary` — replay ledger → RunState
- [x] All tool I/O validated with Zod; zero ledger logic duplicated (pure imports from `@agentledger/core`)
- [x] `AGENTLEDGER_PROJECT_ROOT` env var read lazily (first tool call); throws descriptive error if unset
- [x] `"mcp"` script added to root `package.json` (`node packages/mcp-server/dist/index.js`)
- [x] `.brain/architecture.md` rewritten with full monorepo tree, data flow diagrams, MCP section

### Plugin v2: "The Trust Layer" — Phases 1-4 ✅
Architecture doc: `.brain/plugin-v2-plan.md`

**Phase 1: Stats Foundation + Enhanced Banner ✅**
- [x] `scripts/stats.js` — NEW: `readStats()`, `writeStats()`, `mergeSessionStats()` with lockfile; persistent `stats.json` tracks trust score, claims, blocks, read:edit ratio
- [x] `scripts/state.js` — EXTENDED: session state now tracks `reads`, `edits`, `writes`, `bashCalls`, `blocks`, `warnings`, `claimsDetected`, `claimsVerifiedTrue/False`, `claimsUnverifiable`, `filesRead[]`, `filesEdited[]`, `editWithoutRead[]`, `falseClaims[]`
- [x] `scripts/hooks/post-tool-use.js` — EXTENDED: now tracks `Read` tool (matcher `Edit|Write|Bash|Read`), increments per-tool counters, tracks unique file lists, detects edit-without-read (warns on stderr)
- [x] `scripts/summary.js` — REWRITTEN: banner now shows trust score (hero number), lies caught, writes blocked, chain integrity, sessions tracked. Color-coded: green ≥90%, yellow ≥70%, red <70%
- [x] `scripts/hooks/session-end.js` — ENHANCED: computes session stats, calls `mergeSessionStats()` to persist, shows claims/boundary/tests/read:edit ratio/trust delta in summary
- [x] `scripts/hooks/pre-tool-use.js` — EXTENDED: increments `blocks` counter in session state on denial
- [x] 9 new stats tests + 6 updated summary tests — 45 total, all passing

**Phase 2: Stop Hook — Claim Detection + Instant Verification ✅**
- [x] `scripts/claim-detector.js` — NEW: `detectClaims(text)` scans for 8 claim patterns (test_claim, build_claim, fix_claim, completion_claim, quality_claim); strips code blocks and inline code to avoid false positives; deduplicates by type
- [x] `scripts/verifier.js` — NEW: shared `verify()` function extracted from session-end; `runTestCommand()`, `getChangedFiles()`, `detectBoundaryViolations()`; used by both Stop hook and SessionEnd
- [x] `scripts/hooks/stop.js` — NEW: fires every assistant turn; extracts message, detects claims, runs quick verification (30s timeout), emits `CLAIM_VERIFIED`/`CLAIM_FALSIFIED`/`CLAIM_UNVERIFIABLE`; 60s debounce per claim type; skips turns with no file changes
- [x] `hooks/hooks.json` — Stop hook registered (45s timeout)
- [x] 17 claim-detector tests + 5 verifier tests — 67 total, all passing

**Phase 3: Warning Zone + Risk-Tiered Config ✅**
- [x] `scripts/hooks/pre-tool-use.js` — EXTENDED: `warnFiles` config alongside `blockedFiles`; blocked = exit(2) hard block, warned = stderr warning + `TOOL_WARNED` event + exit(0) allow
- [x] Default `warnFiles`: `**/migrations/**`, `**/auth/**`, `package.json`, `**/middleware.*`
- [x] Default config extended: `warnFiles`, `claimDetection: true`
- [x] Warning counter tracked in session state

**Phase 4: Standalone Skills (Drop CLI Dependency) ✅**
- [x] `skills/ledger.md` — REWRITTEN: reads `ledger.jsonl` directly, no CLI
- [x] `skills/verify.md` — REWRITTEN: runs test command + git diff directly
- [x] `skills/audit.md` — REWRITTEN: reads `stats.json` + `ledger.jsonl`, computes risk score
- [x] `skills/handoff.md` — REWRITTEN: reads ledger + session state, generates handoff doc
- [x] `skills/trust.md` — NEW: trust score breakdown, recent false claims, read:edit ratio

**New files created:**
- `scripts/stats.js` — persistent stats module
- `scripts/verifier.js` — shared verification logic
- `scripts/claim-detector.js` — claim pattern matching
- `scripts/hooks/stop.js` — real-time claim detection hook
- `skills/trust.md` — trust score skill
- `__tests__/stats.test.js` — 9 tests
- `__tests__/claim-detector.test.js` — 17 tests
- `__tests__/verifier.test.js` — 5 tests

**67 total plugin tests across 9 test files — all passing**

### Standalone Install Path ✅
Architecture doc: prompt file (not in .brain/)

**Part 1: esbuild Bundling ✅**
- [x] `build.js` — esbuild bundles each hook entry point + all deps (zod, minimatch, proper-lockfile, @agentledger/core) into self-contained CJS files under `dist/`
- [x] CJS format chosen — `proper-lockfile` uses CommonJS `require()` internally; ESM shim throws
- [x] `import.meta.url` polyfill via esbuild banner: `var import_meta_url = require('url').pathToFileURL(__filename).href;`
- [x] Zero external dependencies — bundles run standalone with no `node_modules`
- [x] Source ESM scripts still work for monorepo dev; CJS bundles for standalone install
- [x] Bundle size: ~1.1-1.2 MB per hook (mostly zod)
- [x] `hooks/hooks.json` updated to point to `dist/*.cjs` files

**Part 2: Automated Skills Installation ✅**
- [x] `session-start.js` → `installSkills()` runs on every session start
- [x] Installs to `~/.claude/skills/agentledger-{name}/SKILL.md` (directory + SKILL.md format Claude Code indexes)
- [x] Idempotent — skips identical files, never clobbers user-customized versions
- [x] Resolves skill source from both `scripts/../skills/` (ESM dev) and `dist/skills/` (bundled install)
- [x] 5 skills: ledger, verify, audit, handoff, trust

**Part 3: Dashboard Graceful Degradation ✅**
- [x] `server-manager.js` rewritten — `ensureServerRunning()` returns `{ running: boolean, port: number }`
- [x] Port read from `config.json` `dashboardPort` field (default 4242)
- [x] Server spawn searches multiple paths: bundled `dist/server.cjs` first, monorepo `server/dist/main.js` fallback
- [x] Banner conditionally shows URL (when server running) or "not running" (when not)
- [x] `summary.js` → `formatSummary()` accepts `dashboardStatus` parameter
- [x] `DEFAULT_CONFIG` extended: `testTimeout: 30000`, `dashboardPort: 4242`

**Part 4: Install Script ✅**
- [x] `install.js` — single-command installer: `node install.js`
- [x] Merges hooks into `~/.claude/settings.json` — preserves existing hooks from other plugins
- [x] JSONC parsing — handles `//` comments in settings files without breaking `https://` URLs
- [x] Detects and replaces old AgentLedger hook entries (case-insensitive path matching)
- [x] Installs skills via same `installSkills()` logic
- [x] `package.json` `bin.agentledger-install` for `npx agentledger-install`
- [x] `"private": true` removed — package is publishable

**Part 5: Fresh Install Simulation ✅**
- [x] Created fresh git repo in /tmp with trivial package.json + test script
- [x] All hooks fire correctly standalone (no workspace, no node_modules)
- [x] Boundary block: `.env` write → exit 2 ✓
- [x] Normal edit: allowed → exit 0 ✓
- [x] Post-tool-use: creates run, records TOOL_CALLED ✓
- [x] Session-end: runs `npm test`, prints PASSED/FAILED summary ✓
- [x] Ledger events: 6 events recorded with correct types and actors ✓
- [x] Edit-without-read warning: fires correctly ✓
- [x] Dashboard: "not running" when server unavailable (no crash) ✓
- [x] Config auto-created with all v2 fields ✓

**New/modified files:**
- `build.js` — NEW: esbuild bundler script
- `install.js` — NEW: single-command installer
- `package.json` — MODIFIED: build script, bin entry, removed private flag
- `hooks/hooks.json` — MODIFIED: points to dist/*.cjs
- `scripts/hooks/session-start.js` — MODIFIED: skill auto-install, dashboard conditional
- `scripts/server-manager.js` — MODIFIED: returns status, configurable port, multi-path server search
- `scripts/summary.js` — MODIFIED: conditional dashboard URL
- `scripts/verifier.js` — MODIFIED: suppress git stderr
- `__tests__/summary.test.js` — MODIFIED: dashboard conditional test
- `__tests__/session-start.test.js` — MODIFIED: dashboard status test

**67 total plugin tests across 9 test files — all passing**
**537 total tests across monorepo — all passing (5 pre-existing failures in visualizer + 2 core test files unchanged)**

---

## Blockers

None currently.

---

## Decisions Still Open

None — all major decisions locked in `decisions.md`.

---

## Notes

- The public demo GIF is deliberately deferred to Phase 7. Phase 6 fixtures are test coverage, not the public story.
- OpenAI adapter can be added alongside Anthropic in Phase 7 — Anthropic is the priority since Claude Code is the demo environment.
- `agentledger run` is the integration test for Phases 1-6 combined. Don't wait until Phase 7 to test the full pipeline with mocked components.
