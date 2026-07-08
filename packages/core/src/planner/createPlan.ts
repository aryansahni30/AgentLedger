import { randomUUID } from "crypto";
import {
  type IntentContract,
  type TaskGraph,
  type AgentTask,
  TaskGraphSchema,
} from "../schemas/index.js";
import { validateTaskGraph } from "./validateTaskGraph.js";

/**
 * Mock planner: deterministically converts an IntentContract into a TaskGraph.
 *
 * MVP is rule-based — not LLM-powered. The harness is the engineering
 * contribution; the planner is a prompt-engineering problem solved in Phase 8.
 *
 * The mock produces a two-task graph:
 *   1. "analyze" — reads the repo, produces a report
 *   2. "implement" — writes changes, depends on analyze
 *
 * This is enough to exercise the full orchestrator loop, git isolation,
 * and verification gate with a realistic dependency structure.
 */
export function createPlan(intent: IntentContract): TaskGraph {
  const analyzeTaskId = `task-${randomUUID().slice(0, 8)}`;
  const implementTaskId = `task-${randomUUID().slice(0, 8)}`;

  const analyzeTask: AgentTask = {
    taskId: analyzeTaskId,
    runId: intent.runId,
    title: "Analyze repository",
    description: `Analyze the repository to understand current structure and plan changes for: ${intent.goal}`,
    owner: "worker-analyze",
    dependencies: [],
    allowedFiles: ["**/*.md", "**/*.json", "src/**/*.ts"],
    blockedFiles: ["**/*.env", "**/secrets/**", "**/.git/**"],
    allowedTools: ["read_file", "list_directory", "search_files"],
    expectedOutputs: ["analysis-report"],
    successCriteria: intent.successCriteria.map((c) => `[analyze] ${c}`),
    status: "pending",
  };

  const implementTask: AgentTask = {
    taskId: implementTaskId,
    runId: intent.runId,
    title: "Implement changes",
    description: `Implement the following goal based on analysis: ${intent.goal}`,
    owner: "worker-implement",
    dependencies: [analyzeTaskId],
    allowedFiles: ["src/**/*.ts", "src/**/*.tsx", "**/*.json"],
    blockedFiles: [
      "**/*.env",
      "**/secrets/**",
      "**/.git/**",
      "**/*.test.ts",
      "**/*.spec.ts",
    ],
    allowedTools: ["read_file", "write_file", "edit_file", "run_command"],
    expectedOutputs: ["modified-files", "patch"],
    successCriteria: intent.successCriteria,
    status: "pending",
  };

  const graph: TaskGraph = TaskGraphSchema.parse({
    runId: intent.runId,
    tasks: [analyzeTask, implementTask],
  });

  const validationResult = validateTaskGraph(graph);
  if (!validationResult.valid) {
    const messages = validationResult.errors
      .map((e) => JSON.stringify(e))
      .join(", ");
    throw new Error(`createPlan produced an invalid task graph: ${messages}`);
  }

  return graph;
}
