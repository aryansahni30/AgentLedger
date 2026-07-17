# AgentLedger

> **Claude says done. AgentLedger checks.**

A Claude Code plugin that catches false completion claims in real-time, blocks writes to protected files before they hit disk, and keeps a tamper-proof audit trail of everything your AI agent does.

```bash
npx agentledger-plugin install
```

That's it. One command. No config, no hosting, no cost. Works immediately in your next Claude Code session.

---

## What it catches

### 1. False claims — caught in real-time

Claude says "tests pass." AgentLedger runs `npm test`. Exit code 1.

```
⚠ CLAIM CHECK: Claude said "tests pass" → actual: npm test exit 1
```

This fires mid-session via the Stop hook — not at the end when you've already built 20 turns on a lie. Every claim is tracked and scored:

```
╔═══════════════════════════════════════╗
║       AgentLedger — Session End       ║
╚═══════════════════════════════════════╝
  Status     : ✓ PASSED
  Claims     : 3 made · 3 verified · 0 false
  Boundary   : ✓ clean
  Tests      : exit 0
  Read:Edit  : 2.1x (healthy)
  Trust Δ    : 81% → 83%  ↑
```

### 2. Protected file writes — blocked before disk

Claude tries to edit `.env`, a `.pem` file, or anything matching your `blockedFiles` patterns:

```
[AgentLedger] Write to ".env" blocked — matches protected pattern "**/.env"
```

The Edit/Write tool call is rejected with exit code 2. The file is never touched. The denial is recorded in the ledger.

### 3. Tamper-proof audit trail

Every action — every file read, edit, bash call, blocked write, verified claim, falsified claim — is appended to `.agentledger/ledger.jsonl` with SHA-256 hash chaining. Tamper with any event and the chain breaks.

---

## How it works

AgentLedger installs 5 hooks into Claude Code:

| Hook | When | What it does |
|------|------|-------------|
| **SessionStart** | Session opens | Creates `.agentledger/`, shows trust score banner |
| **PreToolUse** | Before Edit/Write | Blocks writes to `blockedFiles`, warns on `warnFiles` |
| **PostToolUse** | After Edit/Write/Bash/Read | Records events, tracks read:edit ratio |
| **Stop** | After each assistant turn | Scans for completion claims, runs verification |
| **SessionEnd** | Session closes | `git diff` boundary check, runs test command, updates trust score |

### Trust score

Trust score = verified true claims / total verified claims. Unverifiable claims (no test command configured) are excluded — AgentLedger doesn't inflate or deflate the number.

```
┌─────────────────────────────────────────────┐
│         AgentLedger - Session Start         │
│                                             │
│  Trust score     : 81% (38/47 claims true)  │
│  Lies caught     : 9                        │
│  Writes blocked  : 3                        │
│  Chain integrity : ✓ valid (142 events)     │
│  Sessions        : 14 tracked               │
└─────────────────────────────────────────────┘
```

### Claim detection

Keyword/regex matching on the assistant's output. Catches patterns like:
- "tests pass" / "all checks pass" / "build succeeds"
- "fixed the bug" / "resolved the issue"
- "done" / "implemented" / "working now"

Code blocks and inline code are stripped before matching to avoid false positives. Same claim type is debounced (60s) to avoid re-running tests on every turn.

---

## Enforcement gap (honest)

| Surface | How enforced |
|---------|-------------|
| **Edit/Write** | Blocked **before disk** via PreToolUse exit code 2 |
| **Bash** | **Not blocked in real-time.** `bash echo "secret" >> .env` cannot be intercepted. Caught by `git diff` at session end — emits `BOUNDARY_VIOLATION` |

This is an architectural constraint. Bash has too many valid use cases to block globally. The git diff check is the safety net, not the prevention layer.

---

## Configuration

AgentLedger auto-creates `.agentledger/config.json` on first run:

```json
{
  "blockedFiles": ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
  "warnFiles": ["**/migrations/**", "**/auth/**", "package.json", "**/middleware.*"],
  "testCommand": "npm test",
  "testTimeout": 30000,
  "claimDetection": true,
  "dashboardPort": 4242,
  "operator": ""
}
```

| Field | What it does |
|-------|-------------|
| `blockedFiles` | Glob patterns — Edit/Write to these are blocked pre-disk |
| `warnFiles` | Glob patterns — Edit/Write allowed but flagged on stderr |
| `testCommand` | Run at session end and on claim detection |
| `claimDetection` | Toggle real-time claim checking (default: on) |

---

## Skills

Available as slash commands in Claude Code after install:

| Command | What it does |
|---------|-------------|
| `/agentledger-trust` | Trust score breakdown, recent false claims, accuracy trend |
| `/agentledger-verify` | Manually trigger verification (tests + boundary check) |
| `/agentledger-audit` | Risk assessment from stats + ledger |
| `/agentledger-ledger` | View recorded events grouped by run |
| `/agentledger-handoff` | Generate handoff document for the next session |

---

## FAQ

**Why not a pre-commit hook?**
Pre-commit hooks run once at commit time. AgentLedger runs continuously — it catches false claims mid-session (Stop hook) and blocks file writes before they hit disk (PreToolUse). By the time you commit, the damage from 20 turns of building on a lie is already done.

**Does this work with Cursor / Codex / other agents?**
Currently Claude Code only — it uses Claude Code's hook system (PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd). The core ledger and verification logic is agent-agnostic and could be adapted to other tools.

**What does it cost?**
Free. Runs entirely locally. No hosting, no API calls, no telemetry, no data leaves your machine. The ledger stays in `.agentledger/` inside your project.

**How are "unverifiable" claims handled?**
If Claude says "fixed the bug" but there's no `testCommand` to verify against, the claim is logged as `CLAIM_UNVERIFIABLE` and excluded from the trust score. AgentLedger only counts what it can deterministically check.

**Can I see the raw audit trail?**
`cat .agentledger/ledger.jsonl` — one JSON object per line, human-readable, with hash and previous_hash fields. Or use `/agentledger-ledger` for a formatted view.

---

## Orchestrator mode (advanced)

AgentLedger also includes a CLI orchestrator for multi-agent task coordination — plan, isolate, execute, verify. This is the power-user surface for running structured agent workflows.

```bash
# Requires the monorepo (not the npm plugin)
pnpm install && pnpm -r build
cd packages/cli && npm link

# Initialize and run
agentledger init
export ANTHROPIC_API_KEY=sk-ant-...
agentledger run "Add input validation to the user registration endpoint"
```

The orchestrator provides:
- **Task graph planning** — LLM or rule-based planner decomposes requests into isolated tasks
- **Git worktree isolation** — each task runs in its own branch with sparse-checkout scoping
- **Two-layer boundary enforcement** — sparse-checkout (prevention) + verifier diff (detection)
- **Human approval gates** — governance policies can pause runs for human review
- **Replay** — reconstruct any run from its event log

Both modes (plugin observer + CLI orchestrator) write to the same ledger format. A project can use both.

### CLI commands

| Command | Description |
|---------|-------------|
| `agentledger init` | Initialize `.agentledger/` in current repo |
| `agentledger run "<request>"` | Plan and execute with LLM agents |
| `agentledger tasks view` | Show task graph and statuses |
| `agentledger verify` | Run verifier on current state |
| `agentledger replay` | Reconstruct run state, verify hash chain |
| `agentledger handoff` | Generate handoff document |
| `agentledger audit` | Compliance audit report with risk score |
| `agentledger serve` | Start API server with SSE event stream |
| `agentledger approvals list\|approve\|reject` | Manage human approval gates |

---

## Test coverage

578 tests across 38 test files, all passing.

```bash
# Run all tests
pnpm vitest run

# Type check all packages
pnpm -r typecheck
```

| Package | Tests |
|---------|-------|
| @agentledger/core | 493 |
| agentledger-plugin | 67 |
| @agentledger/server | 7 |
| @agentledger/cli | 6 |
| @agentledger/visualizer | 5 |

---

## Monorepo structure

```
packages/
  plugin/        agentledger-plugin — Claude Code observer/enforcer (npm: agentledger-plugin)
  core/          @agentledger/core — domain logic, ledger, verification, replay
  cli/           agentledger-cli — CLI orchestrator
  server/        @agentledger/server — Express API + SSE event stream
  visualizer/    @agentledger/visualizer — React dashboard (development)
  mcp-server/    agentledger-mcp-server — MCP server over stdio
  examples/      demo-repo with temptation scenario
```

---

## License

MIT
