# AgentLedger — Full Handoff Document
# Read this entire file before writing a single line of code.
# This is the source of truth for what exists and what to build next.

---

## What AgentLedger Is

AgentLedger is a trust and accountability layer for AI coding agents.

It has two product modes:

**Mode 1 — Orchestrator (CLI, already fully built)**
The user gives AgentLedger a goal. AgentLedger breaks it into tasks, runs
each task inside an isolated git worktree using a real LLM worker, records
everything to a cryptographic hash-chained ledger, verifies completion
independently of what the agent claimed, and only merges work that actually
passes. The user does not interact with the agent directly — AgentLedger
orchestrates it.

**Mode 2 — Observer/Enforcer (Claude Code Plugin, what we are building now)**
The user keeps using Claude Code exactly as they always have. AgentLedger
installs as a Claude Code plugin and silently watches every session:
recording what the agent does to a hash-chained ledger, blocking writes to
protected files in real-time, verifying tests at session end, printing a
compact context summary at session start, and auto-serving the live dashboard.
Zero workflow change required from the user.

The plugin is the primary adoption vector. The CLI demonstrates strong systems
engineering and is kept, but the plugin is what gets installed at scale.

---

## What Is Already Built — Do Not Rebuild Any Of This

### Monorepo: packages/

**packages/core/** — all business logic

- `src/ledger/` — append-only JSONL, SHA-256 hash chain, single writer,
  tamper detection. Key functions: appendEvent, readAll, readByRunId,
  verifyChain. Every event carries hash + previous_hash. One flipped byte
  breaks all subsequent hashes.

- `src/schemas/` — 40+ Zod schemas. Source of truth for all types. Key
  types: LedgerEvent, AgentTask, TaskGraph, WorkerResult, VerificationResult,
  HandoffDocument, HandoffBrief, AuditReport, PolicyDecision, PatchRisk.

- `src/planner/` — natural language → validated task graph. Mock planner
  (no API key needed) + LLM planner (Anthropic API, retryWithSchema for
  JSON extraction failures). Validates: cycle detection (DFS), overlapping
  file ownership, missing deps, duplicate IDs, topoSort.

- `src/worker/` — three real workers:
  - ClaudeCodeWorker: spawns claude CLI subprocess, --print mode, captures
    structured JSON output via --json-schema
  - runWorkerLLM: direct Anthropic API, tool_use loop with 4 tools
    (read/write/list/complete), boundary guard blocks writes pre-disk
  - runWorkerTogetherLLM: same as LLM but via Together AI
  Two test fixtures: BoundaryViolatingWorker (writes blocked file, lies
  about it), FalseSelfReportWorker (stays in bounds, lies tests passed).

- `src/git/` — worktree create/teardown, sparse-checkout scopes each
  worktree to allowedFiles, patch generation via git add -A --sparse +
  git diff --cached HEAD, getWorktreeDiff for governance scanning.

- `src/verifier/` — two independent layers, both ignore worker self-reports:
  1. checkBoundaries.ts — minimatch glob matching, blockedFiles priority
  2. runCommands.ts — runs test command, captures real exit code

- `src/replay/` — pure function replayLedger(events, runId) → RunState.
  Forward-only state machine. Reconstructs task statuses, run status, file
  inventory. Never re-executes agents.

- `src/governance/` — patchScanner (secrets, schema mutations, auth code,
  dep changes), policyEngine (deny/require_approval/warn/allow, reads
  governance.json), auditReport (risk score 0-100, per-category breakdown).

- `src/approvals/` — human-in-the-loop gate. shouldRequireApproval checks
  4 triggers. Run pauses, writes HUMAN_APPROVAL_REQUESTED, preserves
  worktree. agentledger resume <runId> continues after approval.

- `src/handoff/` — two outputs:
  - HandoffDocument: completed/pending/failed task summaries with actions
  - HandoffBrief: richer — typed failure classification, file inventory
    (merged vs in-worktree), unresolved risks, ready-to-paste agent prompt

- `src/context/` — buildPriorTaskContext reads task dependencies, finds
  their PATCH_PROPOSED summaries from ledger, injects into next worker's
  prompt to prevent duplicate work across tasks.

- `src/scheduler/` — TaskScheduler for parallel execution. getReadyTasks,
  markStarted/Completed/Failed. Async mutex on LedgerWriter (serial promise
  queue) for concurrent hash-chain safety under --concurrency N.

**packages/cli/** — 12 commands:
init, run, tasks view, verify, replay, handoff (--brief, --agent-prompt),
audit, leaderboard, assign, approvals (list/approve/reject), resume, serve.

Run options: --worker (claude-code|llm|together|mock), --mock-planner,
--task-file, --concurrency N, --model, --worker-model.

**packages/mcp-server/** — stdio MCP server, 5 tools:
append_event, get_task, claim_task, query_ledger, get_run_summary.
Distributed via npm as agentledger-mcp. No hosting cost — runs locally
on the user's machine.

**packages/server/** — Express + SSE. FileWatcher on ledger.jsonl with
in-flight guard to prevent duplicate broadcasts. SSEManager broadcasts to
all connected clients. New clients get full event replay on connect.
Routes: /api/runs, /api/runs/:runId, /api/leaderboard, /api/events (SSE),
/api/events/stats. Default port: 4242.

**packages/visualizer/** — dark-theme React + Vite dashboard. Live SSE
updates. Run list with status badges, per-run task cards, live event feed
(last 100 events), cross-run leaderboard.

**packages/examples/demo-repo/** — temptation repo (Redis caching scenario).
BoundaryViolatingWorker and FalseSelfReportWorker fixtures for demos.

**Numbers:** 511 passing tests, 40+ Zod schemas, 12 CLI commands, 5 MCP
tools, 3 real LLM workers, 2 enforcement layers.

---

## The Core Orchestrator Event Loop

```
RUN_CREATED
INTENT_COMPILED
  for each task (topo order, concurrent if --concurrency > 1):
    TASK_CREATED
    TASK_ASSIGNED
    WORKTREE_CREATED       ← isolated git branch
    TASK_STARTED
    [worker executes]      ← Claude Code or LLM
    PATCH_PROPOSED
    PATCH_RISK_DETECTED?   ← governance scan
    POLICY_EVALUATED
    HUMAN_APPROVAL_REQUESTED? ← if policy requires
    VERIFICATION_STARTED
    BOUNDARY_VIOLATION?    ← verifier diff
    TOOL_DENIED?           ← real-time block
    VERIFICATION_PASSED/FAILED
    TASK_COMPLETED/FAILED
RUN_COMPLETED/RUN_FAILED
```

Every event: hash-chained, immutable, replayable.

---

## What We Are Building Now: The Claude Code Plugin

### Reference: claude-mem

Study how claude-mem (github.com/thedotmack/claude-mem) works. It is a
Claude Code plugin that uses the same hook architecture we are building.
Key patterns to understand from it:
- Background worker service started at SessionStart, stays alive for session
- Hooks call the service via HTTP (we are NOT doing this — see design decision 1)
- SessionStart prints a compact context summary to the terminal
- A local web server URL is printed so the user can browse history
- Progressive disclosure: compact index first, fetch details on demand

We are taking the SessionStart summary + localhost link pattern from
claude-mem and combining it with AgentLedger's audit/ledger/enforcement
capabilities. This is the UX model — a familiar pattern users already know.

### What the plugin delivers

User installs once:
```
/plugin marketplace add agentledger
```

Every Claude Code session after that:

1. Terminal prints a compact summary at session start (like claude-mem)
2. Live dashboard auto-serves at localhost:4242
3. Every file write is recorded to hash-chained ledger.jsonl
4. Writes to blocked files are rejected before they hit disk (Edit/Write)
5. Bash-originated writes to blocked files caught at session end via git diff
6. Tests run at session end, real exit code recorded
7. Full audit trail available after every session

What the terminal output looks like at SessionStart:
```
AgentLedger · 2026-07-12 11:45am
────────────────────────────────────────────────
Last run: run_a3f9 · 4 tasks · yesterday 6:30pm
  Status  : COMPLETED ✓
  Modified: src/components/SignupForm.tsx
            src/utils/validation.ts
  Caught  : 1 BOUNDARY_VIOLATION (payments.ts blocked)
  Verify  : npm test → exit 0 ✓

Ledger: 47 events · 3 runs · Chain: ✓ intact
Dashboard → http://localhost:4242
────────────────────────────────────────────────
Type /handoff to load full context · /audit for risk report
```

If no prior runs exist:
```
AgentLedger · 2026-07-12 11:45am
────────────────────────────────────────────────
No prior runs in this repo. Ledger will open on
your first file edit this session.
Dashboard → http://localhost:4242
────────────────────────────────────────────────
```

Slash commands available in every session:
- /ledger  — print current session's events from ledger.jsonl
- /verify  — manually trigger verification (boundary check + test command)
- /handoff — generate HandoffBrief (calls existing src/handoff/ module)
- /audit   — risk score + policy violations (calls existing src/governance/)

---

## New Package: packages/plugin/

```
packages/plugin/
  package.json
  hooks/
    hooks.json             ← defines all hook matchers
  scripts/
    hooks/
      session-start.js     ← print summary + auto-start server + config init
      pre-tool-use.js      ← boundary check → block/allow
      post-tool-use.js     ← lazy run init + record event to ledger
      session-end.js       ← verify + finalize run + clear state
    state.js               ← file-based session state with locking
    server-manager.js      ← check/start packages/server in background
    summary.js             ← build the terminal summary from ledger data
  skills/
    ledger.md
    verify.md
    handoff.md
    audit.md
  PLUGIN_README.md
```

---

## Critical Design Decisions — Follow These Exactly

### Decision 1: Stateless hooks, no background HTTP service

Do NOT build a background HTTP server in the plugin (no Express, no
localhost service, no port management in the plugin itself).

State lives in .agentledger/session.json:
```json
{
  "runId": "run_abc123",
  "previousHash": "sha256...",
  "dirty": false,
  "sessionStart": "2026-07-12T11:45:00Z"
}
```

Use proper-lockfile for all reads/writes to session.json to prevent hash
corruption under concurrent hook calls.

The packages/server/ that already exists IS the dashboard server. The plugin
starts it as a detached subprocess — it does not own or re-implement it.

Node spawn overhead per hook (~50-100ms) is imperceptible next to Claude
generating a response. A background service is complexity you do not need.

### Decision 2: SessionEnd for verification, not Stop

Stop fires after every single Claude response — every turn. Running
`npm test` after every response would make the plugin completely unusable.

SessionEnd fires when the user exits the session. That is when verification
runs. Not Stop. Never Stop.

The only thing Stop can optionally do is flush any pending ledger event
that PostToolUse has not yet written — and only if PostToolUse has a
known-async timing issue that actually manifests. Default: Stop does nothing.

### Decision 3: Lazy run creation

SessionStart does NOT open a run or write RUN_CREATED to the ledger.

A run opens on the FIRST PostToolUse event where the tool is Edit or Write
(a file was actually modified). At that point:
1. Generate a new runId
2. Write RUN_CREATED with run_mode: "observed"
3. Write INTENT_COMPILED with goal: "Claude Code session [timestamp]"
4. Set runId + dirty:true in session.json
5. Then write the TOOL_CALLED event for the trigger edit

Sessions where Claude only reads files, answers questions, or runs read-only
tools never create a run. The ledger stays clean.

### Decision 4: Boundary enforcement — two layers, documented honestly

**Layer 1 — Prevention (PreToolUse, Edit and Write tools ONLY):**
- Parse file_path from tool input JSON (passed via env by Claude Code)
- Glob-match against blockedFiles from .agentledger/config.json using
  minimatch — import it from @agentledger/core, do not re-implement
- If match: return {"decision": "block", "reason": "AgentLedger: [file] is in blockedFiles"}
- If no match: return {"decision": "allow"}
- This deterministically prevents Edit and Write tool calls to blocked files

**Layer 2 — Detection (SessionEnd, git diff):**
- Bash tool can modify blocked files (sed -i, mv, echo >>, git checkout)
  without a parseable file_path param
- Do NOT attempt to parse bash commands — it is whack-a-mole and lossy
- SessionEnd runs: git diff --name-only HEAD against blockedFiles patterns
- If any blocked file appears in the diff: emit BOUNDARY_VIOLATION event
- Document this gap clearly in PLUGIN_README.md:
  "Edit/Write tool calls to blocked files are prevented before they reach
  disk. Bash commands are not parsed at runtime; any blocked file modified
  via Bash is detected by git diff at session end and flagged as a
  BOUNDARY_VIOLATION in the ledger."

### Decision 5: run_mode field on RUN_CREATED (schema change needed first)

Before writing any plugin code, add run_mode to the RUN_CREATED event
payload schema in packages/core/src/schemas/.

```typescript
// In the RUN_CREATED payload schema:
run_mode: z.enum(["orchestrated", "observed"])
```

Plugin runs emit "observed". CLI runs emit "orchestrated". This lets
replay, audit, leaderboard, and the visualizer distinguish between the
two modes. Add this to the existing schema — it is additive, not breaking,
since it will be optional with a default of "orchestrated" for backwards
compatibility with existing ledger.jsonl files.

### Decision 6: server-manager.js — auto-start the existing packages/server/

The dashboard at localhost:4242 is packages/server/ which is already built.
The plugin's job is to ensure it starts when a session opens.

server-manager.js logic:
```javascript
async function ensureServerRunning() {
  // 1. Check if already running
  try {
    const res = await fetch('http://localhost:4242/api/runs');
    if (res.ok) return; // already up, nothing to do
  } catch {
    // not running, start it
  }

  // 2. Find the agentledger binary
  const { execSync } = require('child_process');
  
  // 3. Start packages/server as detached subprocess
  const child = require('child_process').spawn(
    'node',
    [require.resolve('@agentledger/server/dist/index.js')],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: '4242',
        AGENTLEDGER_PROJECT_ROOT: process.env.CLAUDE_PROJECT_DIR || process.cwd()
      }
    }
  );
  child.unref(); // detach — outlives the hook script

  // 4. Wait briefly for it to be ready (max 2s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch('http://localhost:4242/api/runs');
      if (res.ok) return;
    } catch {}
  }
  // If it doesn't start within 2s, continue anyway — not fatal
}
```

### Decision 7: summary.js — build the terminal context summary

summary.js calls existing @agentledger/core functions. Import, do not
reimplement.

```javascript
const { readByRunId, verifyChain } = require('@agentledger/core/ledger');
const { replayLedger } = require('@agentledger/core/replay');

async function buildSessionSummary(projectRoot) {
  const ledgerPath = path.join(projectRoot, '.agentledger', 'ledger.jsonl');
  
  if (!fs.existsSync(ledgerPath)) {
    return null; // no prior history
  }

  const allEvents = await readAll(ledgerPath);
  if (allEvents.length === 0) return null;

  // Get all unique runIds, find most recent
  const runIds = [...new Set(allEvents.map(e => e.run_id))];
  const lastRunId = runIds[runIds.length - 1];
  const lastRunEvents = allEvents.filter(e => e.run_id === lastRunId);
  const runState = replayLedger(lastRunEvents, lastRunId);
  const chainOk = await verifyChain(ledgerPath);

  // Count violations in last run
  const violations = lastRunEvents.filter(
    e => e.event_type === 'BOUNDARY_VIOLATION' || e.event_type === 'TOOL_DENIED'
  );

  // Get modified files from last run
  const modifiedFiles = [...new Set(
    lastRunEvents
      .filter(e => e.event_type === 'PATCH_PROPOSED')
      .flatMap(e => e.payload.files_modified || [])
  )];

  // Verification result from last run
  const verifyEvent = lastRunEvents.find(
    e => e.event_type === 'VERIFICATION_PASSED' || e.event_type === 'VERIFICATION_FAILED'
  );

  return {
    lastRunId,
    lastRunStatus: runState.status,
    lastRunTimestamp: lastRunEvents[0]?.timestamp,
    taskCount: runState.tasks?.length || 0,
    modifiedFiles,
    violations: violations.length,
    verifyStatus: verifyEvent?.event_type || 'unknown',
    totalEvents: allEvents.length,
    totalRuns: runIds.length,
    chainOk
  };
}
```

Format and print in session-start.js:
```javascript
function formatSummary(summary) {
  const divider = '─'.repeat(50);
  const ts = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });

  if (!summary) {
    return [
      `\nAgentLedger · ${ts}`,
      divider,
      'No prior runs in this repo. Ledger will open on',
      'your first file edit this session.',
      `Dashboard → http://localhost:4242`,
      divider,
    ].join('\n');
  }

  const statusIcon = summary.lastRunStatus === 'completed' ? '✓' : '✗';
  const chainIcon = summary.chainOk ? '✓ intact' : '✗ BROKEN';
  const verifyIcon = summary.verifyStatus === 'VERIFICATION_PASSED' ? '✓' : '✗';

  const lines = [
    `\nAgentLedger · ${ts}`,
    divider,
    `Last run: ${summary.lastRunId} · ${summary.taskCount} tasks`,
    `  Status  : ${summary.lastRunStatus.toUpperCase()} ${statusIcon}`,
  ];

  if (summary.modifiedFiles.length > 0) {
    lines.push(`  Modified: ${summary.modifiedFiles[0]}`);
    summary.modifiedFiles.slice(1).forEach(f => lines.push(`            ${f}`));
  }

  if (summary.violations > 0) {
    lines.push(`  Caught  : ${summary.violations} violation(s) detected`);
  }

  if (summary.verifyStatus !== 'unknown') {
    lines.push(`  Verify  : ${verifyIcon}`);
  }

  lines.push('');
  lines.push(
    `Ledger: ${summary.totalEvents} events · ` +
    `${summary.totalRuns} run(s) · ` +
    `Chain: ${chainIcon}`
  );
  lines.push(`Dashboard → http://localhost:4242`);
  lines.push(divider);
  lines.push('Type /handoff to load full context · /audit for risk report');

  return lines.join('\n');
}
```

---

## Implementation Phases — In This Order, No Skipping

### Phase 1: Schema update

In packages/core/src/schemas/, add run_mode to RUN_CREATED payload:
```typescript
run_mode: z.enum(["orchestrated", "observed"]).default("orchestrated")
```

Update CLI's run.ts to pass run_mode: "orchestrated" explicitly when it
emits RUN_CREATED. Run all 511 tests. Fix anything that breaks.
This phase is done when: pnpm vitest run passes, pnpm tsc --noEmit passes.

### Phase 2: Package scaffold

Create packages/plugin/ with:
- package.json (name: "agentledger-plugin", deps: @agentledger/core,
  @agentledger/server, proper-lockfile, minimatch)
- tsconfig.json extending root
- hooks/ and scripts/ directories (empty files for now)
- Add to pnpm-workspace.yaml

This phase is done when: pnpm install succeeds, workspace recognizes the
new package.

### Phase 3: state.js + server-manager.js + summary.js

Build the three utility modules in scripts/:

state.js: readSessionState(), writeSessionState(update), clearSessionState()
- All backed by .agentledger/session.json in CLAUDE_PROJECT_DIR
- All reads/writes wrapped with proper-lockfile
- Handle missing file gracefully (return null on read if not exists)

server-manager.js: ensureServerRunning() as described in Decision 6.

summary.js: buildSessionSummary(projectRoot) + formatSummary(summary)
as described in Decision 7. Import from @agentledger/core only.

This phase is done when: unit tests for all three pass. Test state.js
concurrent write safety specifically — two simultaneous writeSessionState
calls must not corrupt previousHash.

### Phase 4: session-start.js

Runs at: every Claude Code session start.

Steps in order:
1. Determine projectRoot from CLAUDE_PROJECT_DIR env var
2. Ensure .agentledger/ directory exists, create if missing
3. Ensure .agentledger/config.json exists, create with defaults if missing:
   ```json
   {
     "blockedFiles": ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
     "testCommand": "npm test",
     "operator": ""
   }
   ```
   If package.json does not exist in projectRoot, set testCommand to ""
   (empty string = skip test verification at session end).
4. Call ensureServerRunning() from server-manager.js
5. Call buildSessionSummary(projectRoot) from summary.js
6. Print formatSummary(result) to stdout
7. Clear any stale session.json from a previous crashed session

Do NOT write RUN_CREATED here. Do NOT initialize a run here.

This phase is done when: starting Claude Code in a fresh repo with no
.agentledger/ creates the directory and config, prints the "No prior runs"
summary, and shows the dashboard URL.

### Phase 5: post-tool-use.js

Runs at: after every Edit, Write, or Bash tool call.

Steps:
1. Read tool name and file_path (or command for Bash) from hook env
2. If tool is NOT Edit or Write: record a TOOL_CALLED event but do NOT
   set dirty or init a run (Bash alone does not trigger run creation)
3. If tool IS Edit or Write:
   a. Read session state
   b. If no runId in session state (no run open yet): lazy-init run
      - Generate runId = "run_" + nanoid(8)
      - Write RUN_CREATED event (run_mode: "observed") to ledger
      - Write INTENT_COMPILED event (goal: "Claude Code session " + timestamp)
      - Update session.json with runId + previousHash
   c. Write TOOL_CALLED event with tool name, file path, timestamp
   d. Set dirty: true in session.json

Use appendEvent from @agentledger/core/ledger. Never reimplement hash chain.

This phase is done when: running a Claude Code session that edits a file
produces a ledger.jsonl with RUN_CREATED → INTENT_COMPILED → TOOL_CALLED,
all hash-chained with correct previous_hash linkage. Verify with
agentledger replay.

### Phase 6: pre-tool-use.js

Runs at: before every Edit or Write tool call (not Bash — see Decision 4).

Steps:
1. Read file_path from tool input JSON (hook env provides this)
2. Read blockedFiles array from .agentledger/config.json
3. For each pattern in blockedFiles: test file_path with minimatch
4. If any pattern matches:
   - Append TOOL_DENIED event to ledger if a run is open
   - Return: {"decision": "block", "reason": "AgentLedger: [file_path] matches blocked pattern [pattern]"}
5. If no match: return {"decision": "allow"} or simply exit 0 (same effect)

Import minimatch from @agentledger/core — it already uses it in
checkBoundaries.ts. Do not add a new dependency.

This phase is done when: adding "src/lib/payments.ts" to blockedFiles and
asking Claude to edit that file produces a Claude Code refusal with the
AgentLedger reason string visible to the user.

### Phase 7: session-end.js

Runs at: session exit (SessionEnd hook, not Stop).

Steps:
1. Read session state
2. If dirty is false: exit immediately (clean session, nothing to verify)
3. Read .agentledger/config.json for blockedFiles and testCommand
4. Run git diff --name-only HEAD to get all files changed this session
5. Check changed files against blockedFiles patterns (minimatch)
6. If any blocked files appear in the diff:
   - For each: append BOUNDARY_VIOLATION event to ledger with
     violation_type: "BLOCKED_FILE_MODIFIED" and the file path
7. If testCommand is not empty:
   - Run testCommand, capture stdout + stderr + exit code
   - If exit code === 0: append VERIFICATION_PASSED event
   - If exit code !== 0: append VERIFICATION_FAILED event with real output
8. Append RUN_COMPLETED (if no failures) or RUN_FAILED (if any failures)
9. Print one-line summary to stdout:
   "AgentLedger: [N] events · Verify: PASSED/FAILED · Run: [runId]"
10. Call clearSessionState()

Use verifyChain from @agentledger/core/ledger to confirm chain integrity
before appending the final event. If chain is broken (tamper detected),
append a special CHAIN_INTEGRITY_FAILURE event and print a warning.

This phase is done when: making a file change, ending a session, and
confirming that .agentledger/ledger.jsonl contains the verification event
with real exit code (not a self-report), and the final summary line prints
to the terminal.

### Phase 8: Skills (slash commands)

Skills are markdown files that tell Claude how to use AgentLedger commands.
They are NOT scripts. They describe what to do when the user types /command.

skills/ledger.md:
```markdown
When the user types /ledger, run: agentledger ledger view
in the current project directory and display the output.
Show the most recent 20 events if the full output is long.
```

skills/verify.md:
```markdown
When the user types /verify, run: agentledger verify
in the current project directory and display the full output.
```

skills/handoff.md:
```markdown
When the user types /handoff, run: agentledger handoff --brief --agent-prompt
in the current project directory. Display the full HandoffBrief output.
This gives the current context and a ready-to-paste agent prompt for
resuming this run in a new session.
```

skills/audit.md:
```markdown
When the user types /audit, run: agentledger audit
in the current project directory and display the full output including
risk score, per-category breakdown, and any policy violations.
```

### Phase 9: hooks.json

Define all hook matchers:

```json
{
  "hooks": [
    {
      "type": "SessionStart",
      "command": "node scripts/hooks/session-start.js"
    },
    {
      "type": "PreToolUse",
      "matcher": "Edit|Write",
      "command": "node scripts/hooks/pre-tool-use.js"
    },
    {
      "type": "PostToolUse",
      "matcher": "Edit|Write|Bash",
      "command": "node scripts/hooks/post-tool-use.js"
    },
    {
      "type": "SessionEnd",
      "command": "node scripts/hooks/session-end.js"
    }
  ]
}
```

PreToolUse matcher is Edit|Write only — NOT Bash (see Decision 4).
PostToolUse matcher includes Bash for recording purposes, but Bash
alone does not trigger run creation (see Phase 5 logic).

### Phase 10: PLUGIN_README.md + publish prep

Write PLUGIN_README.md covering:
1. Install command: /plugin marketplace add agentledger
2. What happens automatically (no config needed to start)
3. config.json reference: blockedFiles patterns, testCommand, operator
4. The four slash commands
5. Enforcement gap: "Edit/Write prevented pre-disk. Bash detected
   post-session via git diff." — document honestly, not as a footnote
6. How to view the full dashboard (localhost:4242)
7. Relationship to the CLI (same ledger format, compatible)

Add to packages/plugin/package.json:
```json
{
  "name": "agentledger-plugin",
  "version": "1.0.0",
  "description": "Claude Code plugin for AgentLedger — audit trail, boundary enforcement, and verification for every session",
  "main": "scripts/hooks/session-start.js"
}
```

---

## Tests Required

**state.js**
- readSessionState returns null when session.json missing
- writeSessionState creates session.json if missing
- Concurrent writes (Promise.all of 5 writes) produce valid JSON, no corruption

**server-manager.js**
- ensureServerRunning returns early if server already responding
- ensureServerRunning spawns detached process if server not running
- Does not throw if server fails to start within timeout

**summary.js**
- buildSessionSummary returns null when ledger.jsonl missing
- buildSessionSummary correctly extracts last run's status, files, violations
- formatSummary includes "No prior runs" text when summary is null
- formatSummary includes dashboard URL in all cases
- formatSummary includes chain status indicator

**session-start.js (integration)**
- Creates .agentledger/ if missing
- Creates config.json with correct defaults if missing
- Does not overwrite existing config.json
- Prints summary to stdout (capture and assert)

**post-tool-use.js**
- First Edit in a session creates RUN_CREATED + INTENT_COMPILED + TOOL_CALLED
- Second Edit in same session appends only TOOL_CALLED (no duplicate run init)
- Bash tool call does not trigger run creation
- hash chain is valid across multiple sequential PostToolUse calls

**pre-tool-use.js**
- Returns block decision for file matching blockedFiles glob
- Returns allow for file not matching any blockedFiles pattern
- Handles empty blockedFiles array (allow everything)
- TOOL_DENIED event written to ledger when block fires

**session-end.js**
- Exits immediately (no-op) when dirty is false
- Detects blocked file modified via git diff, emits BOUNDARY_VIOLATION
- Runs testCommand, writes VERIFICATION_PASSED on exit 0
- Runs testCommand, writes VERIFICATION_FAILED with stdout/stderr on exit 1
- Clears session state after completing

Do not use supertest. Use Node's built-in http module for any integration
tests that need a running HTTP server.

---

## Config File Reference

.agentledger/config.json (auto-created by session-start.js if missing):
```json
{
  "blockedFiles": [
    "**/.env",
    "**/secrets.*",
    "**/*.pem",
    "**/*.key"
  ],
  "testCommand": "npm test",
  "operator": ""
}
```

User can add any minimatch-compatible glob to blockedFiles.
Set testCommand to "" to skip test verification at session end.
operator is the user identifier recorded in ledger events (optional).

---

## After the Plugin Ships — Next Steps In Order

Do not build any of these during plugin work. Finish and test the plugin
completely before moving to the next phase.

**1. Proof artifacts (immediately after plugin ships)**
Record two terminal GIFs using vhs or asciinema:
- GIF 1: boundary violation caught in real-time (Edit blocked) + false
  self-report caught (test exit code mismatch). "It caught a lie."
- GIF 2: normal Claude Code session, /audit at end showing hash-chained
  trail. "You didn't change your workflow."

Rewrite the repo README: two-mode positioning (observe vs orchestrate),
both GIFs at the top, FAQ section ("why not a pre-commit hook / why not
Temporal / why not worktrees"), real terminal output, install command
for the plugin as the hero action.

**2. Public launch**
npm publish: agentledger (CLI), agentledger-mcp, agentledger-plugin.
GitHub repo public. Show HN post — lead with the plugin, not the CLI.

**3. Codebase inspection step for CLI (known gap, do not address now)**
The CLI planner creates tasks without reading the existing codebase first.
On real repos with existing features, it may duplicate or overwrite work.
Fix: mandatory read-only inspection task at the start of every run.
Address after launch, based on real user reports.

---

## What NOT To Build

- No background HTTP service in the plugin (stateless hooks only)
- No Stop hook verification (SessionEnd only — see Decision 2)
- No eager run creation on SessionStart (lazy only — see Decision 3)
- No bash command parsing for boundary enforcement (detection layer only)
- No cross-repo ledger
- No agent-to-agent messaging (contradicts core thesis)
- No hosted cloud version
- No conflict auto-resolution
- No TypeScript AST parsing yet
- No ML intent-drift detection yet
- Do not touch packages/visualizer/, packages/server/, packages/mcp-server/,
  or packages/cli/ during plugin work unless adding the run_mode schema
  field in Phase 1

---

## Invariants — Never Violate These

1. Ledger is single writer. Hook scripts call appendEvent from
   @agentledger/core. Never open two concurrent writers to ledger.jsonl.

2. hash and previous_hash are required on every LedgerEvent. Never make
   them optional in any schema or event construction.

3. Verification uses real exit codes. Never trust any agent or worker
   self-report for pass/fail. If the test command runs, use its exit code.

4. Agents communicate through the ledger only. No direct messaging between
   agents or hooks.

5. Do not duplicate core logic in plugin scripts. Import and call existing
   functions from @agentledger/core. If something you need isn't exported,
   export it from core — do not copy-paste it.

6. Every hook script must handle missing .agentledger/ gracefully. The
   plugin may run in repos that have never been initialized. Never crash.

---

## Before You Start: Required Checks

1. Run: pnpm vitest run — confirm all 511 tests pass
2. Run: pnpm tsc --noEmit — confirm clean typecheck
3. Read: .brain/progress.md — confirm current phase status
4. Read: .brain/schemas.md — know current schema shapes before editing
5. Confirm you understand Decision 2 (SessionEnd not Stop) and Decision 3
   (lazy run creation) before writing a single hook. If anything is unclear,
   re-read those sections. Getting these wrong wastes the most time.

Update .brain/architecture.md, .brain/schemas.md, and .brain/progress.md
at the end of each phase. Not at the end of the full build. Each phase.
