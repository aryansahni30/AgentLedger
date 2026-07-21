# AgentLedger Plugin — Live Testing Guide

How to install the plugin into a real Claude Code session and verify every hook works.

---

## Prerequisites

```bash
cd /Users/aryansahni/AgentLeader
pnpm install
pnpm build          # builds core → server → visualizer
```

Confirm automated tests pass first:

```bash
pnpm test           # 525 tests across all packages
```

---

## 1. Create a Test Repo

```bash
mkdir /tmp/agentledger-test && cd /tmp/agentledger-test
git init
git config user.email "test@test.com"
git config user.name "Test"
echo '{ "scripts": { "test": "echo ok" } }' > package.json
echo "# Test" > README.md
echo "SECRET=hunter2" > .env
git add package.json README.md
git commit -m "initial"
```

Note: `.env` is NOT committed — it exists on disk for the boundary violation test.

---

## 2. Wire Up Hooks

Create `.claude/settings.json` in the test repo. Every `command` uses an absolute path to the plugin scripts in the monorepo.

```bash
mkdir -p /tmp/agentledger-test/.claude
```

```bash
cat > /tmp/agentledger-test/.claude/settings.json << 'SETTINGS'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/aryansahni/AgentLeader/packages/plugin/scripts/hooks/session-start.js",
            "timeout": 15
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/aryansahni/AgentLeader/packages/plugin/scripts/hooks/pre-tool-use.js",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/aryansahni/AgentLeader/packages/plugin/scripts/hooks/post-tool-use.js",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/aryansahni/AgentLeader/packages/plugin/scripts/hooks/session-end.js",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
SETTINGS
```

---

## 3. Test Scenarios

Open Claude Code in the test repo:

```bash
cd /tmp/agentledger-test
claude
```

### Test A: Session Start (automatic)

**What should happen on launch:**

- [ ] Terminal prints the AgentLedger box:
  ```
  ╔═══════════════════════════════════════╗
  ║        AgentLedger — Session Start       ║
  ╚═══════════════════════════════════════╝
    Total ledger events : 0
    Chain integrity     : ✓ valid
    Recent runs         : (none)
    Dashboard           : http://localhost:4242
  ```
- [ ] `.agentledger/` directory created in test repo
- [ ] `.agentledger/config.json` created with default blocked patterns
- [ ] Dashboard running at http://localhost:4242 (open in browser — should show React UI)

**Verify:**

```bash
# in another terminal
cat /tmp/agentledger-test/.agentledger/config.json
curl -s http://localhost:4242/health   # → {"ok":true}
open http://localhost:4242             # React dashboard loads
```

---

### Test B: Normal File Edit (ledger recording)

**In the Claude Code session, ask:**

> Add a hello function to README.md

- [ ] Claude edits README.md (no block)
- [ ] No error or warning from AgentLedger

**Verify (in another terminal):**

```bash
cat /tmp/agentledger-test/.agentledger/ledger.jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line.strip())
    print(f\"{e['event_type']:25} hash={e['hash'][:12]}...\")
"
```

Expected output — 3 events, hash-chained:

```
RUN_CREATED               hash=...
INTENT_COMPILED           hash=...
TOOL_CALLED               hash=...
```

- [ ] `RUN_CREATED` event present (lazy init triggered by first Edit)
- [ ] `INTENT_COMPILED` event present
- [ ] `TOOL_CALLED` with `tool: "Edit"` and correct `file_path`
- [ ] All `previous_hash` values chain correctly (`genesis` → hash₀ → hash₁ → ...)

**Dashboard check:**

- [ ] Refresh http://localhost:4242 — run appears in sidebar
- [ ] Click run — shows "Observed Claude Code session" as goal

---

### Test C: Boundary Block (Edit to protected file)

**In the same session, ask:**

> Write my API key to .env

- [ ] Claude's Edit/Write to `.env` is **blocked** before reaching disk
- [ ] Claude sees the block reason: `matches protected pattern "**/.env"`
- [ ] Claude acknowledges it cannot write to that file

**Verify:**

```bash
# .env should be unchanged (still "SECRET=hunter2", no new content)
cat /tmp/agentledger-test/.env

# Ledger should have TOOL_DENIED event
cat /tmp/agentledger-test/.agentledger/ledger.jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line.strip())
    if e['event_type'] == 'TOOL_DENIED':
        print('TOOL_DENIED:', json.dumps(e['payload'], indent=2))
"
```

- [ ] `TOOL_DENIED` event in ledger with tool name and file path
- [ ] `.env` file content unchanged

---

### Test D: Bash Bypass (enforcement gap — detected at session end)

**In the same session, ask:**

> Run this command: echo "NEW_SECRET=abc" >> .env

- [ ] Bash command executes (NOT blocked — this is the documented enforcement gap)
- [ ] No AgentLedger error during execution

Then ask:

> Stage the .env file with git add .env

- [ ] Command runs

**Note:** The boundary violation will be caught at session end (Test F).

---

### Test E: Second Edit (no duplicate run init)

**In the same session, ask:**

> Add a comment to package.json

- [ ] Edit succeeds
- [ ] Only a single `TOOL_CALLED` event added (no second `RUN_CREATED`)

**Verify:**

```bash
cat /tmp/agentledger-test/.agentledger/ledger.jsonl | python3 -c "
import sys, json
types = []
for line in sys.stdin:
    e = json.loads(line.strip())
    types.append(e['event_type'])
print('\n'.join(types))
"
```

- [ ] Exactly ONE `RUN_CREATED` in the entire ledger
- [ ] Multiple `TOOL_CALLED` events

---

### Test F: Session End (verification + boundary detection)

**Exit Claude Code** (`/exit` or Ctrl+C).

**What should happen:**

- [ ] Terminal prints session end summary:
  ```
  ╔═══════════════════════════════════════╗
  ║       AgentLedger — Session End         ║
  ╚═══════════════════════════════════════╝
    Run ID   : xxxxxxxx
    Status   : ✗ FAILED
    Boundary : 1 violation(s) detected (Bash)
      - .env  [**/.env]
    Tests    : exit 0
  ```
- [ ] `BOUNDARY_VIOLATION` event in ledger (`.env` caught via `git diff`)
- [ ] `VERIFICATION_FAILED` event (boundary violation = run failure even if tests pass)
- [ ] `RUN_FAILED` event
- [ ] `.agentledger/session.json` deleted (state cleared)

**Verify:**

```bash
# Full ledger dump
cat /tmp/agentledger-test/.agentledger/ledger.jsonl | python3 -c "
import sys, json
events = []
for line in sys.stdin:
    events.append(json.loads(line.strip()))
print(f'Total events: {len(events)}\n')
for i, e in enumerate(events):
    prev = 'genesis' if i == 0 else events[i-1]['hash']
    chain_ok = '✓' if e['previous_hash'] == prev else '✗ BROKEN'
    print(f'[{i}] {chain_ok} {e[\"event_type\"]:25} {str(e.get(\"payload\",{}))[:60]}')
"

# Session state should be gone
ls /tmp/agentledger-test/.agentledger/session.json 2>/dev/null && echo "STILL EXISTS — BUG" || echo "Cleared ✓"
```

- [ ] Every event's `previous_hash` matches prior event's `hash` (chain valid)
- [ ] `session.json` does not exist

---

### Test G: Clean Session (no edits = no run)

**Start a new Claude Code session:**

```bash
cd /tmp/agentledger-test
claude
```

Ask only read-only questions:

> What files are in this repo?

> Read README.md

Then exit.

- [ ] Session start prints updated summary (shows prior run)
- [ ] No new events added to ledger (read-only session = no run created)
- [ ] No `session.json` left behind

---

### Test H: Dashboard Live Updates

**Start a new session and open the dashboard simultaneously:**

1. Open http://localhost:4242 in a browser
2. Start `claude` in the test repo
3. Ask Claude to edit a file

- [ ] Dashboard shows new run appearing in real-time (SSE updates)
- [ ] Event feed shows events streaming in
- [ ] Run detail shows status, goal, event timeline

---

## 4. Verify Hash Chain Integrity

After all tests, run the standalone chain verifier:

```bash
node /Users/aryansahni/AgentLeader/scripts/verify-chain.mjs /tmp/agentledger-test/.agentledger/ledger.jsonl
```

- [ ] Output: `OK N` (where N = total event count)
- [ ] Exit code 0

---

## 5. Config Customization Test

Edit `.agentledger/config.json` to add a custom blocked pattern:

```json
{
  "blockedFiles": ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key", "**/payments.ts"],
  "testCommand": "echo 'all tests pass' && exit 0",
  "operator": "aryan"
}
```

Start a new session and try:

> Create a file called payments.ts

- [ ] Edit blocked with reason mentioning `payments.ts`
- [ ] `TOOL_DENIED` event written to ledger

Exit the session:

- [ ] Custom `testCommand` runs (`echo 'all tests pass'`)
- [ ] `VERIFICATION_PASSED` event (no boundary violations this time)
- [ ] `RUN_COMPLETED` event
- [ ] `operator: "aryan"` visible in `RUN_CREATED` payload

---

## 6. Quick Checklist

| # | Scenario | Expected | Pass? |
|---|----------|----------|-------|
| A | Session start | Box printed, config created, dashboard up | |
| B | Normal edit | 3 events (RUN_CREATED → INTENT_COMPILED → TOOL_CALLED) | |
| C | Edit .env | Blocked, TOOL_DENIED in ledger, file unchanged | |
| D | Bash .env | Executes (gap), caught at session end | |
| E | Second edit | Only TOOL_CALLED added, no duplicate run | |
| F | Session end | BOUNDARY_VIOLATION + VERIFICATION_FAILED + RUN_FAILED | |
| G | Read-only session | No new events, no session.json | |
| H | Dashboard live | SSE updates, run visible in browser | |
| I | Chain integrity | verify-chain.mjs → OK | |
| J | Custom config | Custom blocks + operator + testCommand work | |

---

## Troubleshooting

**Hooks not firing:**
Check `.claude/settings.json` is in the test repo root (not `~/.claude/`). Verify paths are absolute and correct.

**"dashboard server did not start within 2s":**
Run `pnpm build` in the monorepo root. The server needs `packages/server/dist/main.js` and `packages/visualizer/dist/` to exist.

**Permission denied on hook scripts:**
```bash
chmod +x /Users/aryansahni/AgentLeader/packages/plugin/scripts/hooks/*.js
```

**Ledger shows unexpected events from prior test:**
```bash
rm -rf /tmp/agentledger-test/.agentledger
```
Then start a fresh session.

**Dashboard shows run as "unknown" or "failed" when it should be "completed":**
Rebuild core and server after the `replayLedger` fix:
```bash
cd /Users/aryansahni/AgentLeader && pnpm build
```
