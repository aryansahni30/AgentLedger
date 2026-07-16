---
name: trust
description: Show AgentLedger trust score breakdown, recent false claims, and accuracy trend. Use when the user wants to see how trustworthy their AI agent is.
---

Read `.agentledger/stats.json` from the current project directory and display a trust score breakdown.

**Show:**

1. **Trust Score** — the headline number: `verifiedTrue / (verifiedTrue + verifiedFalse)` as a percentage
2. **Breakdown by numbers:**
   - Total claims tracked
   - Verified true (agent told the truth)
   - Verified false (agent lied — claimed done but wasn't)
   - Unverifiable (no test command to check against)
3. **Recent false claims** — list from `recentFalseClaims` array, showing what was claimed vs what actually happened
4. **Read:Edit ratio** — from stats, with assessment (>2.0 = healthy, 1.0-2.0 = acceptable, <1.0 = agent may be editing without reading)
5. **Sessions tracked** — how many sessions of data this is based on

**Format as:**
```
AgentLedger Trust Report
═══════════════════════════

  Trust Score : 81%
  ████████░░ (38/47 claims true)

  Verified true  : 38
  Verified false : 9
  Unverifiable   : 4
  Total claims   : 51

  Read:Edit ratio: 2.6x (healthy)
  Sessions       : 14

  Recent Lies:
  • "tests pass" → actual: npm test exit 1 (Jul 15)
  • "fixed the bug" → actual: boundary violation (Jul 14)
```

If `stats.json` does not exist or has zero claims, say "No trust data yet. AgentLedger starts tracking when Claude makes completion claims (like 'tests pass' or 'fixed the bug'). Keep coding — your trust score will appear after a few sessions."
