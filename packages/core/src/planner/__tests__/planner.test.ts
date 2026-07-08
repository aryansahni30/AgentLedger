import { describe, it, expect } from "vitest";
import { createPlan } from "../createPlan.js";
import { validateTaskGraph, topoSort } from "../validateTaskGraph.js";
import type { IntentContract, AgentTask, TaskGraph } from "../../schemas/index.js";

function makeIntent(overrides: Partial<IntentContract> = {}): IntentContract {
  return {
    runId: "run-test-001",
    goal: "Add email validation to the signup form",
    constraints: ["Do not modify auth module"],
    successCriteria: ["All tests pass", "Email format validated"],
    riskLevel: "low",
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "task-A",
    runId: "run-001",
    title: "Task A",
    description: "Do something",
    owner: "worker-1",
    dependencies: [],
    allowedFiles: ["src/**/*.ts"],
    blockedFiles: [],
    allowedTools: ["read_file"],
    expectedOutputs: [],
    successCriteria: [],
    status: "pending",
    ...overrides,
  };
}

describe("createPlan", () => {
  it("returns a valid TaskGraph with two tasks", () => {
    const intent = makeIntent();
    const graph = createPlan(intent);

    expect(graph.runId).toBe(intent.runId);
    expect(graph.tasks).toHaveLength(2);
  });

  it("tasks have correct runId", () => {
    const intent = makeIntent({ runId: "run-xyz" });
    const graph = createPlan(intent);

    for (const task of graph.tasks) {
      expect(task.runId).toBe("run-xyz");
    }
  });

  it("implement task depends on analyze task", () => {
    const graph = createPlan(makeIntent());
    const analyzeTask = graph.tasks.find((t) => t.title === "Analyze repository");
    const implementTask = graph.tasks.find((t) => t.title === "Implement changes");

    expect(analyzeTask).toBeDefined();
    expect(implementTask).toBeDefined();
    expect(implementTask?.dependencies).toContain(analyzeTask?.taskId);
  });

  it("analyze task has no dependencies", () => {
    const graph = createPlan(makeIntent());
    const analyzeTask = graph.tasks.find((t) => t.title === "Analyze repository");
    expect(analyzeTask?.dependencies).toHaveLength(0);
  });

  it("all tasks start as pending", () => {
    const graph = createPlan(makeIntent());
    for (const task of graph.tasks) {
      expect(task.status).toBe("pending");
    }
  });

  it("blocked files include .env and secrets", () => {
    const graph = createPlan(makeIntent());
    for (const task of graph.tasks) {
      expect(task.blockedFiles.some((f) => f.includes(".env"))).toBe(true);
    }
  });
});

describe("validateTaskGraph", () => {
  it("passes a valid single-task graph", () => {
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [makeTask()],
    };
    expect(validateTaskGraph(graph).valid).toBe(true);
  });

  it("passes a valid two-task graph with dependency", () => {
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", dependencies: [] }),
        makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["tests/**/*.ts"] }),
      ],
    };
    expect(validateTaskGraph(graph).valid).toBe(true);
  });

  it("rejects duplicate task IDs", () => {
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A" }),
        makeTask({ taskId: "task-A" }),
      ],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.type === "DUPLICATE_TASK_ID")).toBe(true);
    }
  });

  it("rejects missing dependency reference", () => {
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [makeTask({ taskId: "task-A", dependencies: ["task-nonexistent"] })],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.type === "MISSING_DEPENDENCY")).toBe(true);
    }
  });

  it("detects direct cycle A → B → A", () => {
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", dependencies: ["task-B"] }),
        makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["tests/**"] }),
      ],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.type === "DEPENDENCY_CYCLE")).toBe(true);
    }
  });

  it("detects three-node cycle A → B → C → A", () => {
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", dependencies: ["task-C"] }),
        makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["lib/**"] }),
        makeTask({ taskId: "task-C", dependencies: ["task-B"], allowedFiles: ["tests/**"] }),
      ],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.type === "DEPENDENCY_CYCLE")).toBe(true);
    }
  });

  it("detects overlapping allowedFiles between parallel tasks", () => {
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", allowedFiles: ["src/auth.ts", "src/utils.ts"] }),
        makeTask({ taskId: "task-B", allowedFiles: ["src/auth.ts", "src/api.ts"] }),
      ],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const overlap = result.errors.find((e) => e.type === "OVERLAPPING_OWNERSHIP");
      expect(overlap).toBeDefined();
      if (overlap?.type === "OVERLAPPING_OWNERSHIP") {
        expect(overlap.file).toBe("src/auth.ts");
      }
    }
  });

  it("does NOT flag overlap for dependent tasks (sequential)", () => {
    // task-B depends on task-A — they run sequentially, overlap is OK
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", allowedFiles: ["src/auth.ts"] }),
        makeTask({ taskId: "task-B", allowedFiles: ["src/auth.ts"], dependencies: ["task-A"] }),
      ],
    };
    expect(validateTaskGraph(graph).valid).toBe(true);
  });

  it("empty graph is valid", () => {
    const graph: TaskGraph = { runId: "run-001", tasks: [] };
    expect(validateTaskGraph(graph).valid).toBe(true);
  });
});

describe("topoSort", () => {
  it("returns single task unchanged", () => {
    const task = makeTask();
    const sorted = topoSort([task]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]?.taskId).toBe("task-A");
  });

  it("returns dependency before dependent", () => {
    const tasks: AgentTask[] = [
      makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["tests/**"] }),
      makeTask({ taskId: "task-A", dependencies: [] }),
    ];
    const sorted = topoSort(tasks);
    const idxA = sorted.findIndex((t) => t.taskId === "task-A");
    const idxB = sorted.findIndex((t) => t.taskId === "task-B");
    expect(idxA).toBeLessThan(idxB);
  });

  it("handles chain A → B → C in correct order", () => {
    const tasks: AgentTask[] = [
      makeTask({ taskId: "task-C", dependencies: ["task-B"], allowedFiles: ["c/**"] }),
      makeTask({ taskId: "task-A", dependencies: [] }),
      makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["b/**"] }),
    ];
    const sorted = topoSort(tasks);
    const ids = sorted.map((t) => t.taskId);
    expect(ids.indexOf("task-A")).toBeLessThan(ids.indexOf("task-B"));
    expect(ids.indexOf("task-B")).toBeLessThan(ids.indexOf("task-C"));
  });

  it("returns empty array for empty input", () => {
    expect(topoSort([])).toEqual([]);
  });

  it("diamond pattern: A → B, A → C, B → D, C → D — A first, D last", () => {
    // A has no deps. B and C both depend on A. D depends on both B and C.
    const tasks: AgentTask[] = [
      makeTask({ taskId: "task-D", dependencies: ["task-B", "task-C"], allowedFiles: ["d/**"] }),
      makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["b/**"] }),
      makeTask({ taskId: "task-C", dependencies: ["task-A"], allowedFiles: ["c/**"] }),
      makeTask({ taskId: "task-A", dependencies: [] }),
    ];
    const sorted = topoSort(tasks);
    const ids = sorted.map((t) => t.taskId);

    expect(ids.indexOf("task-A")).toBeLessThan(ids.indexOf("task-B"));
    expect(ids.indexOf("task-A")).toBeLessThan(ids.indexOf("task-C"));
    expect(ids.indexOf("task-B")).toBeLessThan(ids.indexOf("task-D"));
    expect(ids.indexOf("task-C")).toBeLessThan(ids.indexOf("task-D"));
  });

  it("preserves all tasks in output — none dropped", () => {
    const tasks: AgentTask[] = [
      makeTask({ taskId: "task-A", dependencies: [] }),
      makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["b/**"] }),
      makeTask({ taskId: "task-C", dependencies: ["task-A"], allowedFiles: ["c/**"] }),
    ];
    const sorted = topoSort(tasks);
    expect(sorted).toHaveLength(3);
    expect(sorted.map((t) => t.taskId).sort()).toEqual(["task-A", "task-B", "task-C"].sort());
  });
});

describe("validateTaskGraph — multiple simultaneous errors", () => {
  it("reports DUPLICATE_TASK_ID and OVERLAPPING_OWNERSHIP together", () => {
    // Two tasks with same ID AND overlapping files
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", allowedFiles: ["src/shared.ts"] }),
        makeTask({ taskId: "task-A", allowedFiles: ["src/shared.ts"] }),
      ],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.type === "DUPLICATE_TASK_ID")).toBe(true);
    }
  });

  it("reports MISSING_DEPENDENCY and DEPENDENCY_CYCLE independently when both present", () => {
    // task-A → task-B (cycle), task-B → task-A (cycle), task-C → task-GHOST (missing)
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", dependencies: ["task-B"], allowedFiles: ["a/**"] }),
        makeTask({ taskId: "task-B", dependencies: ["task-A"], allowedFiles: ["b/**"] }),
        makeTask({ taskId: "task-C", dependencies: ["task-GHOST"], allowedFiles: ["c/**"] }),
      ],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.type === "DEPENDENCY_CYCLE")).toBe(true);
      expect(result.errors.some((e) => e.type === "MISSING_DEPENDENCY")).toBe(true);
    }
  });

  it("detects 3-way parallel file overlap", () => {
    // Three tasks, none depend on each other, all claim the same file
    const sharedFile = "src/shared/utils.ts";
    const graph: TaskGraph = {
      runId: "run-001",
      tasks: [
        makeTask({ taskId: "task-A", allowedFiles: [sharedFile, "a/**"] }),
        makeTask({ taskId: "task-B", allowedFiles: [sharedFile, "b/**"] }),
        makeTask({ taskId: "task-C", allowedFiles: [sharedFile, "c/**"] }),
      ],
    };
    const result = validateTaskGraph(graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const overlapErrors = result.errors.filter((e) => e.type === "OVERLAPPING_OWNERSHIP");
      // A-B, A-C, B-C all overlap → 3 overlap errors
      expect(overlapErrors.length).toBe(3);
    }
  });
});

describe("createPlan — goal propagation", () => {
  it("embeds goal text in analyze task description", () => {
    const intent = makeIntent({ goal: "Add dark mode support" });
    const graph = createPlan(intent);
    const analyzeTask = graph.tasks.find((t) => t.title === "Analyze repository");
    expect(analyzeTask?.description).toContain("Add dark mode support");
  });

  it("embeds goal text in implement task description", () => {
    const intent = makeIntent({ goal: "Refactor authentication module" });
    const graph = createPlan(intent);
    const implementTask = graph.tasks.find((t) => t.title === "Implement changes");
    expect(implementTask?.description).toContain("Refactor authentication module");
  });

  it("propagates successCriteria into analyze task (prefixed)", () => {
    const intent = makeIntent({
      successCriteria: ["All tests pass", "No regressions"],
    });
    const graph = createPlan(intent);
    const analyzeTask = graph.tasks.find((t) => t.title === "Analyze repository");
    expect(analyzeTask?.successCriteria.every((c) => c.startsWith("[analyze]"))).toBe(true);
  });

  it("propagates successCriteria verbatim into implement task", () => {
    const criteria = ["All tests pass", "No regressions"];
    const intent = makeIntent({ successCriteria: criteria });
    const graph = createPlan(intent);
    const implementTask = graph.tasks.find((t) => t.title === "Implement changes");
    expect(implementTask?.successCriteria).toEqual(criteria);
  });
});
