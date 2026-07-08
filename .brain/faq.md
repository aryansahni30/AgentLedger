# faq.md

Write the README FAQ section from these answers — before building, not after.  
Having these written forces you to know your differentiation; having them in the README means you don't improvise under pressure in issue threads or interviews.

---

## "Isn't this just a fancy pre-commit hook?"

No. A pre-commit hook checks one commit with no task context.

AgentLedger's verifier checks against a **per-task ownership contract** — a declared set of `allowedFiles`, `blockedFiles`, and `successCriteria` scoped to a specific piece of work — and validates:

- **Cross-task boundaries:** did any task touch files owned by another task?
- **Intent alignment:** did the output satisfy the run's original `successCriteria`?
- **Verification commands:** did actual tests pass (real exit codes, not self-reports)?
- **Audit trail:** every agent action that led to the result is in the ledger, replayable

A pre-commit hook knows nothing about which agent made a change, why, whether it violated a higher-level constraint, or what the original task intent was. AgentLedger knows all of this.

---

## "Why not Temporal / a durable execution platform?"

Temporal is more general and more mature. It solves deterministic-workflow-plus-nondeterministic-activity orchestration for any domain.

AgentLedger is **narrower by design:** it's specifically a coordination layer for multiple coding agents against one repo, using git as the isolation primitive. You can adopt AgentLedger in an afternoon without standing up a workflow platform, registering worker pools, or learning a new execution model.

If you're already on Temporal, AgentLedger's concepts (ledger, ownership boundaries, verification gate) could complement it — but that's not the target user. The target user is a developer who wants to run `agentledger run "add email validation"` against their repo and get a reliable, traced, verifiable result.

---

## "Why not LangGraph / CrewAI / AutoGen?"

Those are agent orchestration frameworks — they let you wire agents together, share memory, and define graph-based workflows. AgentLedger doesn't compete with them.

AgentLedger is a **coordination protocol** that could sit on top of whatever agents you're running. A LangGraph graph could be a worker inside AgentLedger. The differences:

| | LangGraph / CrewAI / AutoGen | AgentLedger |
|---|---|---|
| Ownership boundaries | No | Yes — declared per task, enforced |
| Physical workspace isolation | No | Yes — git worktrees per task |
| Verification before accepting work | No | Yes — real command exit codes |
| Immutable execution audit log | No | Yes — hash-chained JSONL |
| Replayable traces | No | Yes |

AgentLedger adds exactly those five things, and nothing else.

---

## "Isn't the planner just an LLM prompt? What's novel there?"

Yes, and we're not claiming the planner is novel.

The **harness** is the engineering contribution: the append-only hash-chained ledger, git-worktree-isolated task ownership, and the verification gate that rejects self-reported success.

The planner is a prompt-engineering problem that improves forever — with better models, better prompts, better context retrieval. AgentLedger's thesis is:

- A mediocre planner + strong harness = reliable results
- A good planner + no harness = unreliable results

The harness is what's being built and proven here.

---

## "What's actually enforced vs. just logged?"

| Constraint | Enforced | Detected / Logged |
|---|---|---|
| `allowedFiles` (file write boundaries) | Partially — git sparse-checkout (imperfect) | Yes — verifier diff is authoritative |
| `blockedFiles` | Partially — sparse-checkout exclusion | Yes — verifier diff is authoritative |
| `allowedTools` | **No** — detection only | Yes — ledger events audited post-hoc |
| Output schema | Yes — Zod validation before merge | Yes — logged in ledger |
| Verification commands (tests, lint, typecheck) | Yes — real exit codes, not self-reports | Yes — stdout/stderr captured in ledger |

The "No" in the `allowedTools` enforcement column is intentional and honest. LLM workers with shell access cannot be prevented from calling tools outside their declared list without heavy sandboxing infrastructure. `allowedTools` is a declaration of intent and an audit target — not a technical fence.

This is the table to keep in the README. Technical reviewers will ask; have the answer there, not improvised.

---

## "Why not just trust the agents? They're getting better every month."

Because "getting better" is not the same as "reliably correct," and for codebases with sensitive modules (payments, auth, database migrations), "pretty reliable" is not acceptable.

AgentLedger's approach is the same as CI/CD: you don't trust that your code is correct because the developer is skilled — you run the tests and fail the build if they don't pass. The same principle applies to AI agents. The harness doesn't assume agents are bad; it just doesn't assume they're perfect.

---

## "Why JSONL instead of a real database?"

For MVP: JSONL is human-readable, diffable, and requires zero infrastructure. A developer can `cat .agentledger/ledger.jsonl` and read the full execution history. The hash chain is trivially verifiable with a small script. No query performance problems at the scale of a single multi-task run.

SQLite is the named next step when query performance matters (e.g., listing all BOUNDARY_VIOLATION events across 1,000 runs). That's not an MVP problem.

---

## "Why TypeScript and not Python?"

The primary demo repos use TypeScript (React/Next.js). Default verification commands (`npm test`, `npm run typecheck`, `npm run lint`) are JS ecosystem commands. The target audience (DevTools builders, AI infra engineers) skews TypeScript-comfortable.

Python has richer AI tooling ecosystem — but AgentLedger is not an AI tooling library, it's a coordination harness. The language choice follows the target repo ecosystem, not the LLM provider ecosystem.
