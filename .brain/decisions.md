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

---

## ADR-015: npm package names (unscoped, conflict avoidance)

**Decision:** Use unscoped names: `agentledger-plugin`, `agentledger-cli`, `agentledger-mcp-server`. Core stays scoped as `@agentledger/core` (scope available).

**Alternatives:** Use `agentledger` (taken by agentledgerhq — different project). Use `@aryansahni/agentledger-*` personal scope.

**Why:** `agentledger` (v0.5.0) and `agentledger-mcp` (v1.0.0) are owned by agentledgerhq on npm — different project, different org. Unscoped names with suffixes (`-plugin`, `-cli`, `-mcp-server`) are all available and avoid trademark/confusion issues. Personal scope `@aryansahni/` is viable fallback but harder to discover.

**Date:** 2026-07-16

---

## ADR-016: Plugin bundles all deps, zero runtime dependencies

**Decision:** Plugin's dist/*.cjs files inline all dependencies (zod, minimatch, proper-lockfile, @agentledger/core) via esbuild bundling. Published package has zero runtime `dependencies`.

**Alternatives:** Publish @agentledger/core to npm and depend on it normally (lockstep versioning). Keep deps external (requires user to install them).

**Why:** Self-contained bundles eliminate dependency resolution issues for end users. A Claude Code plugin should install and work with zero friction — no `pnpm install` in the plugin dir, no workspace links, no transitive dep conflicts. Bundle size (~1.1MB per hook) is acceptable for a CLI tool.

**Date:** 2026-07-16

---

**Decision:** `LedgerEventTypeSchema` is the single contract between the plugin and core, and every event type any hook emits must be an enum member. Hooks report ledger append failures on stderr and never swallow them.

**Alternatives:** Loosen `event_type` to `z.string()` so unknown types pass. Keep the bare `catch {}` and treat ledger writes as best-effort.

**Why:** The Stop hook emitted `CLAIM_*` types that were never added to the enum, so `LedgerEventSchema.parse` threw on every append and a bare catch discarded the error. Detection ran, `session.json` incremented, the ledger stayed empty, and the plugin reported success for a release. Loosening the enum would have hidden the mismatch rather than caught it; the enum is what makes the ledger trustworthy. A verification tool that fails silently is worse than none, because it is believed. Contract tests now assert through the real `LedgerWriter` — mocked writers are what let this ship.

**Date:** 2026-07-17

---

## ADR-017: Claim verification is gated on any tool call, not on file edits

**Decision:** The Stop hook verifies a detected claim when the session has made any tool call (reads + edits + writes + bashCalls > 0), and lazy-inits its own run via the shared `ensureRun` when no Edit/Write has created one. Only a session with zero tool calls is skipped.

**Alternatives:** Keep the `edits + writes > 0` gate and treat an edit-free turn as discussion. Gate on `bashCalls` alone (cheaper, still misses read-only claims).

**Why:** The gate skipped every live session. "Run the tests and tell me the result" edits nothing, so `edits + writes` was 0 and the hook exited before verifying — a run-tests-and-report turn is the most common way an agent misreports, and it was the one case never checked. The hook's tests all passed because the fixture seeded `edits: 5` and a `runId`, reproducing neither live condition. A claim about a suite you ran but did not change is still a claim; a claim about a suite you never ran at all is the most suspect of the lot. Cost of the wider net is bounded by the existing 60s debounce.

**Date:** 2026-07-17

---

## ADR-018: Cross-project registry keyed by canonical path, identified by basename

**Decision:** Tracked repos live in `~/.agentledger/projects.json`, appended by SessionStart. Each entry's `path` is the canonical realpath (unique, locates the ledger); the project *identifier* used by the API and UI is the basename, matching claude-mem.

**Alternatives:** Filesystem scan for `.agentledger/` dirs (rejected — slow, unbounded). Registry inside a ledger (rejected — circular; the registry is what finds the ledgers). Basename as the storage key (rejected — claude-mem's 23 basenames already include an empty string and collide).

**Why:** A central file is the simplest thing that lets one server read many repos. realpath is mandatory, not hygiene: `/tmp` symlinks to `/private/tmp`, so the same repo arrives under two spellings and would register twice, each holding half the sessions. Basename identity is a deliberate collision tradeoff (two repos named `api` share an identifier and interleave) accepted for claude-mem parity; both paths are still kept so neither ledger is lost. Writes take a `proper-lockfile` lock — concurrent SessionStarts in different repos otherwise clobber each other, last-writer-wins.

**Date:** 2026-07-17

---

## ADR-019: Aggregate stats span all projects; only the session list filters

**Decision:** The trust score, trend chart, lies-caught / writes-blocked / claims-checked counters are computed across ALL projects regardless of the selected project. The project filter scopes only the session list and per-session detail. Filtering is client-side: the server serves every event tagged with its project, the UI computes the aggregate from all and `.filter()`s the list.

**Alternatives:** Server-side `?project=` param (rejected — the aggregate needs all events anyway, so it would force a second unfiltered fetch to render one page). Scope the aggregate too (rejected — it answers "how much do I trust my agents overall," which spans every repo).

**Why:** Aggregate and detail answer different questions; conflating them under one filter breaks the "overall trust" reading. Client-side filtering is one fetch, not two, and `useAnalytics` already loaded all events this way. The UI labels the band "across all projects" so the intentional non-response to the filter does not read as a bug.

**Date:** 2026-07-17

---

## ADR-020: Chain integrity is verified per project and rolled up worst-case

**Decision:** Hash chains are verified per ledger file. `/api/projects` reports each project's own `chainValid`; the cross-project badge shows valid only when every project verifies, and names the offenders otherwise.

**Alternatives:** Merge all ledgers and verify one chain (rejected — impossible; the merged sequence is not a chain, `previous_hash` links are per-file). Show the badge only for a single selected project (rejected — a corrupt ledger stays invisible in the default All-Projects view). Drop chain info from the cross-project view (rejected — discards the signal that makes the ledger trustworthy).

**Why:** Chains cannot be merged, so a global verdict has to be a roll-up of per-repo verdicts. Worst-case roll-up surfaces a broken chain anywhere — the thing most worth seeing — without implying a merged chain exists.

**Date:** 2026-07-17

---

## ADR-021: The dashboard server binds 127.0.0.1

**Decision:** `server.listen(port, "127.0.0.1")` — the API binds loopback only, not `0.0.0.0`.

**Alternatives:** Keep the default all-interfaces bind (rejected).

**Why:** The server now aggregates every tracked project's ledger — file paths, shell commands, goals, claims. The prior default bind exposed one project's ledger to the local network; unchanged, this feature would have exposed all of them. A local dashboard has no reason to accept off-host connections.

**Date:** 2026-07-17

---

## ADR-022: SessionEnd summary prints for any session with tool activity, not only edit sessions

**Decision:** The SessionEnd hook gates on `state.dirty` alone (true after the first tool call of any kind), lazily mints a run when one is absent, and runs the test suite only when files were edited. Its test timeout is bounded to 90s, under the 120s hook timeout.

**Alternatives:** Keep the old `!state.runId || !state.dirty` guard (rejected — `runId` is only minted on Edit/Write, so every read-only/review session was silently skipped and the documented Session End box never appeared). Print the box before verification (rejected — Status/Tests/Boundary lines need the verify result). Always run the full suite (rejected — a long suite ran to the 120s hook timeout and was SIGKILLed before `console.log`, eating the box).

**Why:** The README claims the box shows on session end; the code showed it only for edit sessions that also finished verification inside the timeout. Bounding the test timeout below the hook timeout guarantees the box prints; skipping tests on no-edit sessions removes the slow path entirely; a timed-out suite is now labeled "timeout", not a false "exit 1".

**Date:** 2026-07-20

---

## ADR-023: Session End box is rendered by the NEXT SessionStart, not SessionEnd itself

**Decision:** SessionEnd still `console.log`s its box but now also persists it to `.agentledger/last-session-summary.txt` (`scripts/end-summary.js`). SessionStart reads the hook payload `source` from stdin and, for `startup`/`resume`/`clear`, replays the persisted box into its `systemMessage` (then deletes the file so it renders once). For `source: "compact"` — which fires no SessionEnd — it renders a live checkpoint box from the current, un-cleared session state instead.

**Alternatives:** Emit `systemMessage` from SessionEnd directly (rejected — Claude Code swallows SessionEnd hook stdout because the terminal is tearing down; verified empirically, obs 1291). Move the summary to the Stop hook (rejected — Stop fires every turn, wrong semantics). Keep only the file + `cat` (rejected — not automatic; user wants it on screen at clear/compact).

**Why:** SessionStart stdout **is** rendered (via the `hookSpecificOutput`/`systemMessage` envelope) and `/clear` fires SessionEnd → SessionStart back-to-back, so replaying there paints the End box the instant you clear, and at the next launch after a hard quit. Compaction gets its own live banner alongside claude-mem's, matching the "add our banner at compact time" ask.

**Date:** 2026-07-20

---

## ADR-024: SessionStart box ordering — win-the-race-by-losing via a tuned delay

**Decision:** Bumped the SessionStart delay 100ms → `RENDER_LAST_DELAY_MS = 1500` (`scripts/hooks/session-start.js`) so the AgentLedger box renders *below* other plugins' SessionStart banners (notably claude-mem's "recent context").

**Alternatives:** Keep 100ms (rejected — lost to claude-mem's health-poll + context-generation hook, so the box landed above it). Reorder hook registration in `~/.claude/settings.json` (rejected — cross-file/cross-plugin declaration order is not honored; observed order is completion-time, not config order). Poll claude-mem's worker health endpoint before emitting (rejected — couples us to another plugin's internals).

**Why:** Claude Code runs SessionStart hooks concurrently and renders each hook's `systemMessage` in completion order. The 100ms delay already proved it pushes us past the fast hooks (caveman, ecc summary); claude-mem's context banner just finishes later (~0.15s+ warm), so a larger delay is the only lever in our own code to land last. Cost: +1.4s startup; a cold worker on the first post-reboot session may still push claude-mem later — raise the constant if so.

**Date:** 2026-07-20
