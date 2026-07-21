/**
 * Shared verification logic used by both the Stop hook (mid-session)
 * and SessionEnd hook (final verification).
 *
 * Runs test commands and boundary checks. Returns deterministic results.
 */

import path from "path";
import { execSync } from "child_process";
import { minimatch } from "minimatch";

/**
 * @typedef {{
 *   testsPassed: boolean,
 *   testExitCode: number,
 *   testOutput: string,
 *   testTimedOut: boolean,
 *   boundaryClean: boolean,
 *   violations: Array<{ file: string, pattern: string }>
 * }} VerificationResult
 */

// Conventional exit code for a command killed by timeout (matches coreutils `timeout`).
const TIMEOUT_EXIT_CODE = 124;

/**
 * Run the test command and return exit code + output.
 *
 * A timeout is reported distinctly (`timedOut: true`) rather than folded into a
 * generic exit 1: execSync kills an overrunning command with SIGTERM and leaves
 * `err.status` null, which would otherwise read as an ordinary test failure. The
 * caller needs the distinction — a timed-out suite is inconclusive, not failed.
 *
 * @param {string} testCommand
 * @param {string} projectDir
 * @param {number} [timeout=120000] — ms timeout for test execution
 * @returns {{ exitCode: number, output: string, timedOut: boolean }}
 */
export function runTestCommand(testCommand, projectDir, timeout = 120_000) {
  if (!testCommand) {
    return { exitCode: 0, output: "(skipped — no testCommand configured)", timedOut: false };
  }
  try {
    const stdout = execSync(testCommand, {
      cwd: projectDir,
      encoding: "utf8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, output: stdout, timedOut: false };
  } catch (err) {
    const timedOut = err.killed === true || err.signal === "SIGTERM" || err.code === "ETIMEDOUT";
    return {
      exitCode: err.status ?? (timedOut ? TIMEOUT_EXIT_CODE : 1),
      output: (err.stdout ?? "") + (err.stderr ?? ""),
      timedOut,
    };
  }
}

/**
 * Get files changed in git working tree (vs HEAD).
 *
 * @param {string} projectDir
 * @returns {string[]}
 */
export function getChangedFiles(projectDir) {
  try {
    const output = execSync("git diff --name-only HEAD", {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check changed files against blocked patterns.
 *
 * @param {string[]} changedFiles
 * @param {string[]} blockedPatterns
 * @returns {Array<{ file: string, pattern: string }>}
 */
export function detectBoundaryViolations(changedFiles, blockedPatterns) {
  const violations = [];
  for (const file of changedFiles) {
    for (const pattern of blockedPatterns) {
      if (
        minimatch(file, pattern, { dot: true }) ||
        minimatch(path.basename(file), pattern.replace(/\*\*\//, ""), { dot: true })
      ) {
        violations.push({ file, pattern });
        break;
      }
    }
  }
  return violations;
}

/**
 * Run full verification: test command + boundary check.
 *
 * @param {{ testCommand: string, blockedFiles: string[], projectDir: string, testTimeout?: number }} opts
 * @returns {VerificationResult}
 */
export function verify({ testCommand, blockedFiles, projectDir, testTimeout }) {
  const testResult = runTestCommand(testCommand, projectDir, testTimeout);
  const changedFiles = getChangedFiles(projectDir);
  const violations = detectBoundaryViolations(changedFiles, blockedFiles);

  return {
    testsPassed: testResult.exitCode === 0,
    testExitCode: testResult.exitCode,
    testOutput: testResult.output,
    testTimedOut: testResult.timedOut,
    boundaryClean: violations.length === 0,
    violations,
  };
}
