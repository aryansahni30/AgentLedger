import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTask, GovernancePolicy } from "../schemas/index.js";
import { GovernancePolicySchema } from "../schemas/index.js";
import { loadGovernancePolicy } from "./policyEngine.js";

/**
 * Load the effective governance policy for an optional task.
 *
 * Merge semantics:
 *   - Start with the run-level governance.json (or default empty policy)
 *   - If task has `governancePolicyFile`, load that file relative to configDir
 *   - Append task-level rules after run-level rules
 *   - Task-level `riskThreshold` and `thresholdAction` override run-level values
 *     when present; absent task-level fields leave run-level values intact
 *   - Missing task-level file is silently ignored (falls back to run-level)
 */
export async function loadEffectivePolicy(
  configDir: string,
  task?: AgentTask,
): Promise<GovernancePolicy> {
  const runPolicy = await loadGovernancePolicy(configDir);

  if (!task?.governancePolicyFile) return runPolicy;

  let taskPolicy: GovernancePolicy | null = null;
  try {
    const raw = await readFile(join(configDir, task.governancePolicyFile), "utf8");
    taskPolicy = GovernancePolicySchema.parse(JSON.parse(raw));
  } catch {
    // file missing or invalid — fall back to run-level policy
    return runPolicy;
  }

  return {
    rules: [...runPolicy.rules, ...taskPolicy.rules],
    riskThreshold: taskPolicy.riskThreshold ?? runPolicy.riskThreshold,
    thresholdAction: taskPolicy.thresholdAction ?? runPolicy.thresholdAction,
  };
}
