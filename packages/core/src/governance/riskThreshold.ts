import type { GovernancePolicy } from "../schemas/index.js";

export interface RiskThresholdResult {
  /** Whether the cumulative score exceeds the configured threshold */
  breached: boolean;
  /** The configured threshold value */
  threshold: number;
  /** The actual cumulative score checked against the threshold */
  actualScore: number;
  /** Action to take — defaults to "warn" when not explicitly configured */
  action: "warn" | "pause" | "abort";
}

/**
 * Check whether a cumulative risk score breaches the policy threshold.
 *
 * Returns `null` when no `riskThreshold` is configured on the policy.
 * Returns a `RiskThresholdResult` otherwise — caller must check `.breached`
 * to decide whether to act.
 *
 * Equality (`score === threshold`) is NOT a breach — only strict `>` triggers.
 */
export function checkRiskThreshold(
  cumulativeScore: number,
  policy: GovernancePolicy,
): RiskThresholdResult | null {
  if (policy.riskThreshold === undefined) return null;

  return {
    breached: cumulativeScore > policy.riskThreshold,
    threshold: policy.riskThreshold,
    actualScore: cumulativeScore,
    action: policy.thresholdAction ?? "warn",
  };
}
