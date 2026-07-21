# architecture.md

## Monorepo Structure

```
packages/
  core/               @agentledger/core — all domain logic
    src/
      schemas/        Zod schemas — single source of truth for all types
      ledger/         LedgerWriter (append, hash-chain), LedgerReader (read, verify)
      planner/        Intent → TaskGraph (mock + LLM planners)
      worker/         WorkerContext execution, fixture workers (boundary violating, false self-report)
      verifier/       Boundary check (minimatch) + command runner (real exit codes)
      replay/         replayLedger() — pure function, events → RunState
      approvals/      shouldRequireApproval (policy), getPendingApprovals / isApproved / isRejected (state)
      git/            createTaskWorktree / cleanupWorktree (sparse-checkout)
      llm/            Anthropic + Together adapters, retryWithSchema, prompt builders
      projects/       registry.ts — readRegistry / registerProject over ~/.agentledger/projects.json
                      (canonical realpath key, basename identity, proper-lockfile writes)
  cli/                agentledger CLI — Commander.js
    src/commands/
      init.ts         agentledger init
      run.ts          agentledger run "<goal>" — full orchestrator loop (with approval gate)
      tasks.ts        agentledger tasks view
      verify.ts       agentledger verify
      replay.ts       agentledger replay
      resume.ts       agentledger resume <runId> — continue paused run after approval
      approvals.ts    agentledger approvals list/approve/reject
      handoff.ts      agentledger handoff [--brief] [--agent-prompt] [--json]
      assign.ts       agentledger assign <runId> <taskId> <newOwner>
      audit.ts        agentledger audit / agentledger leaderboard
      serve.ts        agentledger serve — starts API server, owns SIGINT/SIGTERM handlers
  plugin/             agentledger-plugin — Claude Code observer/enforcer plugin
    build.js            esbuild bundler — each hook → self-contained CJS under dist/
    install.js          Single-command installer: merges hooks into settings.json, installs skills
    hooks/
      hooks.json        Hook matchers pointing to dist/*.cjs (SessionStart/PreToolUse/PostToolUse/Stop/SessionEnd)
    scripts/            Source ESM scripts (for monorepo dev; bundled to dist/ for standalone)
      state.js          readSessionState / writeSessionState / clearSessionState (proper-lockfile)
      run-init.js       ensureRun(state, actor) — lazy RUN_CREATED + INTENT_COMPILED; shared by pre/post-tool-use + stop
      (SessionStart)    registers the repo in ~/.agentledger/projects.json via core's registerProject
      server-manager.js ensureServerRunning() → { running, port }; configurable port from config.json
      summary.js        buildSessionSummary + formatSummary; conditional dashboard URL
      stats.js          readStats / writeStats / mergeSessionStats — persistent stats.json
      claim-detector.js detectClaims(text) — 8 regex patterns, 5 claim types, code-block stripping
      verifier.js       verify() — shared test runner + git diff boundary check
      end-summary.js    writeLastSummary / readAndClearLastSummary (persist + show-once replay of the
                        Session End box) + renderCheckpointBox (live compaction banner). See ADR-023.
      hooks/
        session-start.js  Ensure .agentledger/ + config.json; install skills; start dashboard; print banner.
                          Reads payload `source` from stdin: replays the persisted End box (clear/startup/
                          resume) or renders a live checkpoint (compact) into systemMessage. See ADR-023.
        pre-tool-use.js   Layer 1: blockedFiles → exit(2) block; warnFiles → stderr warning
        post-tool-use.js  Lazy run init (first Edit/Write → RUN_CREATED observed); Read/Edit/Write/Bash tracking
        stop.js           Real-time claim detection: read last_assistant_message, verify claims, surface discrepancies.
                          Gated on any tool call (not edits) and lazy-inits its own run — a run-tests-and-report
                          turn edits nothing, and is the most common claim there is.
        session-end.js    Layer 2: git diff + test command; stats merge; trust delta; enhanced summary.
                          Persists the box via writeLastSummary (SessionEnd stdout is swallowed by the host).
    skills/             5 slash commands (ledger, verify, audit, handoff, trust) — standalone, no CLI dependency
    dist/               Bundled CJS files — zero external dependencies, runs standalone without workspace
      *.cjs             Self-contained hook bundles (zod + minimatch + proper-lockfile + core inlined)
      skills/           Copied skill .md files for install script access
  server/             @agentledger/server — Express HTTP API + SSE event stream
    src/
      services/
        fileWatcher.ts   FileWatcher — fs.watch + 100ms debounce + line-count tracking + _reading guard
        ledgerRegistry.ts LedgerRegistry — one tagging FileWatcher per registered project + watches the
                          registry file for projects appearing live. Emits TaggedEvent (LedgerEvent + project).
                          projectSummaries(): per-project eventCount/sessionCount + per-ledger chainValid.
        sseManager.ts    SSEManager — Map<id, Response>; replay on addClient(); broadcast() to all
      routes/
        runs.ts          GET /api/runs, GET /api/runs/:runId — replay from tagged store, each run tagged w/ project
        leaderboard.ts   GET /api/leaderboard — buildLeaderboard(all tagged events); cross-project by definition
        events.ts        GET /api/events (SSE), /api/events/history (tagged store), /api/events/stats
        projects.ts      GET /api/projects — selector options + per-project chain badge roll-up
      index.ts           createApp() factory — routes read the shared tagged store; getProjectSummaries injected
      server.ts          createServer() — LedgerRegistry→eventStore→SSEManager; binds 127.0.0.1; returns {port, close}
  visualizer/         @agentledger/visualizer — React 18 + Vite 5 SPA
    src/
      types.ts           Local mirrors of server response types (no core dependency)
      context/
        SSEContext.tsx   SSEProvider: single EventSource, Set<Listener> broadcast, connected boolean
        ProjectContext.tsx ProjectProvider: fetch /api/projects, localStorage selection, SSE-refetch on new
                          project, chain roll-up (allChainsValid + invalidChains). selected=null → All Projects.
      hooks/
        useSSE.ts        Subscribes via SSEContext — no direct EventSource per hook
        useRuns.ts       fetch /api/runs + 200ms debounced SSE refetch
        useLeaderboard.ts fetch /api/leaderboard + 200ms debounced SSE refetch
        useEventFeed.ts  Append SSE events, cap at 100
      components/
        StatusBadge.tsx  Colored pill for RunStatus / TaskStatus
        RunList.tsx      Sidebar: clickable run list
        RunDetail.tsx    Main panel: goal, status, task list
        TaskCard.tsx     Single task with status, owner, allowedFiles
        EventFeed.tsx    Right panel: live scrolling event log
        Leaderboard.tsx  Risk score table sorted by score desc
        ProjectSelector.tsx Top-nav dropdown (All Projects + each) + chain-integrity roll-up badge
      App.tsx            Aggregate band (all projects) + trend chart; session list/detail filtered by selected project
      main.tsx           Entry: StrictMode → SSEProvider → ProjectProvider → App
      Data split         Aggregate/trends = ALL projects (never filtered); session list/detail = selected project only
      styles/index.css   Dark theme, CSS custom properties
  mcp-server/         agentledger-mcp — MCP server over stdio
    src/
      ledger.ts       Factory: getReader() / getWriter() from AGENTLEDGER_PROJECT_ROOT env
      index.ts        McpServer + StdioServerTransport, registers 5 tools
      tools/
        appendEvent.ts    append_event tool
        getTask.ts        get_task tool
        claimTask.ts      claim_task tool
        queryLedger.ts    query_ledger tool
        getRunSummary.ts  get_run_summary tool
  examples/
    demo-repo/        Temptation scenario: add Redis caching, .env is BLOCKED
```

## Data Flow

```
User: agentledger run "add feature"
  └─ run.ts (orchestrator)
       ├─ LedgerWriter.appendEvent(RUN_CREATED)
       ├─ planWithLLM / createPlan → TaskGraph
       ├─ LedgerWriter.appendEvent(INTENT_COMPILED)
       ├─ LedgerWriter.appendEvent(TASK_CREATED × n)
       └─ for each task (topoSort order):
            ├─ createTaskWorktree (git worktree + sparse-checkout)
            ├─ LedgerWriter.appendEvent(TASK_ASSIGNED, WORKTREE_CREATED, TASK_STARTED)
            ├─ runWorkerLLM / workerFn → WorkerResult
            ├─ LedgerWriter.appendEvent(PATCH_PROPOSED)
            ├─ [approval gate] shouldRequireApproval(task, workerResult, config.approvalPolicy)
            │    └─ if required: appendEvent(HUMAN_APPROVAL_REQUESTED) → print instructions → exit
            │       (worktree preserved; run stays "paused"; user runs `agentledger resume`)
            ├─ verifyTask → VerificationResult
            │    ├─ checkFileBoundaries (minimatch)
            │    └─ runVerificationCommands (real exit codes)
            ├─ LedgerWriter.appendEvent(BOUNDARY_VIOLATION? | VERIFICATION_PASSED/FAILED)
            ├─ LedgerWriter.appendEvent(TASK_COMPLETED | TASK_FAILED)
            └─ cleanupWorktree (on success only)
       └─ LedgerWriter.appendEvent(RUN_COMPLETED | RUN_FAILED)

Approval resume path:
  agentledger approvals approve <runId>
    └─ appendEvent(HUMAN_APPROVAL_GRANTED, actor: "human")
  agentledger resume <runId>
    └─ resume.ts
         ├─ replayLedger → RunState (verifies run is "paused")
         ├─ load tasks.json for full task graph
         └─ for each task (topoSort order):
              ├─ completed/failed → skip
              ├─ awaiting_approval without GRANTED → print instructions, return
              ├─ awaiting_approval with GRANTED → reconstructWorkerResult → verifyTask → TASK_COMPLETED/FAILED
              └─ pending/assigned → full worker + verify flow
         └─ appendEvent(RUN_COMPLETED | RUN_FAILED)

Serve path: agentledger serve
  └─ serve.ts (CLI — owns signal handlers)
       └─ createServer({ ledgerDir, port }) → { port, close }
            ├─ FileWatcher(ledger.jsonl, onNewEvents)
            │    ├─ start() — reads existing lines into eventStore via onNewEvents
            │    └─ fs.watch → 100ms debounce → _readNewLines (line-count delta only)
            ├─ SSEManager(eventStore) — shared reference
            ├─ createApp({ ledgerDir, eventStore, sseManager })
            │    ├─ GET /api/runs          → replayLedger per unique runId
            │    ├─ GET /api/runs/:runId   → replayLedger(events, runId)
            │    ├─ GET /api/leaderboard   → buildLeaderboard(events)
            │    ├─ GET /api/events        → SSE; addClient on connect, removeClient on "close"
            │    └─ GET /api/events/stats  → { clientCount, eventCount }
            └─ listen(port || 0) → actual port via AddressInfo

MCP path: agentledger-mcp (stdio)
  └─ reads AGENTLEDGER_PROJECT_ROOT env → .agentledger/ledger.jsonl
       ├─ append_event   → LedgerWriter.appendEvent (hash-chained)
       ├─ get_task       → LedgerReader + replayLedger → AgentTask
       ├─ claim_task     → replayLedger (assert pending) + TASK_ASSIGNED event
       ├─ query_ledger   → LedgerReader.readAll + filter
       └─ get_run_summary → replayLedger → RunState
```

## Ledger Design Invariants

- **Single writer**: only the orchestrator (or MCP `append_event`) appends to `ledger.jsonl`
- **Hash chaining**: every event carries `hash = SHA256(previous_hash + payload)` — tamper-evident
- **Append-only**: events are never deleted or modified; `replayLedger` reconstructs state
- **Sequential execution (MVP)**: tasks run in dependency order; no parallel workers in v1

## Isolation Layers

1. **Prevention**: git worktree + `sparse-checkout` scopes each worker to `allowedFiles`
2. **Detection**: verifier diffs the worktree against `allowedFiles`/`blockedFiles` post-execution — independent of worker self-report

## MCP Server

- Transport: **stdio only** — no HTTP, no hosting
- Env: `AGENTLEDGER_PROJECT_ROOT` → locates `.agentledger/ledger.jsonl`
- Published as: `agentledger-mcp` on npm
- All tool I/O validated with Zod (reusing `@agentledger/core` schemas)
- No ledger logic duplicated — pure import from `@agentledger/core`
