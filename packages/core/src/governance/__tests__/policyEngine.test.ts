import { describe, it, expect } from "vitest";
import { evaluatePolicy, DEFAULT_GOVERNANCE_POLICY } from "../policyEngine.js";
import type { AgentTask, PatchRisk, GovernancePolicy } from "../../schemas/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(): AgentTask {
  return {
    taskId: "task-1",
    runId: "run-1",
    title: "Test task",
    description: "",
    owner: "dev-a",
    dependencies: [],
    allowedFiles: [],
    blockedFiles: [],
    allowedTools: [],
    expectedOutputs: [],
    successCriteria: [],
    status: "running",
  };
}

function makeRisk(overrides: Partial<PatchRisk> = {}): PatchRisk {
  return {
    pattern: "api_key_assignment",
    severity: "critical",
    category: "secret",
    filePath: "src/config.ts",
    lineNumber: 5,
    lineContext: 'const API_KEY = "secret"',
    ...overrides,
  };
}

// ─── No risks → allow ─────────────────────────────────────────────────────────

describe("evaluatePolicy — no risks", () => {
  it("returns allow with no risks", () => {
    const decision = evaluatePolicy(makeTask(), []);
    expect(decision.action).toBe("allow");
  });

  it("returns empty reasons with no risks", () => {
    const decision = evaluatePolicy(makeTask(), []);
    expect(decision.reasons).toHaveLength(0);
  });

  it("returns empty risks array with no risks", () => {
    const decision = evaluatePolicy(makeTask(), []);
    expect(decision.risks).toHaveLength(0);
  });
});

// ─── Default policy — secret → deny ──────────────────────────────────────────

describe("evaluatePolicy — default policy, secret risk", () => {
  it("returns deny for critical secret", () => {
    const decision = evaluatePolicy(makeTask(), [makeRisk({ category: "secret", severity: "critical" })]);
    expect(decision.action).toBe("deny");
  });

  it("includes reason string for deny", () => {
    const decision = evaluatePolicy(makeTask(), [makeRisk({ category: "secret", severity: "critical" })]);
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.reasons[0]).toMatch(/deny/i);
  });

  it("includes the risk in decision.risks", () => {
    const risk = makeRisk({ category: "secret", severity: "critical" });
    const decision = evaluatePolicy(makeTask(), [risk]);
    expect(decision.risks).toContain(risk);
  });
});

// ─── Default policy — schema mutation → require_approval ─────────────────────

describe("evaluatePolicy — default policy, schema mutation", () => {
  it("returns require_approval for high schema_mutation", () => {
    const decision = evaluatePolicy(
      makeTask(),
      [makeRisk({ category: "schema_mutation", severity: "high" })],
    );
    expect(decision.action).toBe("require_approval");
  });

  it("does NOT require_approval for schema mutation below minSeverity (medium)", () => {
    const decision = evaluatePolicy(
      makeTask(),
      [makeRisk({ category: "schema_mutation", severity: "medium" })],
    );
    // medium < high threshold — no rule matches schema_mutation at medium
    expect(decision.action).not.toBe("require_approval");
  });
});

// ─── Default policy — auth code → require_approval ───────────────────────────

describe("evaluatePolicy — default policy, auth code", () => {
  it("returns require_approval for medium auth_code", () => {
    const decision = evaluatePolicy(
      makeTask(),
      [makeRisk({ category: "auth_code", severity: "medium" })],
    );
    expect(decision.action).toBe("require_approval");
  });
});

// ─── Default policy — dependency change → warn ───────────────────────────────

describe("evaluatePolicy — default policy, dependency change", () => {
  it("returns warn for medium dependency_change", () => {
    const decision = evaluatePolicy(
      makeTask(),
      [makeRisk({ category: "dependency_change", severity: "medium" })],
    );
    expect(decision.action).toBe("warn");
  });
});

// ─── Precedence: deny > require_approval > warn ───────────────────────────────

describe("evaluatePolicy — action precedence", () => {
  it("deny wins over require_approval", () => {
    const risks = [
      makeRisk({ category: "secret", severity: "critical" }),       // → deny
      makeRisk({ category: "schema_mutation", severity: "high" }),  // → require_approval
    ];
    const decision = evaluatePolicy(makeTask(), risks);
    expect(decision.action).toBe("deny");
  });

  it("require_approval wins over warn", () => {
    const risks = [
      makeRisk({ category: "auth_code", severity: "medium" }),       // → require_approval
      makeRisk({ category: "dependency_change", severity: "medium" }), // → warn
    ];
    const decision = evaluatePolicy(makeTask(), risks);
    expect(decision.action).toBe("require_approval");
  });

  it("includes reasons from all matching rules", () => {
    const risks = [
      makeRisk({ category: "secret", severity: "critical" }),
      makeRisk({ category: "schema_mutation", severity: "high" }),
    ];
    const decision = evaluatePolicy(makeTask(), risks);
    expect(decision.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Custom policy ────────────────────────────────────────────────────────────

describe("evaluatePolicy — custom policy", () => {
  it("uses provided policy over default", () => {
    const customPolicy: GovernancePolicy = {
      rules: [
        { type: "warn_if", categories: ["secret"], minSeverity: "critical" },
      ],
    };
    const decision = evaluatePolicy(
      makeTask(),
      [makeRisk({ category: "secret", severity: "critical" })],
      customPolicy,
    );
    // custom policy only warns for secrets, not denies
    expect(decision.action).toBe("warn");
  });

  it("returns allow when no rules match", () => {
    const customPolicy: GovernancePolicy = {
      rules: [
        { type: "deny_if", categories: ["schema_mutation"] },
      ],
    };
    const decision = evaluatePolicy(
      makeTask(),
      [makeRisk({ category: "dependency_change", severity: "medium" })],
      customPolicy,
    );
    expect(decision.action).toBe("allow");
  });

  it("empty rules array → allow", () => {
    const decision = evaluatePolicy(makeTask(), [makeRisk()], { rules: [] });
    expect(decision.action).toBe("allow");
  });
});

// ─── DEFAULT_GOVERNANCE_POLICY shape ─────────────────────────────────────────

describe("DEFAULT_GOVERNANCE_POLICY", () => {
  it("has at least one deny rule for secrets", () => {
    const denyRules = DEFAULT_GOVERNANCE_POLICY.rules.filter((r) => r.type === "deny_if");
    expect(denyRules.length).toBeGreaterThan(0);
    expect(denyRules.some((r) => r.categories.includes("secret"))).toBe(true);
  });

  it("has a require_approval rule for schema mutations", () => {
    const apprRules = DEFAULT_GOVERNANCE_POLICY.rules.filter((r) => r.type === "require_approval_if");
    expect(apprRules.some((r) => r.categories.includes("schema_mutation"))).toBe(true);
  });
});
