# Contributing

Thanks for your interest in AgentLedger. Issues and PRs are welcome.

## Setup

AgentLedger is a pnpm-workspace monorepo. You need Node.js >= 20 and pnpm.

```bash
pnpm install
```

## Running checks

Before opening a PR, make sure both pass — CI runs the same on Node 20 and 22:

```bash
pnpm typecheck
pnpm test
```

Run a single package's tests with a workspace filter, e.g.:

```bash
pnpm --filter agentledger-plugin test
```

## Proposing changes

1. Fork and branch off `main`.
2. Keep changes focused; add or update tests for anything you change.
3. Use [conventional commit](https://www.conventionalcommits.org/) messages
   (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).
4. Make sure `pnpm typecheck` and `pnpm test` are green.
5. Open a PR describing what changed and why, with a short test plan.

## Design invariants

Some constraints are non-negotiable — see `CLAUDE.md` for the full list. The
most important:

- The ledger is **append-only** and **single-writer**. Events are never
  deleted or modified; hash chaining must stay intact.
- Verification uses **real process exit codes**, never worker self-reports.
- File-boundary prevention (Edit/Write) and detection (git diff at session
  end) are separate layers — don't collapse them.

If a change touches these, call it out explicitly in the PR.
