# AgentLedger Plugin

A Claude Code plugin that silently watches every session — recording file writes to a hash-chained ledger, blocking writes to protected files in real-time, detecting Bash-originated boundary violations at session end, and running your test suite to verify correctness.

## Install

```
/plugin marketplace add agentledger
```

No further configuration needed to get started.

## Hook Registration

The **SessionStart** hook should be registered in `~/.claude/settings.json` (global) rather than `.claude/settings.json` (project-level). Global hooks run after project hooks, so the AgentLedger summary always appears last in the terminal — after other plugin banners (claude-mem, etc.).

The remaining hooks (PreToolUse, PostToolUse, SessionEnd) stay in the project-level `.claude/settings.json` since they are per-project.

```jsonc
// ~/.claude/settings.json (global) — SessionStart only
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node /path/to/packages/plugin/scripts/hooks/session-start.js",
        "timeout": 15
      }]
    }]
  }
}

// .claude/settings.json (project) — everything else
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node /path/to/packages/plugin/scripts/hooks/pre-tool-use.js", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": "Edit|Write|Bash", "hooks": [{ "type": "command", "command": "node /path/to/packages/plugin/scripts/hooks/post-tool-use.js", "timeout": 10 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node /path/to/packages/plugin/scripts/hooks/session-end.js", "timeout": 120 }] }]
  }
}
```

## What Happens Automatically

| Event | What AgentLedger Does |
|-------|----------------------|
| Session starts | Prints ledger summary; starts dashboard; ensures `.agentledger/` exists |
| Edit or Write to blocked file | **Blocked pre-disk** — TOOL_DENIED written to ledger |
| Edit or Write to any file | TOOL_CALLED event recorded; run created if first write |
| Bash command | TOOL_CALLED event recorded (but not blocked pre-disk — see Enforcement Gap) |
| Session ends | `git diff` checked for violations; test command runs; VERIFICATION_PASSED or VERIFICATION_FAILED written |

## config.json Reference

AgentLedger writes `.agentledger/config.json` on first run with defaults:

```json
{
  "blockedFiles": ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
  "testCommand": "npm test",
  "operator": ""
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `blockedFiles` | See above | Glob patterns. Matched against relative file paths. Edit/Write to these paths are blocked pre-disk. |
| `testCommand` | `"npm test"` | Command run at session end. Non-zero exit → VERIFICATION_FAILED. |
| `operator` | `""` | Optional name/email logged in RUN_CREATED events. Falls back to `$USER`. |

## Slash Commands

| Command | What It Does |
|---------|-------------|
| `/agentledger-ledger` | Show all ledger events for this project, grouped by run |
| `/agentledger-verify` | Manually run the verification gate (git diff + tests) |
| `/agentledger-handoff` | Generate a Markdown handoff from the most recent run |
| `/agentledger-audit` | Full audit — chain integrity, violations, risk score |

## Enforcement Gap

**Edit and Write tool calls are blocked pre-disk** via the PreToolUse hook. If a file path matches a `blockedFiles` pattern, Claude Code never writes the file.

**Bash-originated writes are NOT blocked in real time.** A `bash echo "secret" >> .env` command cannot be intercepted pre-execution. Instead, AgentLedger runs `git diff --name-only HEAD` at session end and flags any blocked-pattern files that changed. This emits a `BOUNDARY_VIOLATION` event to the ledger.

This is an architectural constraint — Bash has too many valid use cases to block globally. The git diff check is the safety net, not the prevention layer.

## Dashboard

The AgentLedger dashboard runs at **http://localhost:4242** and is started automatically at session begin.

The dashboard shows:
- All runs across all sessions
- Event timeline per run
- Boundary violations and test results
- Chain integrity status

## Ledger Format

All events are stored in `.agentledger/ledger.jsonl` — one JSON object per line, append-only, with SHA-256 hash chaining (each event carries `hash` and `previous_hash`). The ledger is never modified or deleted by the plugin.

## Relationship to the CLI

The plugin and the `agentledger` CLI write to the **same ledger format**. A project can use both:

- CLI (`agentledger run "request"`) for orchestrated multi-agent runs
- Plugin for passive observation of manual Claude Code sessions

Both produce ledger events readable by `/agentledger-audit` and the dashboard. CLI runs are tagged `run_mode: "orchestrated"`, plugin runs are tagged `run_mode: "observed"`.

## Privacy

The plugin operates entirely locally. No data leaves your machine. The ledger file stays in `.agentledger/` inside your project. Add `.agentledger/` to `.gitignore` if you don't want session history committed.
