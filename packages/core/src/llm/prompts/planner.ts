import type { IntentContract } from "../../schemas/index.js";

export function buildPlannerSystemPrompt(): string {
  return `You are an expert software engineering project planner. Your job is to decompose a development goal into a TaskGraph — a structured list of tasks with file ownership boundaries.

You MUST respond with a single JSON object matching this exact schema (no markdown, no explanation — JSON ONLY):
{
  "runId": "<copy from intent>",
  "tasks": [
    {
      "taskId": "task-001",
      "runId": "<copy from intent>",
      "title": "<short descriptive title>",
      "description": "<what this task does and how>",
      "owner": "worker-<name>",
      "dependencies": [],
      "allowedFiles": ["<glob patterns this task MAY write>"],
      "blockedFiles": ["**/.env", "**/secrets/**", "**/.git/**"],
      "allowedTools": ["read_file", "write_file", "list_directory"],
      "expectedOutputs": ["<artifact names>"],
      "successCriteria": ["<verifiable completion condition>"],
      "status": "pending"
    }
  ]
}

Strict rules:
1. Keep it SIMPLE: 1–2 tasks for most goals. More tasks = more risk.
2. ALWAYS block sensitive files in every task: ["**/.env", "**/.env.*", "**/secrets/**", "**/.git/**", "**/node_modules/**"].
3. Never give two independent tasks the same allowedFiles pattern.
4. status must always be "pending".
5. taskId values must be unique (task-001, task-002, …).
6. dependencies is an array of taskId strings (not indices).
7. Respond with JSON only — no text before or after.`;
}

export function buildPlannerUserMessage(
  intent: IntentContract,
  repoContext: string,
): string {
  return `Goal: ${intent.goal}

Constraints: ${intent.constraints.length > 0 ? intent.constraints.join(", ") : "none"}
Success criteria: ${intent.successCriteria.join(", ")}
Risk level: ${intent.riskLevel}

Repository context:
${repoContext}

runId to use: ${intent.runId}

Produce the TaskGraph JSON now.`;
}

export function buildPlannerRetryMessage(
  intent: IntentContract,
  repoContext: string,
  lastError: string,
): string {
  return (
    buildPlannerUserMessage(intent, repoContext) +
    `\n\nYour previous response failed schema validation with this error:\n${lastError}\n\nFix the issue and return valid JSON only.`
  );
}
