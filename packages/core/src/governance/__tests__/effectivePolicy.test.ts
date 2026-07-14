import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { loadEffectivePolicy } from "../effectivePolicy.js";
import { DEFAULT_GOVERNANCE_POLICY } from "../policyEngine.js";
import type { GovernancePolicy, AgentTask } from "../../schemas/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "t1",
    runId: "r1",
    title: "Test task",
    description: "desc",
    owner: "agent",
    dependencies: [],
    allowedFiles: [],
    blockedFiles: [],
    allowedTools: [],
    expectedOutputs: [],
    successCriteria: [],
    status: "pending",
    ...overrides,
  };
}

const BASE_POLICY: GovernancePolicy = {
  rules: [{ type: "deny_if", categories: ["secret"] }],
  riskThreshold: 50,
  thresholdAction: "warn",
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `al-ep-test-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadEffectivePolicy", () => {
  describe("no run-level policy file", () => {
    it("returns default policy when no governance.json and no task override", async () => {
      const policy = await loadEffectivePolicy(tmpDir);
      expect(policy.rules).toEqual(DEFAULT_GOVERNANCE_POLICY.rules);
    });

    it("returns default rules when no file and no task override", async () => {
      const policy = await loadEffectivePolicy(tmpDir, makeTask());
      expect(policy.rules).toHaveLength(DEFAULT_GOVERNANCE_POLICY.rules.length);
    });
  });

  describe("run-level policy only", () => {
    beforeEach(async () => {
      await writeFile(
        join(tmpDir, "governance.json"),
        JSON.stringify(BASE_POLICY),
        "utf8",
      );
    });

    it("loads run-level policy when task has no override", async () => {
      const policy = await loadEffectivePolicy(tmpDir, makeTask());
      expect(policy.rules).toHaveLength(1);
      expect(policy.rules[0]!.type).toBe("deny_if");
    });

    it("preserves riskThreshold from run-level policy", async () => {
      const policy = await loadEffectivePolicy(tmpDir, makeTask());
      expect(policy.riskThreshold).toBe(50);
    });

    it("preserves thresholdAction from run-level policy", async () => {
      const policy = await loadEffectivePolicy(tmpDir, makeTask());
      expect(policy.thresholdAction).toBe("warn");
    });

    it("loads run-level policy with no task arg", async () => {
      const policy = await loadEffectivePolicy(tmpDir);
      expect(policy.rules).toHaveLength(1);
    });
  });

  describe("task-level override", () => {
    const TASK_POLICY: GovernancePolicy = {
      rules: [{ type: "warn_if", categories: ["auth_code"] }],
      riskThreshold: 80,
      thresholdAction: "abort",
    };

    beforeEach(async () => {
      await writeFile(
        join(tmpDir, "governance.json"),
        JSON.stringify(BASE_POLICY),
        "utf8",
      );
      await writeFile(
        join(tmpDir, "task-policy.json"),
        JSON.stringify(TASK_POLICY),
        "utf8",
      );
    });

    it("appends task-level rules to run-level rules", async () => {
      const task = makeTask({ governancePolicyFile: "task-policy.json" });
      const policy = await loadEffectivePolicy(tmpDir, task);
      // run-level: deny_if secret; task-level: warn_if auth_code
      expect(policy.rules).toHaveLength(2);
      expect(policy.rules[0]!.type).toBe("deny_if");
      expect(policy.rules[1]!.type).toBe("warn_if");
    });

    it("task-level riskThreshold overrides run-level", async () => {
      const task = makeTask({ governancePolicyFile: "task-policy.json" });
      const policy = await loadEffectivePolicy(tmpDir, task);
      expect(policy.riskThreshold).toBe(80);
    });

    it("task-level thresholdAction overrides run-level", async () => {
      const task = makeTask({ governancePolicyFile: "task-policy.json" });
      const policy = await loadEffectivePolicy(tmpDir, task);
      expect(policy.thresholdAction).toBe("abort");
    });
  });

  describe("task-level only (no run-level file)", () => {
    beforeEach(async () => {
      await writeFile(
        join(tmpDir, "task-policy.json"),
        JSON.stringify({ rules: [{ type: "require_approval_if", categories: ["schema_mutation"] }] }),
        "utf8",
      );
    });

    it("appends task-level rules after default rules when no run-level file", async () => {
      const task = makeTask({ governancePolicyFile: "task-policy.json" });
      const policy = await loadEffectivePolicy(tmpDir, task);
      // default (4) + task (1) = 5
      expect(policy.rules).toHaveLength(DEFAULT_GOVERNANCE_POLICY.rules.length + 1);
      // last rule is the task-level one
      const lastRule = policy.rules[policy.rules.length - 1]!;
      expect(lastRule.type).toBe("require_approval_if");
      expect(lastRule.categories).toContain("schema_mutation");
    });
  });

  describe("task-level file missing", () => {
    beforeEach(async () => {
      await writeFile(
        join(tmpDir, "governance.json"),
        JSON.stringify(BASE_POLICY),
        "utf8",
      );
    });

    it("falls back to run-level policy when task-level file not found", async () => {
      const task = makeTask({ governancePolicyFile: "nonexistent.json" });
      const policy = await loadEffectivePolicy(tmpDir, task);
      // should still get run-level policy (missing override = no-op)
      expect(policy.rules).toHaveLength(1);
      expect(policy.riskThreshold).toBe(50);
    });
  });

  describe("task with no governancePolicyFile", () => {
    beforeEach(async () => {
      await writeFile(
        join(tmpDir, "governance.json"),
        JSON.stringify(BASE_POLICY),
        "utf8",
      );
    });

    it("returns run-level policy when task has no override field", async () => {
      const task = makeTask(); // no governancePolicyFile
      const policy = await loadEffectivePolicy(tmpDir, task);
      expect(policy.rules).toHaveLength(1);
      expect(policy.riskThreshold).toBe(50);
    });
  });

  describe("merge semantics", () => {
    it("task-level undefined threshold leaves run-level threshold intact", async () => {
      await writeFile(
        join(tmpDir, "governance.json"),
        JSON.stringify(BASE_POLICY),
        "utf8",
      );
      // task policy has rules but no riskThreshold
      const taskPolicyNoThreshold: GovernancePolicy = {
        rules: [{ type: "warn_if", categories: ["dependency_change"] }],
      };
      await writeFile(
        join(tmpDir, "task-policy.json"),
        JSON.stringify(taskPolicyNoThreshold),
        "utf8",
      );
      const task = makeTask({ governancePolicyFile: "task-policy.json" });
      const policy = await loadEffectivePolicy(tmpDir, task);
      // BASE_POLICY has 1 rule + task has 1 rule = 2
      expect(policy.rules).toHaveLength(2);
      // threshold from run-level preserved
      expect(policy.riskThreshold).toBe(50);
      expect(policy.thresholdAction).toBe("warn");
    });
  });
});
