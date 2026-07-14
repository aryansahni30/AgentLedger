# /agentledger-ledger

Show the current session's ledger events for this project.

## What This Does

Reads `.agentledger/ledger.jsonl` in the current project, verifies the hash chain, and prints a human-readable summary of all events grouped by run.

## Usage

```
/agentledger-ledger
```

## Output Format

- Run ID, status, start time
- All events in order: type, actor, timestamp, payload excerpt
- Chain integrity status (valid / broken)
- Total event count

## Implementation

```javascript
import { LedgerReader } from "@agentledger/core";
import path from "path";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const reader = new LedgerReader(path.join(projectDir, ".agentledger", "ledger.jsonl"));

const events = await reader.readAll();
const chain = await reader.verifyChain();

// Group by run_id and print
```
