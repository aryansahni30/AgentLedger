/**
 * Injects a realistic multi-task demo run into the ledger
 * so the visualizer has something interesting to display
 * without needing an LLM API key.
 */
import { LedgerWriter } from "./packages/core/dist/index.js";
import { randomUUID } from "crypto";
import { join } from "path";

const targetDir = "./packages/examples/demo-repo";
const ledgerPath = join(targetDir, ".agentledger", "ledger.jsonl");
const writer = new LedgerWriter(ledgerPath);

const runId = randomUUID();
const operator = process.env["USER"] ?? process.env["USERNAME"] ?? "aryansahni";

const task1 = `task-${randomUUID().slice(0, 8)}`;
const task2 = `task-${randomUUID().slice(0, 8)}`;
const task3 = `task-${randomUUID().slice(0, 8)}`;

function evt(overrides) {
  return {
    event_id: randomUUID(),
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    payload: {},
    ...overrides,
  };
}

console.log(`Seeding run ${runId} (operator: ${operator}) …`);

const events = [
  // ── Run created ──────────────────────────────────────────────────────────────
  evt({
    event_type: "RUN_CREATED",
    payload: {
      goal: "add in-memory cache + hello-world util to src/app.ts and add auth middleware",
      riskLevel: "medium",
      operator,
    },
  }),
  evt({ event_type: "INTENT_COMPILED", payload: { taskCount: 3 } }),

  // ── Tasks planned ─────────────────────────────────────────────────────────
  evt({
    task_id: task1,
    event_type: "TASK_CREATED",
    payload: {
      taskId: task1,
      title: "Add in-memory cache to src/db.ts",
      description: "Wrap queryUser with a simple Map-based LRU cache keyed by userId.",
      owner: "worker-dev",
      dependencies: [],
      allowedFiles: ["src/db.ts"],
      blockedFiles: ["**/.env", "**/secrets/**"],
      allowedTools: ["read_file", "write_file", "task_complete"],
    },
  }),
  evt({
    task_id: task2,
    event_type: "TASK_CREATED",
    payload: {
      taskId: task2,
      title: "Add helloWorld utility to src/app.ts",
      description: "Export a helloWorld(name: string): string function.",
      owner: "worker-dev",
      dependencies: [task1],
      allowedFiles: ["src/app.ts"],
      blockedFiles: ["**/.env", "**/secrets/**"],
      allowedTools: ["read_file", "write_file", "task_complete"],
    },
  }),
  evt({
    task_id: task3,
    event_type: "TASK_CREATED",
    payload: {
      taskId: task3,
      title: "Add auth middleware to src/auth.ts",
      description: "Create src/auth.ts with a JWT verify middleware.",
      owner: "worker-security",
      dependencies: [task1],
      allowedFiles: ["src/auth.ts"],
      blockedFiles: ["**/.env", "**/secrets/**", "src/db.ts"],
      allowedTools: ["read_file", "write_file", "task_complete"],
    },
  }),

  // ── Task 1 lifecycle ──────────────────────────────────────────────────────
  evt({ task_id: task1, event_type: "TASK_ASSIGNED", payload: { taskId: task1, owner: "worker-dev" } }),
  evt({ task_id: task1, event_type: "TASK_STARTED",  payload: { taskId: task1 } }),
  evt({
    task_id: task1,
    event_type: "PATCH_PROPOSED",
    payload: { taskId: task1, filesModified: ["src/db.ts"], summary: "Added Map-based cache with 100-entry LRU eviction" },
  }),
  evt({
    task_id: task1,
    event_type: "PATCH_RISK_DETECTED",
    payload: {
      taskId: task1,
      risks: [
        { category: "schema_mutation", severity: "medium", filePath: "src/db.ts", pattern: "cache.set(" },
      ],
    },
  }),
  evt({ task_id: task1, event_type: "VERIFICATION_STARTED", payload: { taskId: task1 } }),
  evt({ task_id: task1, event_type: "VERIFICATION_PASSED",  payload: { taskId: task1, exitCode: 0 } }),
  evt({ task_id: task1, event_type: "TASK_COMPLETED",       payload: { taskId: task1 } }),

  // ── Task 2 lifecycle ──────────────────────────────────────────────────────
  evt({ task_id: task2, event_type: "TASK_ASSIGNED", payload: { taskId: task2, owner: "worker-dev" } }),
  evt({ task_id: task2, event_type: "TASK_STARTED",  payload: { taskId: task2 } }),
  evt({
    task_id: task2,
    event_type: "PATCH_PROPOSED",
    payload: { taskId: task2, filesModified: ["src/app.ts"], summary: "Exported helloWorld(name) returning greeting string" },
  }),
  evt({ task_id: task2, event_type: "VERIFICATION_STARTED", payload: { taskId: task2 } }),
  evt({ task_id: task2, event_type: "VERIFICATION_PASSED",  payload: { taskId: task2, exitCode: 0 } }),
  evt({ task_id: task2, event_type: "TASK_COMPLETED",       payload: { taskId: task2 } }),

  // ── Task 3: boundary violation + failure ─────────────────────────────────
  evt({ task_id: task3, event_type: "TASK_ASSIGNED", payload: { taskId: task3, owner: "worker-security" } }),
  evt({ task_id: task3, event_type: "TASK_STARTED",  payload: { taskId: task3 } }),
  evt({
    task_id: task3,
    event_type: "BOUNDARY_VIOLATION",
    payload: {
      taskId: task3,
      file: "src/db.ts",
      violationType: "write_outside_allowed_files",
      message: "worker attempted to write src/db.ts — outside allowedFiles for this task",
    },
  }),
  evt({ task_id: task3, event_type: "TASK_FAILED", payload: { taskId: task3, reason: "boundary_violation" } }),

  // ── Run complete ──────────────────────────────────────────────────────────
  evt({ event_type: "RUN_COMPLETED", payload: { completedTasks: 2, failedTasks: 1 } }),
];

for (const e of events) {
  await writer.appendEvent(e);
}

console.log(`✓ Seeded ${events.length} events`);
console.log(`  Run ID: ${runId}`);
console.log(`  Open http://localhost:5173 to see it`);
