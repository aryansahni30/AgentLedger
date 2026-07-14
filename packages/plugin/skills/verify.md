# /agentledger-verify

Run the verification gate manually against the current project state.

## What This Does

1. Reads `.agentledger/config.json` for `blockedFiles` and `testCommand`
2. Runs `git diff --name-only HEAD` to detect changed files
3. Checks changed files against `blockedFiles` patterns
4. Runs `testCommand` and captures exit code
5. Reports BOUNDARY_VIOLATION or TESTS_FAILED if applicable

## Usage

```
/agentledger-verify
```

## Enforcement Gap

Edit/Write tool calls are blocked **pre-disk** (PreToolUse hook).
Bash-originated file changes are detected **post-session** via git diff — not prevented in real time.

This gap is architectural: Bash has too many valid use cases to block globally.
The git diff check at session end is the safety net.

## Output

```
[agentledger] Boundary check: 0 violation(s)
[agentledger] Running: npm test
[agentledger] Tests: exit 0
[agentledger] Result: PASSED
```
