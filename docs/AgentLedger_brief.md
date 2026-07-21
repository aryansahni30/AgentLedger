# **Project Brief: AgentLedger**

## **Project Name**

**AgentLedger**

## **One-line Description**

**AgentLedger is an open-source coordination framework for AI coding agents, where agents do not freely chat with each other but instead coordinate through an append-only task ledger, git-worktree-isolated ownership boundaries, structured outputs, and verification gates.**

## **Primary Goal**

**This is a portfolio-first project.** The primary audience is engineers and hiring managers who want to see serious AI infrastructure work. Market adoption is a secondary possibility, not the design constraint.

What this means in practice:

- The harness (ledger, isolation, verifier, replay) is the demonstrable engineering. Build it right.
- The planner is a prompt-engineering problem that can improve forever. A mocked or rule-based planner is fine for MVP. Do not restructure phases around planner quality.
- Scripted violation demos are acceptable as test fixtures in early phases. The **public-facing demo GIF/video must be recorded after Phase 7 (real LLM integration)**, using a real model with a temptation-laden prompt — so the claim "it caught a real agent making a real mistake" is true.
- The README must not overclaim. If the planner is mocked, say so. If tool constraints are detection-only, say so. Honest about what's enforced vs. logged is the credibility posture the whole project sells.

## **Core Thesis**

Modern multi-agent systems fail not because the individual models are weak, but because their coordination model is weak.

Most agent frameworks allow agents to coordinate through free-form natural language messages. That creates unverifiable promises, duplicated work, conflicting edits, hidden assumptions, and silent failures. AgentLedger replaces free-form agent collaboration with a structured execution protocol:

**Plan → assign isolated work → record every action → verify outputs → assemble only after checks pass.**

**A note on "deterministic":** the *protocol* is deterministic — the task lifecycle state machine, the ledger append rules, and the verification gate logic always behave the same way given the same events. The *agents* are not deterministic — an LLM planner or worker can produce different plans or patches on different runs. AgentLedger doesn't try to make agent behavior reproducible; it makes the coordination layer around that behavior reliable and replayable. Say this explicitly in the README so it doesn't read as an overclaim.

**A note on positioning relative to existing infra:** durable-execution platforms (e.g. Temporal) already solve deterministic-workflow-plus-nondeterministic-activity orchestration in general, and git worktree isolation is already the standard primitive several coding-agent tools use for parallel execution. AgentLedger is not trying to out-build either of those. It's a narrow, opinionated tool for exactly one job — coordinating multiple coding agents against one repo with enforced ownership boundaries and a verification gate — that you can adopt without standing up a general-purpose workflow engine. Say that in the README too. Framing it as "the coordination layer" for all of multi-agent AI invites an easy "isn't this just X" rebuttal; framing it as the narrow tool invites adoption instead.

This project is inspired by the market gap around deterministic multi-agent scaffolding, immutable shared logs, planner/worker separation, and structured JSON ledgers described in the uploaded AI market-gap document.

---

# **1\. Problem Statement**

AI coding agents and multi-agent systems are becoming powerful, but their execution is still messy.

Current problems:

1. **Agents coordinate through unverifiable text**  
   * Agent A says, "I updated the auth logic."  
   * Agent B trusts it.  
   * But no one verifies the actual diff, test result, or file ownership.  
2. **Agents overwrite or duplicate each other's work**  
   * Multiple agents can touch the same files.  
   * Agents may not know what another agent already changed.  
   * This creates merge conflicts, broken assumptions, and wasted tokens.  
3. **No durable shared state**  
   * A chat transcript is not a reliable execution log.  
   * There is no formal state machine tracking task creation, assignment, execution, verification, and completion.  
4. **Agents claim success without proof**  
   * "Done" does not mean tests passed.  
   * "Implemented" does not mean the diff is safe.  
   * "Fixed" does not mean the bug is actually resolved.  
5. **Multi-agent systems lack engineering discipline**  
   * Human engineering teams use tickets, ownership boundaries, Git diffs, CI checks, logs, and code review.  
   * AI agent teams often use chat.

AgentLedger exists to bring software-engineering discipline to multi-agent execution.

---

# **2\. Vision**

AgentLedger should become a **narrow, trustworthy coordination layer for AI coding agent workflows** — not a general multi-agent framework, and not a durable-execution platform. It should sit on top of a single repo, use git itself as the isolation primitive, and stay small enough that adopting it doesn't mean replacing your existing agent stack.

It is not trying to be another generic agent framework. It should work with existing models and agent systems.

The long-term vision:

Developers should be able to give a complex task to multiple agents and trust that the system will decompose the work, assign ownership, record every action, physically isolate each agent's changes, verify outputs, and produce a replayable execution trace.

AgentLedger should eventually feel like:

* **GitHub Issues** for task structure  
* **Git worktrees** for physical workspace isolation  
* **CI/CD** for verification  
* **Event sourcing** for agent execution history  
* **Audit log** for every agent decision and tool action

---

# **3\. Target User**

Primary target user:

Developers building AI agent workflows who want reliability, traceability, and verification.

Secondary users:

* AI infra engineers  
* DevTools builders  
* Open-source agent framework users  
* Recruiters/hiring managers reviewing a serious AI infrastructure project  
* Engineers experimenting with multi-agent coding systems  
* Teams using Cursor, Claude Code, Codex, LangGraph, CrewAI, AutoGen, or custom agents

---

# **4\. What AgentLedger Is**

AgentLedger is a framework/runtime that coordinates agents through structured state.

It has four core pieces for v1 (MVP):

1. **Planner** — Converts a user request into a task graph.  
2. **Ledger** — Append-only event log of everything that happens.  
3. **Workers** — Agents that receive isolated tasks, each executing inside its own git worktree, and produce structured outputs.  
4. **Verifier** — Runs boundary checks and commands before accepting work.

**Visualizer is explicitly post-MVP** (see Section 15, Stretch Features). Do not build it until Phases 1–5 are working. Listing it as a fifth core piece here previously contradicted the "CLI first" MVP goal below — it's stretch, full stop.

---

# **5\. What AgentLedger Is Not**

AgentLedger is not:

* A chatbot  
* A generic wrapper around OpenAI/Anthropic  
* A replacement for LangGraph/CrewAI/AutoGen  
* A replacement for general-purpose durable execution platforms (e.g. Temporal) — it's narrower, coding-agent-specific, and repo-native  
* A prompt marketplace  
* A code-generation-only tool  
* A fully autonomous production deployment tool in v1

AgentLedger is specifically:

**A coordination and verification layer for AI coding agent execution, built on git-native isolation.**

---

# **6\. MVP Goal**

Build an MVP that demonstrates this workflow:

User gives a coding task  
    ↓  
Planner creates structured task graph  
    ↓  
Tasks are written to an append-only ledger  
    ↓  
Worker agents execute isolated tasks, each in its own git worktree/branch  
    ↓  
Each worker writes actions/results to the ledger  
    ↓  
Verifier runs boundary + command checks  
    ↓  
Failed work is rejected or retried  
    ↓  
Successful work is merged into final output  
    ↓  
Developer can inspect the full execution trace

The MVP should be usable from a CLI first. A visual UI can come after the core engine is working.

**Execution model for MVP:** workers run **sequentially**, respecting the task dependency graph. This matches the "keep the first version deterministic" principle in Section 18, and avoids the concurrent-ledger-write problem entirely for v1 (see Section 8.2a). Parallel worker execution is a named stretch feature (Section 15) with its own concurrency design, not an MVP assumption — the architecture diagram in Section 19 shows parallel workers converging on one ledger; treat that as the target end-state, not the v1 build.

---

# **7\. First Demo Scenario**

Build **two** demo scenarios. The first alone doesn't prove the thesis — a task this small is something a single coding agent handles correctly unassisted, so running it through a full planner/worker/verifier pipeline looks like unjustified ceremony. The second scenario is what actually demonstrates the value of the harness, and it should be the one you lead with in the README and any demo video.

## **7.1 Happy path (mechanism walkthrough)**

“Given a small TypeScript repo and a GitHub-style issue, AgentLedger decomposes the work into isolated tasks, assigns each task to a worker, records every action in a ledger, runs verification checks, and produces a final patch only if all checks pass.”

Example user request:

Add email validation to the signup form, add tests, and make sure no payment or auth logic is changed.

Use this to show the mechanism end to end. It is not the proof of value — it's the tutorial.

## **7.2 Unhappy path (proof of value) — required for MVP**

This is the scenario that actually justifies the project. Build a demo repo where:

* One task's worker is deliberately prompted (or scripted, for a fully mocked MVP) to touch a **blocked file** (e.g. edits `src/lib/payments.ts` while implementing the signup form change). AgentLedger's verifier must catch this, emit a `BOUNDARY_VIOLATION` event, and reject the patch — show this rejection in the CLI output.  
* A second task's worker produces a patch that **passes its own self-report** ("tests pass") but the actual `npm test` run **fails**. The verifier must catch the discrepancy and emit `VERIFICATION_FAILED` with the real stdout/stderr, not the worker's claim.

Record both of these in the demo GIF/video. "It caught a lie" and "it blocked a boundary violation" are the two moments that prove software-engineering discipline is actually being enforced, not just logged.

---

# **8\. Core Design Principles**

## **8.1 No free-form agent-to-agent chat**

Agents should not directly chat with each other.

They communicate only through structured ledger events.

Bad:

Worker A: I think I fixed the issue.  
Worker B: Great, I'll continue from there.

Good:

{  
  "event\_type": "PATCH\_PROPOSED",  
  "task\_id": "task\_signup\_validation",  
  "actor": "worker\_frontend",  
  "artifact\_path": "patches/task\_signup\_validation.patch",  
  "files\_modified": \["src/components/SignupForm.tsx"\],  
  "status": "awaiting\_verification"  
}

## **8.2 Every action must be recorded**

No invisible state.

Every meaningful action should become a ledger event:

* Task created  
* Task assigned  
* Context read  
* Tool called  
* File edited  
* Patch proposed  
* Verification passed  
* Verification failed  
* Human approval requested  
* Task completed

## **8.2a Ledger write model (new — was previously undefined)**

The MVP ledger is a single JSONL file with a single writer: the orchestrator process appends events on behalf of workers (workers return structured results to the orchestrator; they do not write to the ledger file directly). This sidesteps concurrent-write/file-locking issues entirely for v1, since MVP workers execute sequentially (Section 6).

**Hash chaining is required in MVP, not optional.** It's cheap (a rolling SHA-256 of `previous_hash + serialized event payload`) and it's the difference between "structured log" and the "immutable audit log" the project claims to be. Don't ship the "immutable" pitch without it — either implement the hash chain or drop the immutability language from the README until you do.

If/when parallel worker execution ships (Section 15), the write model needs to change to an append queue or per-worker staging files merged by the orchestrator — design that at that point, not now.

## **8.3 Ownership boundaries are mandatory and physically enforced**

Each task should define:

* Allowed files  
* Blocked files  
* Allowed tools (audit/detection only — see note below)  
* Dependencies  
* Expected output schema  
* Success criteria

**Enforcement mechanism (new — was previously just a post-hoc diff check):** each worker executes inside its own **git worktree**, checked out on its own branch, scoped via `git sparse-checkout` to the task's `allowed_files` where practical. This is the actual "isolation" the project name promises — a worker literally cannot touch files it doesn't have checked out, rather than being trusted not to and then checked afterward.

The verifier still runs a second, independent check after the worker finishes (diff the branch against `allowed_files`/`blocked_files`) as defense in depth — worktree scoping can be imperfect (e.g. a worker with shell access could still write outside its sparse-checkout in some edge cases), so don't rely on the worktree alone. Both layers are required:

1. **Prevention** — git worktree + sparse-checkout constrains what the worker can physically write to.  
2. **Detection** — verifier diffs the resulting branch against the task's declared boundaries before merge.

**A note on `allowedTools`:** file boundary enforcement has two real layers (prevent + detect). Tool constraints do not. Any LLM worker with shell access can call tools outside its declared `allowedTools` list — there is no technical mechanism to prevent this at the worker level. `allowedTools` is therefore **detection/audit only**: the verifier checks what tools were actually called (via ledger events) against what was declared, and logs violations. Do not claim tool constraints are enforced in the same sense that file boundaries are enforced. Be explicit about this distinction in the README.

## **8.4 Verification beats self-reporting**

An agent cannot mark its own work as complete without verification.

Completion requires:

* Required output exists  
* Schema is valid  
* File boundaries are respected (worktree diff, see 8.3)  
* Tests/checks pass — **actual command exit codes, never the worker's self-reported status**  
* Dependencies are satisfied

## **8.5 Replayability matters**

The system should be able to replay the ledger and reconstruct:

* What happened  
* In what order  
* Which agent did what  
* What failed  
* What passed  
* Why the final result was accepted or rejected

Note: "replay" means reconstructing state from the event log, not re-running agents to get an identical result — see the determinism note in the Core Thesis section.

---

# **9\. MVP Features**

## **Feature 1: CLI**

Build a CLI called `agentledger`.

Example commands:

agentledger init  
agentledger run "Add email validation to signup form and tests"  
agentledger ledger view  
agentledger tasks view  
agentledger verify  
agentledger replay

Initial CLI commands:

### **`agentledger init`**

Creates config and local project structure:

.agentledger/  
  config.json  
  ledger.jsonl  
  tasks.json  
  artifacts/  
  patches/  
  worktrees/  
  runs/

(Added `worktrees/` — where per-task git worktrees live during a run.)

### **`agentledger run "<request>"`**

Starts a new run.

### **`agentledger ledger view`**

Prints ledger events.

### **`agentledger tasks view`**

Shows task graph/status.

### **`agentledger verify`**

Runs verification checks.

### **`agentledger replay`**

Reconstructs run state from ledger.

---

## **Feature 2: Intent Intake**

The system accepts a user request and converts it into a structured execution intent.

Example:

{  
  "run\_id": "run\_001",  
  "goal": "Add email validation to signup form and tests",  
  "constraints": \[  
    "Do not modify payment logic",  
    "Do not modify authentication provider logic",  
    "Use existing project style"  
  \],  
  "success\_criteria": \[  
    "Invalid emails are rejected",  
    "Valid emails pass",  
    "Tests pass",  
    "Only allowed files are modified"  
  \],  
  "risk\_level": "medium"  
}

For MVP, this can be generated by an LLM or manually mocked with simple structured parsing.

---

## **Feature 3: Planner**

The planner turns the intent into a task graph.

Example task:

{  
  "task\_id": "task\_001",  
  "title": "Inspect signup form implementation",  
  "description": "Find the signup form component and understand the current validation logic.",  
  "owner": "worker\_inspector",  
  "dependencies": \[\],  
  "allowed\_files": \["src/\*\*"\],  
  "blocked\_files": \[\],  
  "allowed\_tools": \["read\_file", "list\_files", "grep"\],  
  "expected\_outputs": \["relevant\_files", "summary"\],  
  "success\_criteria": \[  
    "Identify signup form file",  
    "Identify existing validation behavior"  
  \],  
  "status": "pending"  
}

Another task:

{  
  "task\_id": "task\_002",  
  "title": "Implement email validation",  
  "description": "Add email validation to the signup form using existing project patterns.",  
  "owner": "worker\_frontend",  
  "dependencies": \["task\_001"\],  
  "allowed\_files": \[  
    "src/components/SignupForm.tsx",  
    "src/utils/validation.ts"  
  \],  
  "blocked\_files": \[  
    "src/lib/payments.ts",  
    "src/lib/authProvider.ts"  
  \],  
  "allowed\_tools": \["read\_file", "edit\_file", "run\_tests"\],  
  "expected\_outputs": \["patch", "implementation\_notes"\],  
  "success\_criteria": \[  
    "Invalid email shows an error",  
    "Valid email allows submission",  
    "No blocked files are modified"  
  \],  
  "status": "pending"  
}

---

## **Feature 4: Append-only Ledger**

The ledger is the heart of the system.

Use a JSONL file for MVP.

Path:

.agentledger/ledger.jsonl

Each line is one immutable event. **Single writer (the orchestrator), hash-chained (see 8.2a).**

Base event schema:

type LedgerEvent \= {  
  event\_id: string;  
  run\_id: string;  
  task\_id?: string;  
  timestamp: string;  
  actor: string;  
  event\_type: LedgerEventType;  
  payload: Record\<string, unknown\>;  
  hash: string;  
  previous\_hash: string;  
};

(`hash` and `previous_hash` are now required fields, not optional — see 8.2a.)

Event types:

type LedgerEventType \=  
  | "RUN\_CREATED"  
  | "INTENT\_COMPILED"  
  | "TASK\_CREATED"  
  | "TASK\_ASSIGNED"  
  | "TASK\_STARTED"  
  | "WORKTREE\_CREATED"  
  | "CONTEXT\_READ"  
  | "TOOL\_CALLED"  
  | "FILE\_EDIT\_PROPOSED"  
  | "PATCH\_PROPOSED"  
  | "VERIFICATION\_STARTED"  
  | "VERIFICATION\_PASSED"  
  | "VERIFICATION\_FAILED"  
  | "BOUNDARY\_VIOLATION"  
  | "HUMAN\_APPROVAL\_REQUESTED"  
  | "TASK\_COMPLETED"  
  | "TASK\_FAILED"  
  | "RUN\_COMPLETED"  
  | "RUN\_FAILED";

(Added `WORKTREE_CREATED` to log which branch/worktree backs each task — needed for the replay trace to show physical isolation, not just logical ownership.)

Example ledger event:

{  
  "event\_id": "evt\_0007",  
  "run\_id": "run\_001",  
  "task\_id": "task\_002",  
  "timestamp": "2026-07-02T10:30:00Z",  
  "actor": "worker\_frontend",  
  "event\_type": "PATCH\_PROPOSED",  
  "payload": {  
    "files\_modified": \["src/components/SignupForm.tsx"\],  
    "patch\_path": ".agentledger/patches/task\_002.patch",  
    "worktree\_branch": "agentledger/task\_002",  
    "summary": "Added email validation and inline error message."  
  },  
  "previous\_hash": "abc123",  
  "hash": "def456"  
}

---

## **Feature 5: Worker Execution**

A worker executes exactly one task at a time, **inside its own git worktree checked out on a dedicated branch** (`agentledger/{task_id}`).

Each worker receives:

{  
  "task": {},  
  "relevant\_context": {},  
  "worktree\_path": "",  
  "allowed\_files": \[\],  
  "blocked\_files": \[\],  
  "allowed\_tools": \[\],  
  "output\_schema": {}  
}

Rules:

* Worker cannot directly communicate with another worker.  
* Worker operates inside its own worktree; it cannot see or modify files outside it.  
* Worker must write output in structured format.  
* Worker must emit ledger events for each meaningful action (via the orchestrator — see 8.2a).

For MVP, workers can be simulated as function calls using one LLM provider, executing sequentially.

Later, support:

* OpenAI  
* Anthropic  
* local models  
* Cursor/Codex adapter  
* LangGraph adapter  
* CrewAI adapter

---

## **Feature 6: Boundary Enforcement**

Two layers (see 8.3):

**Prevention (during execution):**

* Worker's worktree is scoped to `allowed_files` via sparse-checkout where practical.

**Detection (before merge):**

* Did worker modify only allowed files? (diff the task branch)  
* Did worker avoid blocked files?  
* Did worker use only allowed tools?  
* Did worker satisfy output schema?  
* Did worker touch files owned by another task?  
* Did worker create unexpected side effects?

Example boundary violation event:

{  
  "event\_type": "BOUNDARY\_VIOLATION",  
  "actor": "verifier",  
  "task\_id": "task\_002",  
  "payload": {  
    "violation\_type": "BLOCKED\_FILE\_MODIFIED",  
    "file": "src/lib/payments.ts",  
    "message": "Worker attempted to modify a blocked file."  
  }  
}

---

## **Feature 7: Verification Layer**

Verification should be pluggable.

Initial verification checks:

{  
  "checks": \[  
    {  
      "name": "typecheck",  
      "command": "npm run typecheck"  
    },  
    {  
      "name": "test",  
      "command": "npm test"  
    },  
    {  
      "name": "lint",  
      "command": "npm run lint"  
    }  
  \]  
}

Config example:

{  
  "verification": {  
    "commands": {  
      "typecheck": "npm run typecheck",  
      "test": "npm test",  
      "lint": "npm run lint"  
    },  
    "required": \["typecheck", "test"\]  
  }  
}

Verification result event:

{  
  "event\_type": "VERIFICATION\_FAILED",  
  "actor": "verifier",  
  "task\_id": "task\_002",  
  "payload": {  
    "check": "test",  
    "exit\_code": 1,  
    "stdout": "...",  
    "stderr": "...",  
    "summary": "Email validation test failed for empty input."  
  }  
}

---

# **10\. Suggested Tech Stack**

Use a stack that is impressive but not overcomplicated.

## **Core**

* **TypeScript**  
* **Node.js**  
* **pnpm**  
* **Zod** for schemas  
* **Commander.js** or **oclif** for CLI  
* **simple-git** or direct `git` shell-outs for worktree management  
* **JSONL file ledger** for MVP (single-writer, hash-chained)  
* **SQLite** later  
* **React \+ Vite** later for visualizer  
* **Vitest** for tests

## **Optional later**

* SQLite/Postgres persistence  
* OpenTelemetry traces  
* GitHub Actions integration  
* Parallel worker execution with a real ledger-write concurrency model  
* LangGraph adapter  
* CrewAI adapter  
* MCP tool gateway  
* Web dashboard

Recommended repo structure:

agentledger/  
  packages/  
    core/  
      src/  
        ledger/  
        planner/  
        worker/  
        verifier/  
        replay/  
        schemas/  
        git/  
    cli/  
      src/  
        commands/  
        index.ts  
    examples/  
      todo-app/  
      github-issue-runner/  
    visualizer/  
      src/  
  .agentledger/  
  docs/  
    vision.md  
    architecture.md  
    mvp.md  
    examples.md  
  README.md  
  package.json  
  pnpm-workspace.yaml

(Added `core/src/git/` — the worktree management module.)

---

# **11\. Core Modules**

## **`core/ledger`**

Responsibilities:

* Append events (single writer)  
* Compute and verify hash chain  
* Read events  
* Validate event schema  
* Replay state from events  
* Query by run/task/event type

Main functions:

appendEvent(event: LedgerEvent): Promise\<void\>  
readEvents(runId?: string): Promise\<LedgerEvent\[\]\>  
getTaskEvents(taskId: string): Promise\<LedgerEvent\[\]\>  
replayRun(runId: string): Promise\<RunState\>  
verifyChain(runId: string): Promise\<boolean\>

---

## **`core/git` (new module)**

Responsibilities:

* Create a worktree + branch per task, scoped via sparse-checkout to `allowed_files`  
* Tear down worktrees after task completion  
* Diff a task's branch against `allowed_files`/`blocked_files` for the verifier  
* Merge accepted task branches into the run's output branch, sequentially

Main functions:

createTaskWorktree(task: AgentTask): Promise\<WorktreeHandle\>  
diffWorktree(handle: WorktreeHandle): Promise\<string\[\]\>  
mergeTaskBranch(handle: WorktreeHandle, targetBranch: string): Promise\<void\>  
cleanupWorktree(handle: WorktreeHandle): Promise\<void\>

---

## **`core/planner`**

Responsibilities:

* Convert intent into task graph  
* Validate dependencies  
* Prevent overlapping ownership where possible  
* Write `TASK_CREATED` events

Main functions:

createPlan(intent: IntentContract): Promise\<TaskGraph\>  
validateTaskGraph(taskGraph: TaskGraph): ValidationResult

---

## **`core/worker`**

Responsibilities:

* Execute task inside its assigned worktree  
* Read allowed context  
* Use allowed tools  
* Produce structured output  
* Return results to the orchestrator for ledger recording

Main functions:

runWorker(task: AgentTask, context: WorkerContext, worktree: WorktreeHandle): Promise\<WorkerResult\>

---

## **`core/verifier`**

Responsibilities:

* Check boundaries (worktree diff)  
* Run configured commands  
* Validate output schemas  
* Accept/reject patches  
* Emit verification events

Main functions:

verifyTask(task: AgentTask, result: WorkerResult, worktree: WorktreeHandle): Promise\<VerificationResult\>  
checkFileBoundaries(task: AgentTask, modifiedFiles: string\[\]): BoundaryCheckResult  
runVerificationCommands(commands: VerificationCommand\[\]): Promise\<CommandResult\[\]\>

---

## **`core/replay`**

Responsibilities:

* Replay ledger events  
* Reconstruct task states  
* Reconstruct run status  
* Detect invalid transitions

Main functions:

replayLedger(events: LedgerEvent\[\]): RunState  
getTaskState(taskId: string): TaskState  
getRunSummary(runId: string): RunSummary

---

# **12\. Data Models**

## **Intent Contract**

type IntentContract \= {  
  runId: string;  
  goal: string;  
  constraints: string\[\];  
  successCriteria: string\[\];  
  riskLevel: "low" | "medium" | "high";  
  budget?: {  
    maxTokens?: number;  
    maxUsd?: number;  
    maxToolCalls?: number;  
  };  
  approvalRequiredFor?: string\[\];  
};

## **Task**

type AgentTask \= {  
  taskId: string;  
  runId: string;  
  title: string;  
  description: string;  
  owner: string;  
  dependencies: string\[\];  
  allowedFiles: string\[\];  
  blockedFiles: string\[\];  
  allowedTools: string\[\];  
  expectedOutputs: string\[\];  
  successCriteria: string\[\];  
  status:  
    | "pending"  
    | "assigned"  
    | "running"  
    | "awaiting\_verification"  
    | "completed"  
    | "failed";  
};

## **Task Graph**

type TaskGraph \= {  
  runId: string;  
  tasks: AgentTask\[\];  
};

## **Worker Result**

type WorkerResult \= {  
  taskId: string;  
  summary: string;  
  filesRead: string\[\];  
  filesModified: string\[\];  
  patchPath?: string;  
  worktreeBranch: string;  
  output: Record\<string, unknown\>;  
};

## **Verification Result**

type VerificationResult \= {  
  taskId: string;  
  passed: boolean;  
  boundaryCheck: {  
    passed: boolean;  
    violations: string\[\];  
  };  
  commandResults: {  
    name: string;  
    command: string;  
    exitCode: number;  
    stdout: string;  
    stderr: string;  
  }\[\];  
};

---

# **13\. State Machine**

Each task should follow this lifecycle:

pending  
  ↓  
assigned  
  ↓  
running  
  ↓  
awaiting\_verification  
  ↓  
completed

Failure path:

running  
  ↓  
failed

Verification failure path:

awaiting\_verification  
  ↓  
failed

Retry path can be added later:

failed  
  ↓  
pending

Run lifecycle:

created  
  ↓  
planning  
  ↓  
executing  
  ↓  
verifying  
  ↓  
completed

Failure:

created/planning/executing/verifying  
  ↓  
failed

---

# **14\. MVP Acceptance Criteria**

The MVP is complete when:

1. User can run:

agentledger run "Add email validation to signup form and tests"

2. The system creates:  
   * Intent contract  
   * Task graph  
   * Ledger events (hash-chained)  
   * Per-task git worktrees  
   * Worker outputs  
   * Verification results  
3. The ledger is stored as JSONL, single-writer, hash-chained.  
4. The system can replay the ledger and reconstruct run state.  
5. The verifier can detect:  
   * Blocked file modification (both via worktree scoping and post-hoc diff)  
   * Failed command  
   * Invalid task output  
6. **The unhappy-path demo (Section 7.2) runs and correctly rejects both the boundary violation and the false self-report.**  
7. The final summary shows:  
   * Tasks completed  
   * Tasks failed  
   * Files modified  
   * Verification results  
   * Final status

Example final output:

AgentLedger Run Summary

Run: run\_001  
Goal: Add email validation to signup form and tests

Tasks:  
✓ task\_001 Inspect signup form  
✓ task\_002 Implement validation  
✓ task\_003 Add tests  
✓ task\_004 Run verification

Modified files:  
\- src/components/SignupForm.tsx  
\- src/utils/validation.ts  
\- src/components/SignupForm.test.tsx

Verification:  
✓ typecheck passed  
✓ tests passed  
✓ boundary checks passed

Final status: COMPLETED

---

# **15\. Stretch Features**

Do not build these first, but design with them in mind.

## **Visual Dashboard**

A web UI showing:

* Task graph  
* Event timeline  
* Worker activity  
* Verification results  
* File diffs  
* Replay view

## **Parallel Worker Execution**

Move from sequential (MVP) to concurrent worker execution. Requires:

* A real ledger write-concurrency model (append queue, or per-worker staging files merged by the orchestrator)  
* Confirming worktree isolation holds under concurrent git operations on a shared object store

## **GitHub Integration**

AgentLedger can:

* Read a GitHub issue  
* Run a workflow  
* Open a PR  
* Attach ledger summary to PR  
* Add verification report as a comment

## **Agent Adapters**

Support (prioritize an MCP/A2A-compatible adapter layer over one-off integrations where possible, rather than hand-building a bespoke adapter per framework):

* OpenAI  
* Anthropic  
* local models  
* LangGraph  
* CrewAI  
* AutoGen  
* Claude Code  
* Codex  
* Cursor

## **Human Approval Gates**

For risky steps:

{  
  "approval\_required\_for": \[  
    "database\_migration",  
    "production\_deploy",  
    "payment\_logic\_change"  
  \]  
}

## **Cost and Loop Protection**

Later integrate:

* Token budget per run  
* Max tool calls per task  
* Loop detection  
* Repeated failed tool-call detection  
* Automatic pause

This can connect to the future **AgentBrake** idea.

---

# **16\. README Positioning**

The README should start like this:

\# AgentLedger

Coordination for AI coding agents, with git-native isolation and a verification gate.

AgentLedger is an open-source harness for multi-agent coding workflows where agents coordinate through an append-only task ledger instead of free-form chat, and where each agent's changes are physically isolated in its own git worktree until they pass verification.

Modern AI coding agents are powerful, but multi-agent execution is unreliable. Agents duplicate work, overwrite each other, make unverifiable claims, and fail without clear traces.

AgentLedger brings software-engineering discipline to agent workflows:

\- Planner/worker separation  
\- Append-only, hash-chained execution ledger  
\- Git-worktree-isolated task ownership boundaries  
\- Structured JSON outputs  
\- CI-style verification (real exit codes, not self-reports)  
\- Replayable traces

**Why not just use \[Temporal / a worktree-based coding tool\]?** Add a short FAQ section here once the tool exists — answer honestly: those tools are more general and more mature; AgentLedger is narrower, coding-agent-specific, and meant to be adopted in an afternoon without standing up a workflow platform. Don't let someone else ask this question first in your issue tracker.

---

# **16b\. Pre-Build FAQ (Write Before Coding)**

Write these answers in the README before building, not after. These are the questions you will get in issue threads and interviews. Having the answers written forces you to know your differentiation, and having them in the README means you don't improvise them under pressure.

## **"Isn't this just a fancy pre-commit hook?"**

No. A pre-commit hook checks one commit with no task context. AgentLedger's verifier checks against a **per-task ownership contract** — a declared set of allowed files, blocked files, and success criteria scoped to a specific piece of work — and validates across **cross-task boundaries** (did any task touch files owned by another task?), the **original intent** (did the output satisfy the run's success criteria?), and produces a **replayable trace** of every agent action that led to the result. A pre-commit hook knows nothing about which agent made a change, why, or whether it violated a higher-level constraint. AgentLedger does.

## **"Why not Temporal / a durable execution platform?"**

Temporal is more general and more mature. It solves deterministic-workflow-plus-nondeterministic-activity orchestration for any domain. AgentLedger is narrower: it's specifically a coordination layer for multiple coding agents against one repo, using git as the isolation primitive. You can adopt AgentLedger in an afternoon without standing up a workflow platform, registering workers, or learning a new execution model. If you're already on Temporal, AgentLedger's concepts (ledger, ownership boundaries, verification gate) could complement it — but that's not the target user.

## **"Why not LangGraph / CrewAI / AutoGen?"**

Those are agent orchestration frameworks — they let you wire agents together, share memory, and define graph-based workflows. AgentLedger doesn't compete with them; it's a coordination protocol that sits on top of whatever agents you're running. A LangGraph graph could be a worker inside AgentLedger. The difference: those frameworks don't enforce ownership boundaries, don't physically isolate agent workspaces in git, and don't require verification before accepting work. AgentLedger adds exactly those three things, and nothing else.

## **"Isn't the planner just an LLM prompt? What's novel there?"**

Yes, and we're not claiming the planner is novel. The harness is the engineering contribution: the append-only hash-chained ledger, git-worktree-isolated task ownership, and the verification gate that rejects self-reported success. The planner is a prompt-engineering problem that improves forever. AgentLedger's thesis is that even a mediocre planner produces reliable results if the harness around it enforces boundaries and verifies outputs — and a good planner with no harness still produces unreliable results.

## **"What's actually enforced vs. just logged?"**

Be explicit:

| Constraint | Enforced | Detected/Logged |
|---|---|---|
| File boundaries (`allowedFiles`) | Yes — git sparse-checkout (imperfect) | Yes — verifier diff (authoritative) |
| Blocked files (`blockedFiles`) | Partially — sparse-checkout exclusion | Yes — verifier diff (authoritative) |
| Tool constraints (`allowedTools`) | No | Yes — ledger events audited post-hoc |
| Output schema | Yes — Zod validation before merge | Yes — logged in ledger |
| Command checks (tests, lint, typecheck) | Yes — real exit codes, not self-reports | Yes — stdout/stderr in ledger |

Honest about the table is the credibility posture. Don't hide the "No" in the enforcement column.

---

# **17\. First Build Plan**

## **Phase 1: Core skeleton**

Build:

* Monorepo setup  
* TypeScript config  
* CLI skeleton  
* Zod schemas  
* Ledger writer/reader with hash chaining  
* Basic event append

## **Phase 2: Task graph**

Build:

* Intent contract schema  
* Task schema  
* Static planner  
* Task graph validation  
* Task events written to ledger

## **Phase 3: Worker execution + git isolation**

Build:

* Git worktree creation/teardown per task  
* Mock worker execution inside a worktree  
* Structured worker result  
* File read/edit simulation  
* Patch artifact generation

## **Phase 4: Verifier**

Build:

* Boundary checker (worktree diff)  
* Command runner  
* Verification events  
* Final run summary

## **Phase 5: Replay**

Build:

* Ledger replay  
* Hash chain verification  
* Run state reconstruction  
* Task status reconstruction  
* CLI summary

## **Phase 6: Unhappy-path demo (internal/test fixtures)**

Build:

* The boundary-violation demo scenario (Section 7.2) as a **scripted test fixture** — a deterministic mock worker that attempts to touch a blocked file. This is for test coverage, not the public demo.
* The false-self-report demo scenario (Section 7.2) as a **scripted test fixture** — a mock worker that claims success with a failing exit code.
* Verify both are caught and emitted correctly in the CLI output.

**Do not record the public-facing demo GIF here.** Scripted violations prove the harness works against scripted inputs, which a technical reviewer will spot. The public demo is recorded in Phase 7.

## **Phase 7: Real LLM integration + public demo**

Add:

* OpenAI or Anthropic adapter  
* Planner prompt  
* Worker prompt  
* Structured output validation  
* Retry on invalid schema

**Record the public demo GIF/video here**, after real LLM integration is working. Use a deliberately temptation-laden prompt — a task where the "easy" fix touches a blocked file, so a real model is likely to attempt it. When the verifier catches it, that's the money shot: a real agent making a real mistake, caught by the harness. This is the difference between "shows the mechanism" and "proves the mechanism works against real model behavior."

---

# **18\. Important Implementation Notes**

## **Keep the first version deterministic where it matters**

For MVP, it is okay if the planner is rule-based or mocked, and workers execute sequentially rather than in parallel.

The value is not that an LLM makes the perfect plan. The value is the harness:

* Ledger (hash-chained, single-writer)  
* Boundaries (worktree-isolated, then verified)  
* Verification (real exit codes)  
* Replay

## **Avoid building too many integrations early**

Do not start with GitHub, Vercel, Slack, LangGraph, and full UI.

Start with:

local repo \+ CLI \+ git worktrees \+ JSONL ledger \+ verification

## **Make the demo polished — and make it prove something**

This project is for open-source credibility and recruiter visibility. The demo matters, and the unhappy-path demo (Section 7.2) matters more than the happy-path one — it's the difference between "shows the mechanism" and "proves the mechanism catches real problems."

Prioritize:

* Clean README (with the "why not X" FAQ)  
* Architecture diagram  
* CLI demo GIF/video — lead with the boundary-violation catch, not the green checkmarks  
* Example repo  
* Failure example  
* Clear docs

---

# **19\. Example Architecture Diagram**

               ┌────────────────────┐  
                │   User Request      │  
                └─────────┬──────────┘  
                          │  
                          ▼  
                ┌────────────────────┐  
                │  Intent Contract    │  
                └─────────┬──────────┘  
                          │  
                          ▼  
                ┌────────────────────┐  
                │   Planner Agent     │  
                └─────────┬──────────┘  
                          │  
                          ▼  
                ┌────────────────────┐  
                │    Task Graph       │  
                └─────────┬──────────┘  
                          │  
          ┌───────────────┼────────────────┐  
          ▼               ▼                ▼  
 ┌────────────────┐ ┌────────────────┐ ┌────────────────┐  
 │ Worker A        │ │ Worker B        │ │ Worker C        │  
 │ (own worktree)  │ │ (own worktree)  │ │ (own worktree)  │  
 └───────┬────────┘ └───────┬────────┘ └───────┬────────┘  
         │                  │                  │  
         └──────────┬───────┴──────────┬───────┘  
                    ▼                  ▼  
          ┌─────────────────────────────────┐  
          │  Append-only Agent Ledger        │  
          │  (single-writer, hash-chained)   │  
          └────────────────┬────────────────┘  
                           │  
                           ▼  
                 ┌──────────────────┐  
                 │     Verifier      │  
                 │ (worktree diff +  │  
                 │  command checks)  │  
                 └────────┬─────────┘  
                          │  
                          ▼  
                 ┌──────────────────┐  
                 │   Final Output    │  
                 └──────────────────┘

**Note:** this diagram shows the target end-state with parallel workers. The MVP (Phases 1–6) runs workers sequentially against this same architecture — parallelism is a stretch feature (Section 15) layered on afterward, not a v1 assumption.

---

# **20\. Final Instruction for Coding Agent**

Build **AgentLedger** as a TypeScript monorepo with a CLI-first MVP.

The first version should prove the core concept:

A multi-agent coding workflow can be made more reliable when agents coordinate through structured ledger events, git-worktree-isolated ownership boundaries, and verification gates instead of free-form chat and self-reported completion — and that this is demonstrably true, not just architecturally plausible, via the unhappy-path demo in Section 7.2.

Prioritize correctness, clean architecture, strong schemas, and a polished demo (including a failure case) over breadth of integrations, parallelism, or a UI. The MVP should be small but impressive. Build in the phase order in Section 17 — do not skip ahead to Phase 6/7 (real LLM integration, parallel execution) before Phases 1–5 (skeleton, ledger, worktree isolation, verifier, replay) are solid, since the harness is the point, not the LLM calls.
