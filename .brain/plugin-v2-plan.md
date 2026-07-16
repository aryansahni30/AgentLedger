# AgentLedger Plugin v2 — "The Trust Layer"

> **One-line pitch:** "Claude says done. AgentLedger checks."

**Date:** 2026-07-15
**Status:** Accepted
**Scope:** Plugin-only (CLI orchestrator deprioritized)

---

## 1. Problem Statement

AI coding agents (Claude Code, Codex, Cursor) confidently claim work is done when it isn't. "Tests pass" when they fail. "Fixed the bug" when it's not fixed. Developers describe this as worse than a junior engineer — a junior wouldn't lie about completion.

**Evidence this is real (mid-2026):**
- AMD ran Codex as a verification layer on top of Claude Code — paying for a second AI to check the first — before revoking Claude Code access
- Multiple viral Medium/Reddit/HN posts documenting false completion claims
- "Read to edit ratio" dropping (agents editing files they barely read)
- Microsoft security researchers found Claude Code GitHub Action vulnerabilities (June 2026)

**Current state:** AgentLedger's plugin already blocks protected file writes and runs verification at session end. But verification is too late (session end only), results aren't visible enough, and the product isn't positioned around the pain users actually feel.

**Target state:** AgentLedger catches false claims in real-time, shows a persistent trust score every session, and proves its value with visible metrics — making it the trust layer any AI coding agent is missing.

---

## 2. Architectural Design

### 2.1 Hook Architecture (Claude Code Plugin)

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Session                       │
│                                                             │
│  SessionStart ──→ [banner + stats]                          │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐               │
│  │ PreTool │───→│ Claude   │───→│ PostTool │               │
│  │  Use    │    │ executes │    │  Use     │               │
│  │         │    │ tool     │    │          │               │
│  │ BLOCK   │    │          │    │ RECORD   │               │
│  │ or WARN │    │          │    │ + TRACK  │               │
│  └─────────┘    └──────────┘    └──────────┘               │
│       │                              │                      │
│       │         ┌──────────┐         │                      │
│       │         │  Stop    │◄────────┘                      │
│       │         │  Hook    │                                │
│       │         │          │                                │
│       │         │ DETECT   │                                │
│       │         │ CLAIMS   │                                │
│       │         │ VERIFY   │                                │
│       │         └──────────┘                                │
│       │              │                                      │
│       ▼              ▼                                      │
│  ┌──────────────────────────────────┐                       │
│  │         SessionEnd               │                       │
│  │  • git diff boundary check       │                       │
│  │  • run test command              │                       │
│  │  • update stats.json             │                       │
│  │  • print session summary         │                       │
│  └──────────────────────────────────┘                       │
│                      │                                      │
│                      ▼                                      │
│            ┌──────────────────┐                              │
│            │  Persistent      │                              │
│            │  • ledger.jsonl  │                              │
│            │  • stats.json    │                              │
│            │  • session.json  │                              │
│            └──────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Hook Responsibilities

| Hook | Trigger | Responsibility |
|------|---------|----------------|
| **SessionStart** | Session open | Ensure `.agentledger/`, write default config, start dashboard, read `stats.json`, render banner with trust score |
| **PreToolUse** | `Edit\|Write` | Block writes matching `blockedFiles`, warn writes matching `warnFiles`, emit `TOOL_DENIED` or `TOOL_WARNED` |
| **PostToolUse** | `Edit\|Write\|Bash\|Read` | Record `TOOL_CALLED` events, track read/edit counts in session state, lazy-init run |
| **Stop** | Every assistant turn end | Scan assistant output for completion claims, run quick verification on claim, emit `CLAIM_VERIFIED` or `CLAIM_FALSIFIED` |
| **SessionEnd** | Session close | Layer 2 git-diff boundary check, run full test command, compute session stats, merge into `stats.json`, print summary |

### 2.3 Data Model

#### stats.json (persistent, per-project)

```json
{
  "version": 1,
  "totalClaims": 47,
  "verifiedTrue": 38,
  "verifiedFalse": 9,
  "unverifiable": 4,
  "trustScore": 0.808,
  "totalBlocks": 3,
  "totalWarnings": 12,
  "sessionsTracked": 14,
  "filesReadTotal": 234,
  "filesEditedTotal": 89,
  "readEditRatio": 2.63,
  "recentFalseClaims": [
    {
      "claim": "tests pass",
      "actual": "npm test exit 1",
      "timestamp": "2026-07-15T14:30:00Z"
    }
  ],
  "lastUpdated": "2026-07-15T21:30:00Z"
}
```

#### session.json (ephemeral, per-session — extends current)

```json
{
  "runId": "uuid",
  "dirty": true,
  "sessionStart": "2026-07-15T14:00:00Z",
  "reads": 12,
  "edits": 5,
  "writes": 1,
  "bashCalls": 8,
  "claimsDetected": 3,
  "claimsVerifiedTrue": 2,
  "claimsVerifiedFalse": 1,
  "filesRead": ["src/a.ts", "src/b.ts"],
  "filesEdited": ["src/a.ts"],
  "editWithoutRead": []
}
```

#### New Ledger Event Types

| Event Type | Emitted By | Payload |
|------------|------------|---------|
| `TOOL_WARNED` | PreToolUse | `{ tool, file_path, matched_pattern }` |
| `CLAIM_DETECTED` | Stop | `{ claim_text, claim_type, patterns_matched }` |
| `CLAIM_VERIFIED` | Stop | `{ claim_text, verification: { test_exit_code, boundary_clean } }` |
| `CLAIM_FALSIFIED` | Stop | `{ claim_text, expected, actual, verification_details }` |
| `CLAIM_UNVERIFIABLE` | Stop | `{ claim_text, reason }` |

#### Config Schema (extends current)

```json
{
  "blockedFiles": ["**/.env", "**/*.key", "**/*.pem"],
  "warnFiles": ["**/migrations/**", "**/auth/**", "package.json", "**/middleware.*"],
  "testCommand": "npm test",
  "testTimeout": 30000,
  "claimDetection": true,
  "operator": ""
}
```

### 2.4 Claim Detection Design

**Detection mechanism:** Keyword/regex pattern matching on assistant's last message.

```javascript
const CLAIM_PATTERNS = [
  { pattern: /tests?\s+(pass|passing|succeed|green)/i, type: "test_claim" },
  { pattern: /(?:all\s+)?checks?\s+pass/i, type: "test_claim" },
  { pattern: /build\s+(?:succeed|pass|green|success)/i, type: "build_claim" },
  { pattern: /no\s+(?:errors?|issues?|failures?|bugs?)/i, type: "quality_claim" },
  { pattern: /successfully\s+(?:built|compiled|tested|deployed)/i, type: "build_claim" },
  { pattern: /(?:fixed|resolved)\s+(?:the\s+)?(?:bug|issue|error|problem)/i, type: "fix_claim" },
  { pattern: /(?:done|complete[d]?|finished|implemented|working\s+now)/i, type: "completion_claim" },
];
```

**Verification logic (shared between Stop hook and SessionEnd):**

```
claim detected
  ├─ test_claim / build_claim
  │    → run testCommand (short timeout: 30s)
  │    → exit 0 = VERIFIED, else FALSIFIED
  │
  ├─ fix_claim / completion_claim
  │    → run testCommand if configured
  │    → git diff boundary check
  │    → both pass = VERIFIED, else FALSIFIED
  │    → no testCommand = UNVERIFIABLE (logged, not counted in trust score)
  │
  └─ quality_claim
       → run testCommand if configured
       → exit 0 = VERIFIED, else FALSIFIED
```

**Debounce rules:**
- Same claim type not re-verified within 60 seconds
- Claims on turns with zero file changes → skip (informational statement, not work claim)
- Max 1 verification per Stop hook invocation

### 2.5 User-Facing Output

**SessionStart banner:**
```
┌───────────────────────────────────────────────┐
│          AgentLedger - Session Start           │
│                                               │
│  Trust score     : 81% (38/47 claims true)    │
│  Lies caught     : 9 false claims all-time     │
│  Writes blocked  : 3 protected file saves      │
│  Chain integrity : ✓ valid (142 events)        │
│  Dashboard       : http://localhost:4242       │
└───────────────────────────────────────────────┘
```

First session (no stats yet):
```
┌───────────────────────────────────────────────┐
│          AgentLedger - Session Start           │
│                                               │
│  Trust score     : — (tracking starts now)     │
│  Files guarded   : 4 blocked · 4 warned        │
│  Chain integrity : ✓ valid (0 events)          │
│  Dashboard       : http://localhost:4242       │
└───────────────────────────────────────────────┘
```

**Mid-session claim check (Stop hook, stderr):**
```
⚠ CLAIM CHECK: Claude said "tests pass" → actual: npm test exit 1
```
```
✓ CLAIM CHECK: Claude said "implemented" → verified: tests pass, no violations
```

**PreToolUse warning (stderr, non-blocking):**
```
⚠ AgentLedger: editing auth/middleware.ts — flagged sensitive (warnFiles)
```

**SessionEnd summary:**
```
╔═══════════════════════════════════════╗
║       AgentLedger — Session End       ║
╚═══════════════════════════════════════╝
  Status     : ✓ PASSED
  Claims     : 3 made · 3 verified · 0 false
  Boundary   : ✓ clean
  Tests      : exit 0
  Read:Edit  : 2.1x (healthy)
  Trust Δ    : 81% → 83%  ↑
```

---

## 3. Implementation Plan

### Phase 1: Stats Foundation + Enhanced Banner

**Goal:** User sees proof AgentLedger is working, every session.

**Files to create/modify:**
- `scripts/stats.js` — NEW: read/write/merge stats.json
- `scripts/hooks/post-tool-use.js` — MODIFY: add Read tracking, track counts in session state
- `scripts/hooks/session-start.js` — MODIFY: read stats.json, render enhanced banner
- `scripts/hooks/session-end.js` — MODIFY: compute session stats, merge into stats.json, enhanced summary
- `scripts/state.js` — MODIFY: extend session state with read/edit/claim counters
- `scripts/summary.js` — MODIFY: updated banner format with trust score

**Tasks:**
1. Create `stats.js` module — `readStats()`, `writeStats()`, `mergeSessionStats()`
2. Extend `session.json` state with `reads`, `edits`, `writes`, `bashCalls`, `filesRead[]`, `filesEdited[]`
3. Update PostToolUse: add `Read` to matcher, increment counters, track file lists
4. Update SessionEnd: compute session-level stats, call `mergeSessionStats()` to persist
5. Update SessionStart banner: read stats.json, show trust score / lies caught / blocks
6. Update SessionEnd summary: show claims, read:edit ratio, trust delta
7. Add `editWithoutRead` detection: flag files edited but never read in this session

### Phase 2: Stop Hook — Claim Detection + Instant Verification

**Goal:** Catch false completion claims in real-time, mid-session.

**Files to create/modify:**
- `scripts/hooks/stop.js` — NEW: claim detection + quick verification
- `scripts/claim-detector.js` — NEW: pattern matching + verification logic
- `scripts/verifier.js` — NEW: shared verification (test runner + boundary check), used by both Stop and SessionEnd
- `hooks/hooks.json` — MODIFY: add Stop hook entry

**Tasks:**
1. Extract verification logic from session-end.js into shared `verifier.js`
2. Create `claim-detector.js` — pattern matching, debounce state, claim classification
3. Create `stop.js` hook — read assistant message, detect claims, run quick verify
4. Add new ledger event types: `CLAIM_DETECTED`, `CLAIM_VERIFIED`, `CLAIM_FALSIFIED`, `CLAIM_UNVERIFIABLE`
5. Output verification result to stderr (user-visible)
6. Update session state with claim counters
7. Register Stop hook in hooks.json
8. Debounce: skip re-verification within 60s, skip turns with no file changes

### Phase 3: Warning Zone + Risk-Tiered Config

**Goal:** Risk-tiered awareness beyond binary block/allow.

**Files to create/modify:**
- `scripts/hooks/pre-tool-use.js` — MODIFY: add warnFiles logic
- `.agentledger/config.json` — MODIFY: add warnFiles defaults

**Tasks:**
1. Add `warnFiles` array to config schema and defaults
2. PreToolUse: check warnFiles after blockedFiles, emit warning (stderr) + TOOL_WARNED event, exit 0
3. Update session state to track warning count
4. Include warnings in session-end summary and stats.json

### Phase 4: Standalone Skills (Drop CLI Dependency)

**Goal:** All skills work without `agentledger` CLI binary.

**Files to modify:**
- `skills/ledger.md` — REWRITE: inline instructions to read ledger.jsonl
- `skills/verify.md` — REWRITE: inline verification (run tests + git diff)
- `skills/audit.md` — REWRITE: inline risk score from stats.json + ledger
- `skills/handoff.md` — REWRITE: inline handoff doc from ledger events
- `skills/trust.md` — NEW: trust score breakdown + recent false claims

**Tasks:**
1. `/ledger` — instruct Claude to read `.agentledger/ledger.jsonl`, format last 20 events
2. `/verify` — instruct Claude to run test command + git diff, report results
3. `/audit` — instruct Claude to read `stats.json`, compute and display risk report
4. `/handoff` — instruct Claude to read ledger.jsonl, summarize changes, format handoff
5. `/trust` — instruct Claude to read stats.json, show trust breakdown + trend + recent false claims

### Phase 5: Session Transparency Lite (Direction D light)

**Goal:** Lightweight session report, not a standalone product.

**Tasks:**
1. Tool usage breakdown in session-end summary (X reads, Y edits, Z bash calls)
2. Read-before-edit warning in PostToolUse (inline, mid-session)
3. Session report file saved to `.agentledger/reports/{date}-{runId}.md`

---

## 4. File Map — What Changes

```
packages/plugin/
├── hooks/
│   └── hooks.json                  # MODIFY: add Stop hook
├── scripts/
│   ├── hooks/
│   │   ├── session-start.js        # MODIFY: enhanced banner with trust score
│   │   ├── pre-tool-use.js         # MODIFY: add warnFiles logic
│   │   ├── post-tool-use.js        # MODIFY: add Read tracking, counters
│   │   ├── session-end.js          # MODIFY: stats merge, enhanced summary
│   │   └── stop.js                 # NEW: claim detection + instant verification
│   ├── stats.js                    # NEW: persistent stats read/write/merge
│   ├── claim-detector.js           # NEW: claim pattern matching + classification
│   ├── verifier.js                 # NEW: shared verification logic
│   ├── state.js                    # MODIFY: extended session state
│   ├── summary.js                  # MODIFY: new banner format
│   └── server-manager.js           # UNCHANGED
├── skills/
│   ├── ledger.md                   # REWRITE: standalone
│   ├── verify.md                   # REWRITE: standalone
│   ├── audit.md                    # REWRITE: standalone
│   ├── handoff.md                  # REWRITE: standalone
│   └── trust.md                    # NEW
├── __tests__/                      # UPDATE: tests for new modules
└── .agentledger/
    ├── config.json                 # EXTEND: add warnFiles
    ├── ledger.jsonl                # UNCHANGED (new event types appended)
    ├── stats.json                  # NEW: persistent trust metrics
    ├── session.json                # EXTEND: read/edit counters
    └── reports/                    # NEW: session transparency reports
```

---

## 5. Future Work (Not Building Now)

These are deliberately deferred. Only build if traction signals justify them.

### Direction B — CI/CD Agent Guard
- `agentledger-action` GitHub Action wrapping AI steps in CI
- Path boundary enforcement regardless of prompt injection
- Blocks reads of secret-bearing paths
- Ledger artifact attached to workflow runs
- Audit summary as PR comment
- **Trigger:** Security/enterprise interest after Direction A ships

### Direction C — Team AI Governance
- Commit `.agentledger/ledger.jsonl` to repo for shared team history
- `governance.json` — team-wide rules committed to repo, enforced across all devs
- `agentledger replay --since 7d` — "what did AI change while I was away?"
- Cross-teammate handoff briefs
- PR-level AI provenance comments
- Commercial tier opportunity (hosted shared ledger, team management, compliance)
- **Trigger:** Team-usage interest after solo plugin traction

### Direction D — Full Session Transparency
- Complete harness X-ray (tool decisions, token spend, time per task)
- System prompt visibility / injection tracking
- **Status:** Partial implementation in Phase 5 (light version). Full product is adversarial to Anthropic, brittle across releases, audience often already left CC.

### LLM Claim Classification
- Replace keyword matching with lightweight classifier
- Only if false positive rate on keyword matching exceeds 5%
- Could use Haiku for fast, cheap classification

### Multi-Agent Session Tracking
- Track Agent tool spawning subagents
- Correlate subagent actions to parent run
- Separate boundary enforcement per subagent

### Config Profiles / Templates
- Pre-built configs for common stacks (Next.js, Django, Rails, etc.)
- `agentledger init --template nextjs`
- Sensible blockedFiles + warnFiles per stack

### Dashboard Enhancements
- Trust score trend chart over time
- Claim accuracy by type (test claims vs completion claims)
- File risk heatmap
- Session comparison view

---

## 6. Design Decisions

| Decision | Chosen | Rejected | Reason |
|----------|--------|----------|--------|
| Product focus | Plugin-only | CLI orchestrator + plugin | CLI orchestrator adds complexity without traction. Plugin is zero-friction install, works with existing Claude Code workflow. |
| Claim detection | Keyword/regex matching | LLM classifier | Keyword matching is fast (<1ms), free, deterministic. LLM classifier adds latency and cost. Upgrade path exists if false positive rate >5%. |
| Verification timing | Real-time (Stop hook) + session-end | Session-end only | Session-end is too late. User builds on false claims for many turns. Real-time catch is the key differentiator. |
| Stats storage | Flat JSON file | SQLite / ledger-derived | JSON is simple, fast, no dependencies. Stats are derived metrics, not audit trail. Ledger remains source of truth for events. |
| Warning zone | Non-blocking stderr + event | Blocking (same as blockedFiles) | Blocking sensitive-but-not-secret files is too aggressive. Warnings raise awareness without interrupting flow. |
| Skill implementation | Inline instructions in SKILL.md | Shell out to CLI binary | Plugin must be self-contained. CLI dependency breaks standalone install. |
| Trust score denominator | Verified + Falsified only | All claims including unverifiable | Unverifiable claims (no test command) shouldn't penalize or inflate the score. Only count what we can deterministically check. |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Proof of value visibility | 100% sessions show trust score | Banner renders with stats.json |
| Claim detection latency | < 10 seconds | Stop hook execution time |
| Claim detection false positive rate | < 5% | Manual review of CLAIM_DETECTED events |
| Zero CLI dependency | All 5 skills work standalone | Integration test without CLI binary |
| Demo-ready | 30s GIF showing live lie-catch | README demo recording |
| Read:edit tracking | Accurate per-session ratio | PostToolUse event count comparison |
