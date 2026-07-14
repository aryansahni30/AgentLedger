# /agentledger-audit

Run a full audit of the project's ledger — chain integrity, boundary violations, test failures, and anomaly detection.

## What This Does

1. Reads all events from `.agentledger/ledger.jsonl`
2. Verifies hash chain integrity (detects tampering)
3. Counts BOUNDARY_VIOLATION events across all runs
4. Counts VERIFICATION_FAILED events
5. Counts TOOL_DENIED events (real-time blocks)
6. Flags any runs with self-reported success but failing tests
7. Prints a risk score and per-category breakdown

## Usage

```
/agentledger-audit
```

## Output

```
╔════════════════════════════════╗
║   AgentLedger Audit Report     ║
╚════════════════════════════════╝
  Total runs          : 12
  Chain integrity     : ✓ valid (847 events)
  Boundary violations : 2  ← Bash-originated
  Tool denials        : 5  ← Edit/Write blocked pre-disk
  Verification fails  : 1
  Risk score          : MEDIUM

Policy violations:
  [run:a3f4c1b2] BOUNDARY_VIOLATION — .env modified via Bash
  [run:9e22d0f1] VERIFICATION_FAILED — npm test exit 1
```

## Enforcement Gap Note

BOUNDARY_VIOLATION events in the audit represent Bash-originated violations detected via git diff at session end — not prevented in real time. TOOL_DENIED events represent Edit/Write calls blocked before they hit disk.
