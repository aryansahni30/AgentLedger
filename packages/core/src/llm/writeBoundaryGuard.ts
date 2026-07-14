import { minimatch } from "minimatch";

export type WritePermissionResult =
  | { denied: false }
  | { denied: true; reason: string; violationType: "BLOCKED_FILE" | "UNOWNED_FILE" };

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(file, pattern, { dot: true }));
}

/**
 * Pure boundary check for real-time write blocking.
 * Called BEFORE any disk write in the worker tool loop.
 *
 * Priority mirrors checkBoundaries.ts (post-hoc verifier):
 *   1. blockedFiles match → BLOCKED_FILE (hard block)
 *   2. allowedFiles match → OK
 *   3. neither            → UNOWNED_FILE (out-of-scope block)
 *
 * This is prevention; the verifier is independent detection.
 * Both layers are required — detection catches bugs in prevention.
 */
export function checkWritePermission(
  relativePath: string,
  allowedFiles: string[],
  blockedFiles: string[],
): WritePermissionResult {
  if (matchesAny(relativePath, blockedFiles)) {
    return {
      denied: true,
      reason: `BLOCKED: '${relativePath}' matches a blocked pattern — write denied`,
      violationType: "BLOCKED_FILE",
    };
  }
  if (!matchesAny(relativePath, allowedFiles)) {
    return {
      denied: true,
      reason: `UNOWNED: '${relativePath}' is outside this task's allowedFiles scope — write denied`,
      violationType: "UNOWNED_FILE",
    };
  }
  return { denied: false };
}
