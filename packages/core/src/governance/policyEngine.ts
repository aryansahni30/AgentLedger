import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentTask,
  GovernancePolicy,
  PolicyDecision,
  PatchRisk,
  PatchRiskSeverity,
} from "../schemas/index.js";
import { GovernancePolicySchema } from "../schemas/index.js";

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<PatchRiskSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
};

function meetsMinSeverity(risk: PatchRisk, min: PatchRiskSeverity): boolean {
  return SEVERITY_ORDER[risk.severity] >= SEVERITY_ORDER[min];
}

// ─── Default policy ───────────────────────────────────────────────────────────

export const DEFAULT_GOVERNANCE_POLICY: GovernancePolicy = {
  rules: [
    {
      type: "deny_if",
      categories: ["secret"],
      minSeverity: "critical",
    },
    {
      type: "require_approval_if",
      categories: ["schema_mutation"],
      minSeverity: "high",
    },
    {
      type: "require_approval_if",
      categories: ["auth_code"],
      minSeverity: "medium",
    },
    {
      type: "warn_if",
      categories: ["dependency_change"],
      minSeverity: "medium",
    },
  ],
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pure function — evaluates governance policy against patch risks.
 * Precedence: deny > require_approval > warn > allow.
 */
export function evaluatePolicy(
  _task: AgentTask,
  patchRisks: PatchRisk[],
  policy: GovernancePolicy = DEFAULT_GOVERNANCE_POLICY,
): PolicyDecision {
  if (patchRisks.length === 0) {
    return { action: "allow", reasons: [], risks: [] };
  }

  type PolicyAction = "allow" | "warn" | "require_approval" | "deny";

  const reasons: string[] = [];
  const matchedRisks: PatchRisk[] = [];
  let topAction: PolicyAction = "allow";

  const actionPriority: Record<PolicyAction, number> = {
    allow: 0,
    warn: 1,
    require_approval: 2,
    deny: 3,
  };

  for (const rule of policy.rules) {
    const matching = patchRisks.filter(
      (r) =>
        rule.categories.includes(r.category) &&
        (rule.minSeverity === undefined || meetsMinSeverity(r, rule.minSeverity)),
    );

    if (matching.length === 0) continue;

    const action = rule.type === "deny_if"
      ? "deny"
      : rule.type === "require_approval_if"
      ? "require_approval"
      : "warn";

    if (actionPriority[action] > actionPriority[topAction]) {
      topAction = action;
    }

    for (const risk of matching) {
      reasons.push(
        `${action.toUpperCase()} — ${risk.category} (${risk.severity}) at ${risk.filePath}:${risk.lineNumber} [${risk.pattern}]`,
      );
      if (!matchedRisks.includes(risk)) matchedRisks.push(risk);
    }
  }

  return { action: topAction, reasons, risks: matchedRisks };
}

/**
 * Loads a governance policy from `<configDir>/governance.json`.
 * Falls back to DEFAULT_GOVERNANCE_POLICY if file is missing.
 */
export async function loadGovernancePolicy(configDir: string): Promise<GovernancePolicy> {
  const policyPath = join(configDir, "governance.json");
  try {
    const raw = await readFile(policyPath, "utf-8");
    return GovernancePolicySchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_GOVERNANCE_POLICY;
  }
}
