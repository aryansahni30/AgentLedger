import type { PriorTaskContext } from "../../schemas/index.js";

/**
 * Formats prior-task context into a human-readable block for injection
 * into the worker system prompt.
 *
 * Returns an empty string when priorContext is empty so callers can
 * use a simple conditional include.
 */
export function formatPriorContextForPrompt(priorContext: PriorTaskContext[]): string {
  if (priorContext.length === 0) return "";

  const lines: string[] = [
    "Prior completed tasks (upstream work your task may depend on):",
    "",
  ];

  for (const ctx of priorContext) {
    lines.push(`  Task: ${ctx.title} (ID: ${ctx.taskId})`);
    lines.push(`  Summary: ${ctx.summary}`);
    if (ctx.filesModified.length > 0) {
      lines.push(`  Files modified: ${ctx.filesModified.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
