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
 *   boundaryClean: boolean,
 *   violations: Array<{ file: string, pattern: string }>
 * }} VerificationResult
 */

/**
 * Run the test command and return exit code + output.
 *
 * @param {string} testCommand
 * @param {string} projectDir
 * @param {number} [timeout=120000] — ms timeout for test execution
 * @returns {{ exitCode: number, output: string }}
 */
export function runTestCommand(testCommand, projectDir, timeout = 120_000) {
  if (!testCommand) {
    return { exitCode: 0, output: "(skipped — no testCommand configured)" };
  }
  try {
    const stdout = execSync(testCommand, {
      cwd: projectDir,
      encoding: "utf8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout ?? "") + (err.stderr ?? ""),
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
    boundaryClean: violations.length === 0,
    violations,
  };
}
