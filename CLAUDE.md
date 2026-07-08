# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AgentLedger — a CLI-first, TypeScript monorepo that coordinates AI coding agents through an append-only task ledger, git-worktree-isolated ownership boundaries, and a verification gate. **Portfolio-first** project; the harness is the engineering contribution, not the planner.

Full brief: `AgentLedger_brief.md`  
Architecture, schemas, decisions, and progress: `.brain/`

---

## .brain/ Maintenance Rules

- **After completing any phase or significant module:** update `.brain/progress.md` with what changed and what's next.
- **When any Zod schema changes:** update `.brain/schemas.md` immediately — it is the canonical source of truth for all types.
- **When making a non-obvious architectural decision:** add a 3-line entry to `.brain/decisions.md`: decision / rejected alternative / reason.
- **When adding a new module or changing data flow:** update `.brain/architecture.md`.
- **Do not update `.brain/project.md`** unless explicitly asked.

---

## Planned Tech Stack

- **Runtime:** Node.js, TypeScript, pnpm workspaces
- **CLI:** Commander.js or oclif (`packages/cli`)
- **Schemas:** Zod (all data models validated at boundaries)
- **Git operations:** `simple-git` or direct shell-outs (`packages/core/src/git/`)
- **Ledger storage:** JSONL file for MVP; SQLite later
- **Tests:** Vitest
- **UI (post-MVP):** React + Vite (`packages/visualizer/`)

---

## Planned Monorepo Structure

```
packages/
  core/src/
    ledger/      # append, read, hash-chain, replay, query
    planner/     # intent → task graph
    worker/      # executes one task inside a git worktree
    verifier/    # boundary check + command runner
    replay/      # reconstruct run state from ledger events
    schemas/     # Zod schemas for all shared types
    git/         # worktree create/diff/merge/cleanup
  cli/src/
    commands/    # init, run, ledger, tasks, verify, replay
    index.ts
  examples/
    todo-app/
    github-issue-runner/
  visualizer/    # post-MVP
```

Run state lives in `.agentledger/` inside the target repo:
```
.agentledger/
  config.json
  ledger.jsonl
  tasks.json
  artifacts/
  patches/
  worktrees/
  runs/
```

---

## Planned CLI Commands

```bash
agentledger init
agentledger run "<request>"
agentledger ledger view
agentledger tasks view
agentledger verify
agentledger replay
```

---

## Core Design Invariants

These are non-negotiable constraints — do not violate them when implementing:

### Ledger
- **Single writer:** only the orchestrator appends to `ledger.jsonl`. Workers return structured results to the orchestrator; they never write to the ledger directly.
- **Hash chaining is required in MVP** — every event carries `hash` and `previous_hash` (rolling SHA-256 of `previous_hash + serialized event payload`). Do not ship the "immutable" claim without it.
- **Append-only** — no event is ever deleted or modified. Replay reconstructs state from events.

### Isolation
- **Two layers, both required:**
  1. *Prevention* — each worker runs inside its own git worktree (`agentledger/{task_id}` branch), scoped via `git sparse-checkout` to `allowedFiles`.
  2. *Detection* — verifier diffs the task branch against `allowedFiles`/`blockedFiles` before merge, independent of what the worker reported.
- **`allowedTools` is detection/audit only** — there is no technical mechanism to prevent an LLM worker with shell access from calling out-of-scope tools. The verifier audits ledger events post-hoc. Do not claim tool constraints are enforced the same way file boundaries are.

### Execution (MVP)
- **Workers run sequentially** in dependency order. Parallel execution is a named stretch feature — do not add it to MVP. The ledger write model (single JSONL writer) depends on sequential execution for v1.

### Verification
- **Real exit codes, never self-reports.** A worker claiming "tests pass" is irrelevant. The verifier runs `npm test` (or the configured command) and uses the exit code. Worker self-reports are logged but never trusted for task completion.

### Replay
- "Replay" means reconstructing run state from the event log — not re-executing agents to reproduce an identical result. LLM agents are not deterministic; the *protocol* is.

---

## Key Data Types (from brief — implement with Zod)

```typescript
// All events stored in ledger.jsonl
type LedgerEvent = {
  event_id: string;
  run_id: string;
  task_id?: string;
  timestamp: string;
  actor: string;
  event_type: LedgerEventType;
  payload: Record<string, unknown>;
  hash: string;           // required
  previous_hash: string;  // required
};

type AgentTask = {
  taskId: string; runId: string; title: string; description: string;
  owner: string; dependencies: string[];
  allowedFiles: string[]; blockedFiles: string[];
  allowedTools: string[];   // audit only — not technically enforced
  expectedOutputs: string[]; successCriteria: string[];
  status: "pending" | "assigned" | "running" | "awaiting_verification" | "completed" | "failed";
};

type WorkerResult = {
  taskId: string; summary: string;
  filesRead: string[]; filesModified: string[];
  patchPath?: string; worktreeBranch: string;
  output: Record<string, unknown>;
};
```

Full event type union and remaining types are in `AgentLedger_brief.md` §12.

---

## Build Phase Order

Follow this order — do not skip ahead to Phase 6/7 before Phases 1–5 are solid:

1. Monorepo skeleton + TypeScript config + CLI skeleton + Zod schemas + ledger writer/reader with hash chaining
2. Intent contract + task schema + static planner + task graph validation
3. Git worktree create/teardown + mock worker execution + patch artifact generation
4. Boundary checker (worktree diff) + command runner + verification events + run summary
5. Ledger replay + hash chain verification + run state reconstruction
6. Unhappy-path **test fixtures** (scripted boundary violation + false self-report) — internal only, not the public demo
7. Real LLM adapter (Anthropic first) + planner/worker prompts — **record public demo GIF here**, using a real model with a temptation-laden prompt

---

## Demo Requirements

The public-facing demo (README GIF/video) must show:
- A **real LLM** (not a mock) attempting to touch a blocked file
- The verifier emitting `BOUNDARY_VIOLATION` and rejecting the patch
- A second case where the worker claims success but `npm test` exits non-zero → `VERIFICATION_FAILED`

"It caught a lie" and "it blocked a boundary violation" are the two moments that prove the harness works.

---

## What AgentLedger Is Not

Do not add these unless explicitly scoped in:
- GitHub integration, Slack, Vercel hooks
- Parallel worker execution (stretch feature — requires redesigning the ledger write model)
- Web dashboard / visualizer (post-MVP)
- LangGraph / CrewAI / AutoGen adapters (post Phase 7)
- Human approval gates (stretch)
