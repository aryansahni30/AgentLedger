# /agentledger-handoff

Generate a structured handoff document from the current session's ledger events.

## What This Does

Replays the ledger for the most recent run in this project and generates a Markdown handoff doc covering:

- Run ID and session duration
- All file edits recorded (via TOOL_CALLED events)
- Any boundary violations detected
- Test result (pass/fail + exit code)
- Suggested next steps (derived from incomplete tasks if available)

## Usage

```
/agentledger-handoff
```

## Output

Printed to stdout and optionally saved to `.agentledger/handoff-{runId}.md`.

## Implementation

```javascript
import { LedgerReader, replayLedger } from "@agentledger/core";

const events = await reader.readAll();
const runState = replayLedger(events, latestRunId);
// Build markdown from runState
```
