---
name: audit
description: Show AgentLedger trust score, risk assessment, and compliance audit report. Use when the user wants a risk assessment, trust breakdown, or governance report.
---

Read `.agentledger/stats.json` and `.agentledger/ledger.jsonl` from the current project directory and generate an audit report.

**From stats.json**, show:
- Trust score (percentage) with verifiedTrue/verifiedFalse breakdown
- Total claims tracked and accuracy trend
- Total writes blocked and warnings issued
- Read:edit ratio (flag if below 1.0 as "low — agent may be editing files without reading them first")
- Sessions tracked
- Recent false claims list (if any)

**From ledger.jsonl**, compute:
- Total events and chain integrity (verify hash chain if possible)
- Count of each event type (TOOL_CALLED, TOOL_DENIED, TOOL_WARNED, CLAIM_VERIFIED, CLAIM_FALSIFIED, BOUNDARY_VIOLATION)
- Risk score: HIGH if any BOUNDARY_VIOLATION or >20% false claims, MEDIUM if any CLAIM_FALSIFIED, LOW otherwise

**Format as:**
```
AgentLedger Audit Report
═══════════════════════════

Trust Score    : 81% (38/47 claims verified true)
Risk Level     : LOW / MEDIUM / HIGH

Claims         : 47 total · 38 verified · 9 false · 4 unverifiable
Blocks         : 3 protected file writes prevented
Warnings       : 12 sensitive file edits flagged
Read:Edit      : 2.6x (healthy)
Sessions       : 14 tracked

Recent False Claims:
  • "tests pass" — actual: npm test exit 1 (2026-07-15)
  • "fixed the bug" — actual: 1 boundary violation (2026-07-14)
```

If `stats.json` does not exist, say "No stats yet. AgentLedger will start tracking after your first session completes."
