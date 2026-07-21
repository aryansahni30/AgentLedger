<div align="center">

# AgentLedger

**The trust layer for AI coding agents.**

Claude says done. AgentLedger checks — against real exit codes, not self-reports.

[![npm version](https://img.shields.io/npm/v/agentledger-plugin.svg?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/agentledger-plugin)
[![license: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![node](https://img.shields.io/node/v/agentledger-plugin.svg?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Claude Code plugin](#use-in-claude-code) · [CLI](#use-from-the-cli) · [Configuration](#configuration)

</div>

---

## Why this exists

AI coding agents can touch any file in your repo. When one says "tests pass" or "fixed the bug," that's a claim about work it did — not a fact you've checked. Most tooling takes the claim at face value: the agent grades its own homework, and you find out it was wrong twenty turns later, after you've built on top of the lie.

AgentLedger doesn't trust the agent. It verifies completion claims against real process exit codes — when Claude says tests pass, AgentLedger runs the test command and reads the exit code. It blocks writes to protected paths before they reach disk. And it records every action — reads, edits, bash calls, blocked writes, verified and falsified claims — to an append-only, SHA-256 hash-chained ledger that breaks if anyone tampers with it.

It runs as a Claude Code plugin (the primary surface) and as a standalone CLI orchestrator. No hosting, no telemetry, no account. Everything stays on your machine.

## Quickstart

Install the plugin from inside Claude Code:

```text
/plugin marketplace add aryansahni30/AgentLedger
/plugin install agentledger@agentledger
```

That's it. Every Claude Code session in the project is now observed — the ledger is created on first run, claims are checked as they happen, and protected files are guarded before disk. On each session start you get a trust banner:

```text
┌────────────────────────────────────────────┐
│        AgentLedger - Session Start         │
│                                            │
│  Trust score     : 100% (8/8 claims true)  │
│  Lies caught     : 0                       │
│  Writes blocked  : 1 protected file saves  │
│  Chain integrity : ✓ valid (655 events)    │
│  Sessions        : 8 tracked               │
│  Dashboard       : http://localhost:4242   │
└────────────────────────────────────────────┘
```

## How it works

Every agent action flows through five hooks. Prevention happens before disk; detection and verification happen after.

```
  agent action
       │
       ▼
  ┌─────────────┐   Edit / Write to a protected path?
  │ PreToolUse  │──── yes ──▶ BLOCK before disk (exit code 2)
  └─────────────┘             file never written, denial recorded
       │ no
       ▼
  ┌─────────────┐
  │ PostToolUse │   record event to ledger, track read:edit ratio
  └─────────────┘
       │
       ▼
  ┌─────────────┐   assistant turn makes a completion claim?
  │    Stop     │──── yes ──▶ run real verification (test command)
  └─────────────┘             CLAIM_VERIFIED / CLAIM_FALSIFIED
       │
       ▼
  ┌─────────────┐   git diff boundary check + test command
  │ SessionEnd  │──▶ BOUNDARY_VIOLATION on out-of-scope writes
  └─────────────┘   session summary, trust score updated
       │
       ▼
  append-only, SHA-256 hash-chained ledger  (.agentledger/ledger.jsonl)
```

| Hook | What it does |
|------|-------------|
| **SessionStart** | Creates `.agentledger/`, prints the trust banner, starts the dashboard |
| **PreToolUse** | Blocks Edit/Write to `blockedFiles` before disk, warns on `warnFiles` |
| **PostToolUse** | Records each Edit/Write/Bash/Read to the ledger, tracks read:edit ratio |
| **Stop** | Scans the assistant turn for completion claims; runs real verification on a hit |
| **SessionEnd** | `git diff` boundary check, runs the test command, writes the session summary |

## Use in Claude Code

The plugin is the primary surface. Install it via the marketplace (above) and it wires all five hooks automatically — no `settings.json` editing, no per-project setup. On first run it creates `.agentledger/` with a default config, and from then on every session is observed and scored.

**What happens automatically**

- Completion claims ("tests pass", "fixed the bug", "done") are detected as the agent makes them and checked against the real test command.
- Writes to protected paths are rejected before they touch disk.
- Every action is hash-chained into the ledger; the chain is validated on each session start.
- A trust score — verified-true claims over total verified claims — is tracked across sessions.

**Skills** — invoke inside Claude Code:

| Skill | What it shows |
|-------|--------------|
| `/trust` | Trust score breakdown, recent false claims, accuracy trend |
| `/ledger` | Recent ledger events and run state for this project |
| `/verify` | Manually run the boundary check + test command mid-session |
| `/audit` | Trust score, risk assessment, and compliance audit report |
| `/handoff` | A handoff document to resume this work in a new session |

**Dashboard** — the SessionStart hook serves a local dashboard at `http://localhost:4242`: trust score over time, per-session claim accuracy, the event stream, and a cross-project view.

![AgentLedger dashboard](docs/dashboard.png)
<!-- placeholder — drop a real screenshot at docs/dashboard.png -->

## Use from the CLI

For power users, AgentLedger also ships an orchestrator that coordinates agents through the same ledger and verification gate — independent of Claude Code.

```bash
agentledger init
agentledger run "add pagination to the users endpoint"
agentledger ledger view
agentledger verify
agentledger replay
```

`run` compiles the request into a task graph, then executes tasks sequentially in dependency order. Each task runs inside its own **git worktree** scoped to its `allowedFiles`, so a worker physically cannot edit outside its lane. Before any patch merges, the **verifier** diffs the task branch against the declared boundaries and runs the configured test command — the worker's self-report is logged but never trusted. Everything lands in the same append-only, hash-chained ledger, and `replay` reconstructs run state from it.

## Configuration

AgentLedger auto-creates `.agentledger/config.json` on first run. All fields are optional and fall back to the defaults below.

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `blockedFiles` | `string[]` | `["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"]` | Glob patterns blocked before disk (PreToolUse) and flagged at session end |
| `warnFiles` | `string[]` | `["**/migrations/**", "**/auth/**", "package.json", "**/middleware.*"]` | Patterns that warn but don't block |
| `testCommand` | `string` | `"npm test"` | Command run to verify claims and at session end; its exit code is the source of truth |
| `testTimeout` | `number` | `30000` | Max milliseconds for the test command |
| `claimDetection` | `boolean` | `true` | Detect and verify completion claims on each turn |
| `dashboardPort` | `number` | `4242` | Port for the local dashboard |
| `operator` | `string` | `""` | Name recorded as the actor on ledger events |

Full example:

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

## What gets recorded

Every event is appended to `.agentledger/ledger.jsonl` with a rolling SHA-256 `hash` chained from the previous event's hash. Modifying, reordering, or deleting any event breaks the chain — validated on each session start and by `/audit`.

| Event | Meaning |
|-------|---------|
| `RUN_CREATED` | A new observed run started |
| `TOOL_CALLED` | An agent tool call was recorded |
| `TOOL_DENIED` | A tool call was blocked (audit-only for tools) |
| `CONTEXT_READ` | A file was read into context |
| `FILE_EDIT_PROPOSED` | An Edit/Write was proposed |
| `PATCH_PROPOSED` | A patch artifact was generated |
| `CLAIM_DETECTED` | The agent made a completion claim |
| `CLAIM_VERIFIED` | The claim checked out against real exit codes |
| `CLAIM_FALSIFIED` | The claim was false — the lie was caught |
| `CLAIM_UNVERIFIABLE` | No test command configured to check the claim |
| `VERIFICATION_STARTED` / `VERIFICATION_PASSED` / `VERIFICATION_FAILED` | A verification pass and its outcome |
| `BOUNDARY_VIOLATION` | A write landed outside the allowed file boundary |
| `RUN_COMPLETED` / `RUN_FAILED` | Terminal run state |

Full event union: [`packages/core/src/schemas/index.ts`](packages/core/src/schemas/index.ts).

## Enforcement model

AgentLedger uses two layers, and is deliberate about which is which.

| Layer | Surface | How |
|-------|---------|-----|
| **Prevention** | Edit / Write | Blocked **before disk** via PreToolUse (exit code 2). The file is never written; the denial is recorded. |
| **Detection** | Bash | Caught **after the fact**. A `bash echo secret >> .env` is not intercepted at runtime — it's found by the `git diff` boundary check at session end, which emits `BOUNDARY_VIOLATION`. |

Bash commands are not parsed at runtime, so a shell-originated write can hit disk before it's noticed. This is a design choice, not an oversight: Bash has too many legitimate uses to block globally, and parsing arbitrary shell to predict its file effects is unreliable. Prevention covers the structured path where interception is exact; detection is the safety net for the rest. Both are recorded either way.

## FAQ

**Why not just a pre-commit hook?** A pre-commit hook has no session context. It can't see that the agent claimed "tests pass" mid-session, can't verify that claim when it's made, and can't stop you building twenty turns on a false statement before the commit ever happens. It also leaves no tamper-evident trail of what the agent did between commits. AgentLedger verifies claims when they're made and records everything in a hash-chained ledger.

**Does this work with Cursor or Codex?** The MCP server exposes the ledger and verification tools to any MCP-capable client, so those work. The five hooks (real-time claim detection, pre-disk write blocking, session summaries) are Claude Code-specific — they rely on Claude Code's hook system.

**What does it cost?** Nothing. It runs entirely on your machine — no hosting, no account, no telemetry. The dashboard is a local server on port 4242.

**Does it slow down my sessions?** Verification only runs when a completion claim is actually detected, and repeated claims of the same type are debounced (60s) so tests don't re-run every turn. Recording events is a local append. There's no network round-trip.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
```

Monorepo layout (pnpm workspaces): `packages/core` (ledger, schemas, verifier, replay), `packages/cli`, `packages/plugin`, `packages/server` + `packages/visualizer` (dashboard), `packages/mcp-server`.

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run tests and propose changes, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

MIT. See [LICENSE](LICENSE).
