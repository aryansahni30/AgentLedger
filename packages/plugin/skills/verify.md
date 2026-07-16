---
name: verify
description: Manually trigger AgentLedger verification — boundary check plus test commands. Use when the user wants to verify the current session's work mid-session.
---

Run these verification steps and report results:

1. **Boundary check**: Run `git diff --name-only HEAD` to get changed files. Check each against the blocked patterns in `.agentledger/config.json` (field: `blockedFiles`). Report any violations.

2. **Test command**: Read `.agentledger/config.json` for the `testCommand` field. Run that command and capture the exit code. Report pass/fail.

3. **Summary**: Format results as:
```
AgentLedger Verification
  Boundary : ✓ clean (or list violations)
  Tests    : ✓ exit 0 (or ✗ exit N)
  Result   : PASSED / FAILED
```

If `.agentledger/config.json` does not exist, say "No AgentLedger config found. Run a session first to initialize."
