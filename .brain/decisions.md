# decisions.md

ADR-style log. Every non-obvious architectural or product call goes here.  
Format: **Decision** | **Alternatives considered** | **Why this** | **Date**

---

## ADR-001: Portfolio-first primary goal

**Decision:** AgentLedger is built for open-source credibility and recruiter visibility first. Market adoption is a secondary possibility.

**Alternatives:** Market-first (build what developers actually need today), balanced (serve both equally).

**Why:** Serving both goals equally leads to a project that's too complex to be an impressive portfolio piece and too unpolished to attract real users. Committing to portfolio-first resolves scope ambiguity consistently: when unsure whether to build something, ask "does the harness need this to be impressive?" — not "would a production user want this?"

**Date:** 2026-07-06

---

## ADR-002: Sequential worker execution for MVP

**Decision:** Workers execute sequentially in dependency order. Parallel execution is a named stretch feature.

**Alternatives:** Parallel from day one (matches the architecture diagram showing concurrent workers).

**Why:** Parallel execution requires: (1) concurrent-safe ledger writes, (2) confirmed worktree isolation under concurrent git object store access, (3) merge conflict resolution between task branches. None of this is necessary to prove the coordination thesis. Sequential execution lets MVP ship the single-writer JSONL ledger without redesign. Phase ordering: get the harness right, then add concurrency.

**Date:** 2026-07-06

---

## ADR-003: Hash chaining required in MVP (not optional)

**Decision:** Every ledger event carries `hash` and `previous_hash`. `hash = SHA-256(previous_hash + JSON.stringify(payload))`. First event uses `previous_hash = "genesis"`.

**Alternatives:** Ship without hash chain; add later. Treat it as a stretch feature.

**Why:** The project's central marketing claim is an "immutable append-only ledger." That claim is only defensible if the chain is there. A JSONL file without a hash chain is a structured log, not an immutable audit log. The implementation cost is low (one line of crypto per append). Shipping the "immutable" pitch without it is dishonest — and technical reviewers will notice.

**Date:** 2026-07-06

---

## ADR-004: allowedTools is detection/audit only — not enforcement

**Decision:** `allowedTools` in `AgentTask` is declared and audited post-hoc via ledger events. It is NOT technically enforced at the process level.

**Alternatives:** Claim enforcement; use a sandboxed subprocess that intercepts syscalls; restrict to a set of wrapped tool functions.

**Why:** Any LLM worker with shell access can call tools outside `allowedTools` — there is no practical mechanism to prevent this without heavy sandboxing infrastructure (seccomp, containers) that contradicts the "adopt in an afternoon" positioning. File boundaries get two enforcement layers (sparse-checkout + verifier diff) because git provides native primitives. Tools don't have an equivalent primitive. The README must say explicitly: "tool constraints are detected, not prevented."

**Date:** 2026-07-06

---

## ADR-005: Two isolation layers for file boundaries (not one)

**Decision:** File boundary enforcement uses: (1) git sparse-checkout (prevention, imperfect), AND (2) verifier diff against allowedFiles/blockedFiles (detection, authoritative). Both required.

**Alternatives:** Sparse-checkout only (prevention without independent check). Verifier diff only (detection without physical isolation). 

**Why:** Sparse-checkout is imperfect — a worker with shell access can write outside its checkout. Relying on it alone means a sufficiently capable (or misbehaving) agent can violate boundaries undetected. Verifier diff alone means there's no physical isolation during execution — only a post-hoc check. Defense-in-depth: the prevention layer reduces surface; the detection layer is authoritative before merge. Neither alone matches the "enforced ownership boundaries" claim.

**Date:** 2026-07-06

---

## ADR-006: Single ledger writer (orchestrator only)

**Decision:** Workers do not write to `ledger.jsonl` directly. They return structured `WorkerResult` to the orchestrator. The orchestrator appends all events.

**Alternatives:** Workers write their own events directly to the ledger.

**Why:** Direct worker writes require file locking or an append queue to be safe under sequential execution, and require a full concurrency redesign for parallel execution. Single-writer sidesteps both problems for v1. The orchestrator has full context to write accurate events anyway (it sees the task, the worker result, and the verification result together). This constraint also simplifies hash chain integrity — one writer means no interleaved appends to reason about.

**Date:** 2026-07-06

---

## ADR-007: JSONL ledger for MVP, SQLite later

**Decision:** MVP ledger is a `.jsonl` file. SQLite is a named upgrade for post-MVP.

**Alternatives:** SQLite from day one. Postgres. Flat JSON.

**Why:** JSONL is human-readable, diffable, cat-able. Zero infra to stand up. Trivial to implement hash chain append. The "inspect the audit log" story is stronger when a developer can literally open it in a text editor. SQLite unlocks indexed queries, which matter when ledger size grows — but MVP doesn't have that problem. JSONL first, upgrade when query performance is actually a bottleneck.

**Date:** 2026-07-06

---

## ADR-008: Demo GIF recorded after Phase 7 (real LLM), not Phase 6

**Decision:** Scripted violation demos (Phase 6) are internal test fixtures only. The public-facing README demo GIF is recorded after Phase 7 using a real LLM with a temptation-laden prompt.

**Alternatives:** Record demo with scripted mock worker in Phase 6; note it's scripted.

**Why:** A technical reviewer will recognize a scripted violation demo — it proves the harness catches what it was told to catch, not that it catches real agent misbehavior. "A real model attempted to touch a blocked file and got caught" is a fundamentally more credible story than "we scripted a violation to test our violation detector." The phase order stays (harness before LLM), but the public artifact (GIF/video) waits for the real thing.

**Date:** 2026-07-06

---

## ADR-009: Planner is intentionally thin

**Decision:** The planner is a prompt-engineering component, not an architecture component. Mock/rule-based planner is acceptable for MVP. Do not restructure phases around planner quality.

**Alternatives:** Invest heavily in planner quality early; treat it as a core module equal to ledger and verifier.

**Why:** The thesis is: a mediocre planner + strong harness = reliable results. A brilliant planner + no harness = unreliable results. The harness (ledger, isolation, verification) is what's being proven. The planner is a text-to-structured-output problem that improves with better prompts and better models over time — not a one-time architecture decision. Sinking Phase 1-3 time into planner quality inverts the priority.

**Date:** 2026-07-06

---

## ADR-010: TypeScript + pnpm monorepo (not Python, not Go)

**Decision:** TypeScript, Node.js, pnpm workspaces. Zod for schemas. Vitest for tests.

**Alternatives:** Python (popular in AI tooling). Go (performant CLI). Rust (maximum performance).

**Why:** The target demo repos are TypeScript (React, Next.js). Running `npm test` / `npm run typecheck` as verification commands assumes a JS ecosystem by default. TypeScript gives strong typing for schema validation with Zod. pnpm workspaces is the current standard for TypeScript monorepos. The audience (AI infra engineers, DevTools builders) skews TypeScript-comfortable.

**Date:** 2026-07-06

---

## ADR-011: Plugin-only product focus (drop CLI orchestrator)

**Decision:** Product focus shifts to plugin (observer/enforcer mode). CLI orchestrator deprioritized — not deleted, but no new features.

**Alternatives:** CLI-first (orchestrator is the product). Dual investment (both equally). Plugin as thin wrapper over CLI.

**Why:** CLI orchestrator requires users to change their workflow (`agentledger run` instead of normal Claude Code). Plugin is zero-friction — install and forget. Real users want guardrails on their existing agent, not a new orchestration layer. Skills shelling out to CLI created a brittle dependency chain.

**Date:** 2026-07-15

---

## ADR-012: Direction A — "The Lie Detector" as product direction

**Decision:** Position AgentLedger as "the trust layer" that catches false completion claims. Trust score as hero metric. Real-time claim verification via Stop hook.

**Alternatives:** Direction B (CI/CD guard — enterprise security), Direction C (team governance — shared ledger), Direction D (harness X-ray — session transparency).

**Why:** Problem 1 (agents lie about completion) is the loudest, most current, most screenshot-able pain in the ecosystem (mid-2026). Our deterministic verification is better than the workaround (AMD paying for Codex-as-verifier). Trust score is inherently shareable — "my AI lies 19% of the time" drives organic growth. Mostly repackaging existing code, not new architecture.

**Date:** 2026-07-15

---

## ADR-013: Keyword matching for claim detection (not LLM classifier)

**Decision:** Detect completion claims with regex/keyword patterns, not an LLM classifier.

**Alternatives:** Lightweight LLM classifier (Haiku). Embedding similarity. Structured output parsing.

**Why:** Keyword matching is <1ms, free, deterministic, zero dependencies. False positive reduction via code-block stripping and negation-context filtering. Upgrade path to LLM classifier exists if false positive rate exceeds 5%, but keyword MVP is the right starting point.

**Date:** 2026-07-15

---

## ADR-014: Trust score excludes unverifiable claims

**Decision:** Trust score = verifiedTrue / (verifiedTrue + verifiedFalse). Claims with no test command to check against are logged as CLAIM_UNVERIFIABLE and excluded from the denominator.

**Alternatives:** Count unverifiable as "trusted by default" (inflates score). Count as "untrusted" (penalizes unfairly). Include with neutral weight.

**Why:** The trust score must be deterministically defensible. Including unverifiable claims in either direction makes the number misleading. Logging them separately lets users see the gap and configure a test command to close it.

**Date:** 2026-07-15
