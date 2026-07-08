# project.md

## What This Is

AgentLedger is a CLI-first, TypeScript monorepo that coordinates multiple AI coding agents against a single repo using:
- An append-only, hash-chained task ledger (JSONL)
- Git-worktree-isolated ownership boundaries per task
- A verification gate that runs real commands and rejects self-reported success

It is not a general multi-agent framework, not a durable-execution platform, not a chatbot wrapper.

## Primary Goal

**Portfolio-first.** Target audience: engineers and hiring managers evaluating serious AI infrastructure work.

Market adoption is a secondary possibility — not the design constraint for v1. This distinction resolves every scope ambiguity: when unsure whether to build something, ask "does the harness need this to be impressive?" not "would a production user want this?"

## What Makes It Defensible

The harness is the engineering contribution:
1. Append-only, hash-chained ledger — "immutable" isn't a marketing claim, it's enforced by the chain
2. Git-worktree isolation — physical prevention, not just policy
3. Verification gate — real exit codes, never LLM self-reports
4. Replayable traces — full execution history reconstructable from the JSONL

The planner is NOT the contribution. It's a prompt-engineering problem. A mocked or rule-based planner is fine for MVP as long as the README doesn't overclaim intelligence the planner doesn't have.

## Positioning Decisions (Locked)

| Decision | Choice | Why |
|---|---|---|
| Scope | Narrow — one repo, coding agents only | Broad framing invites "isn't this just X?" rebuttals |
| Ledger storage | JSONL (MVP) → SQLite (later) | JSONL is auditable by humans, no infra to stand up |
| Worker execution | Sequential (MVP), parallel (stretch) | Sidesteps concurrent-write problem; harness first |
| Planner | Mocked/rule-based (MVP), real LLM (Phase 7) | Harness is the point; planner improves forever |
| Demo | Record after Phase 7 with real LLM | Scripted violations are test fixtures, not the public story |
| `allowedTools` | Detection/audit only — not enforced | LLM workers with shell access can't be technically constrained |
| UI | Post-MVP | CLI first; harness must work before it's worth visualizing |

## One-Line README Hook

> Coordination for AI coding agents, with git-native isolation and a verification gate.

## Target Users

- Primary: developers building AI agent workflows who want reliability + traceability
- Secondary: AI infra engineers, DevTools builders, open-source agent framework users, recruiters/hiring managers
- Tools they use: Cursor, Claude Code, Codex, LangGraph, CrewAI, AutoGen, custom agents
