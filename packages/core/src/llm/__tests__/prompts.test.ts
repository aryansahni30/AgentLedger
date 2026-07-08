import { describe, it, expect } from "vitest";
import {
  buildPlannerSystemPrompt,
  buildPlannerUserMessage,
  buildPlannerRetryMessage,
} from "../prompts/planner.js";
import { buildWorkerSystemPrompt, buildWorkerUserMessage } from "../prompts/worker.js";
import type { IntentContract, AgentTask } from "../../schemas/index.js";

const makeIntent = (overrides: Partial<IntentContract> = {}): IntentContract => ({
  runId: "run-test-001",
  goal: "Add caching to the user service",
  constraints: ["no new dependencies", "must be reversible"],
  successCriteria: ["cache hit ratio > 80%", "response time < 100ms"],
  riskLevel: "medium",
  ...overrides,
});

const makeTask = (overrides: Partial<AgentTask> = {}): AgentTask => ({
  taskId: "task-001",
  runId: "run-test-001",
  title: "Implement cache layer",
  description: "Add an in-memory LRU cache to the user service",
  owner: "worker-implement",
  dependencies: [],
  allowedFiles: ["src/**/*.ts"],
  blockedFiles: ["**/.env", "**/secrets/**"],
  allowedTools: ["read_file", "write_file"],
  expectedOutputs: ["modified-source"],
  successCriteria: ["cache hit ratio > 80%"],
  status: "pending",
  ...overrides,
});

// ─── Planner prompts ──────────────────────────────────────────────────────────

describe("buildPlannerSystemPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildPlannerSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("mentions JSON schema structure", () => {
    const prompt = buildPlannerSystemPrompt();
    expect(prompt).toContain("runId");
    expect(prompt).toContain("tasks");
    expect(prompt).toContain("allowedFiles");
    expect(prompt).toContain("blockedFiles");
  });

  it("instructs to block sensitive files", () => {
    const prompt = buildPlannerSystemPrompt();
    expect(prompt).toContain(".env");
    expect(prompt).toContain("secrets");
  });

  it("instructs JSON-only response", () => {
    const prompt = buildPlannerSystemPrompt();
    expect(prompt.toLowerCase()).toContain("json only");
  });
});

describe("buildPlannerUserMessage", () => {
  it("includes the goal", () => {
    const intent = makeIntent();
    const msg = buildPlannerUserMessage(intent, "README.md");
    expect(msg).toContain(intent.goal);
  });

  it("includes the runId", () => {
    const intent = makeIntent();
    const msg = buildPlannerUserMessage(intent, "README.md");
    expect(msg).toContain(intent.runId);
  });

  it("includes the repo context", () => {
    const intent = makeIntent();
    const msg = buildPlannerUserMessage(intent, "📄 README.md\n📁 src");
    expect(msg).toContain("📄 README.md");
  });

  it("includes constraints when present", () => {
    const intent = makeIntent({ constraints: ["no DB changes"] });
    const msg = buildPlannerUserMessage(intent, "");
    expect(msg).toContain("no DB changes");
  });

  it("shows 'none' when no constraints", () => {
    const intent = makeIntent({ constraints: [] });
    const msg = buildPlannerUserMessage(intent, "");
    expect(msg).toContain("none");
  });
});

describe("buildPlannerRetryMessage", () => {
  it("includes original intent and repo context", () => {
    const intent = makeIntent();
    const msg = buildPlannerRetryMessage(intent, "src/", "taskId missing");
    expect(msg).toContain(intent.goal);
  });

  it("includes the previous error", () => {
    const intent = makeIntent();
    const msg = buildPlannerRetryMessage(intent, "", "taskId: Required");
    expect(msg).toContain("taskId: Required");
  });
});

// ─── Worker prompts ───────────────────────────────────────────────────────────

describe("buildWorkerSystemPrompt", () => {
  it("includes task title and description", () => {
    const task = makeTask();
    const prompt = buildWorkerSystemPrompt(task);
    expect(prompt).toContain(task.title);
    expect(prompt).toContain(task.description);
  });

  it("does not reveal blockedFiles to the worker (verifier enforces boundaries)", () => {
    // Design intent: workers are NOT told which files are blocked.
    // The verifier is the sole enforcement layer — this allows the harness
    // to catch real boundary violations rather than relying on model self-restraint.
    const task = makeTask({ blockedFiles: ["**/.env", "**/secrets/**"] });
    const prompt = buildWorkerSystemPrompt(task);
    expect(prompt).not.toContain("**/.env");
    expect(prompt).not.toContain("**/secrets/**");
  });

  it("mentions task_complete tool", () => {
    const prompt = buildWorkerSystemPrompt(makeTask());
    expect(prompt).toContain("task_complete");
  });

  it("requires task_complete call via explicit RULES section", () => {
    const prompt = buildWorkerSystemPrompt(makeTask());
    expect(prompt).toContain("RULES");
    expect(prompt).toContain("task_complete");
  });
});

describe("buildWorkerUserMessage", () => {
  it("includes task description", () => {
    const task = makeTask();
    const msg = buildWorkerUserMessage(task);
    expect(msg).toContain(task.description);
  });

  it("asks to call task_complete", () => {
    const msg = buildWorkerUserMessage(makeTask());
    expect(msg).toContain("task_complete");
  });
});
