import type { AgentTask, ApprovalPolicy, WorkerResult } from "../schemas/index.js";

/** Keywords that signal high-risk changes warranting human review */
const HIGH_RISK_KEYWORDS = [
  "auth",
  "authentication",
  "authorization",
  "password",
  "secret",
  "token",
  "credential",
  "payment",
  "billing",
  "invoice",
  "migration",
  "schema",
  "prod",
  "production",
  "deploy",
  "infrastructure",
  "firewall",
  "permission",
  "role",
  "admin",
  "sudo",
  "root",
  "encryption",
  "decrypt",
  "private_key",
  "certificate",
];

/** Files that indicate new dependency additions */
const DEPENDENCY_FILE_PATTERNS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "go.sum",
  "Gemfile",
  "composer.json",
];

export interface ApprovalDecision {
  required: boolean;
  reasons: string[];
}

/**
 * Pure function — evaluates approval policy against the task and worker result.
 * Returns { required, reasons } where reasons lists which triggers fired.
 */
export function shouldRequireApproval(
  task: AgentTask,
  workerResult: WorkerResult,
  policy: ApprovalPolicy,
): ApprovalDecision {
  const reasons: string[] = [];

  for (const trigger of policy.requireApprovalFor) {
    switch (trigger) {
      case "all": {
        reasons.push("approval required for all tasks (policy: all)");
        break;
      }

      case "high_risk_keywords": {
        const textToScan = [
          workerResult.summary,
          task.title,
          task.description,
          ...workerResult.filesModified,
        ]
          .join(" ")
          .toLowerCase();

        const matched = HIGH_RISK_KEYWORDS.filter((kw) => textToScan.includes(kw));
        if (matched.length > 0) {
          reasons.push(`high-risk keyword(s) detected: ${matched.slice(0, 3).join(", ")}`);
        }
        break;
      }

      case "new_dependencies": {
        const touchedDependencyFile = workerResult.filesModified.some((f) =>
          DEPENDENCY_FILE_PATTERNS.some((pattern) => f.endsWith(pattern) || f === pattern),
        );
        if (touchedDependencyFile) {
          reasons.push(
            `dependency file modified: ${workerResult.filesModified.find((f) =>
              DEPENDENCY_FILE_PATTERNS.some((p) => f.endsWith(p) || f === p),
            )}`,
          );
        }
        break;
      }

      case "blocked_files_nearby": {
        // Check if any modified file shares a directory with a blocked file
        const modifiedDirs = new Set(
          workerResult.filesModified.map((f) => f.split("/").slice(0, -1).join("/")),
        );
        const blockedDirs = new Set(
          task.blockedFiles.map((f) => f.split("/").slice(0, -1).join("/")),
        );
        const overlap = [...modifiedDirs].filter((d) => blockedDirs.has(d) && d !== "");
        if (overlap.length > 0) {
          reasons.push(
            `modified files share directory with blocked files: ${overlap[0]}`,
          );
        }
        break;
      }
    }
  }

  return { required: reasons.length > 0, reasons };
}
