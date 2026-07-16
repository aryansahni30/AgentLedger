---
name: handoff
description: Generate an AgentLedger handoff document for the current session. Use when the user wants to resume context in a new session or hand off work to another developer/agent.
---

Read `.agentledger/ledger.jsonl` and `.agentledger/session.json` from the current project directory and generate a handoff document.

**From session.json**, extract:
- Current run ID
- Session start time
- Files read and files edited lists
- Claims made and verification results
- Any edit-without-read warnings

**From ledger.jsonl**, filter events for the current run ID and extract:
- What was changed (TOOL_CALLED events with file_path)
- What was blocked or warned (TOOL_DENIED, TOOL_WARNED events)
- Verification status (VERIFICATION_PASSED/FAILED)
- Any claims and their outcomes (CLAIM_VERIFIED/FALSIFIED)

**Format as:**
```
# AgentLedger Handoff — [run ID first 8 chars]
**Date:** [session start date]
**Status:** [PASSED/FAILED/IN PROGRESS]

## What Changed
- [list of files modified with tool type]

## What Was Blocked/Warned
- [list of denied/warned actions]

## Claims Made
- [claim text] → [verified/falsified/unverifiable]

## Verification
- Tests: [exit code]
- Boundary: [clean/violations]

## Context for Next Session
[Summary of what was accomplished and what remains]
```

If no active session exists, read the most recent run from ledger.jsonl instead.
