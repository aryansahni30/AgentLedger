---
name: ledger
description: Show AgentLedger ledger events and run state for the current session. Use when the user wants to see recorded events, run history, or the audit trail for this project.
---

Read the ledger file at `.agentledger/ledger.jsonl` in the current project directory. Each line is a JSON object with fields: `event_id`, `run_id`, `timestamp`, `actor`, `event_type`, `payload`, `hash`, `previous_hash`.

Show the last 20 events in a formatted table with columns: Time, Event Type, Actor, and Key Payload Details.

Group events by run_id. For each run, show:
- Run ID (first 8 chars)
- Status (look for RUN_COMPLETED or RUN_FAILED events)
- Number of TOOL_CALLED events
- Number of TOOL_DENIED or TOOL_WARNED events
- Whether VERIFICATION_PASSED or VERIFICATION_FAILED
- Any CLAIM_VERIFIED or CLAIM_FALSIFIED events

If `.agentledger/ledger.jsonl` does not exist, say "No ledger found — AgentLedger will start recording when you make your first edit."
