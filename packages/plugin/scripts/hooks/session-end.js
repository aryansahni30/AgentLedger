#!/usr/bin/env node
/**
 * SessionEnd hook — verification gate.
 *
 * Responsibilities:
 *   1. If no active run (session.json has no runId or dirty=false) → exit cleanly
 *   2. Run git diff to detect any Bash-originated file changes (Layer 2 boundary check)
 *   3. Run configured test command and capture exit code
 *   4. Emit VERIFICATION_PASSED or VERIFICATION_FAILED
 *   5. Emit RUN_COMPLETED or RUN_FAILED
 *   6. Clear session state
 *   7. Print a compact summary to stdout
 *
 * LedgerWriter.appendEvent computes hash/previous_hash internally.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { minimatch } from "minimatch";
import { readSessionState, clearSessionState } from "../state.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");
const configPath = path.join(projectDir, ".agentledger", "config.json");

/** @returns {{ blockedFiles: string[], testCommand: string }} */
function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    return {
      blockedFiles: Array.isArray(config.blockedFiles)
        ? config.blockedFiles
        : ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
      testCommand: typeof config.testCommand === "string" ? config.testCommand : "npm test",
    };
  } catch {
    return {
      blockedFiles: ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
      testCommand: "npm test",
    };
  }
}

/**
 * Returns list of files changed in this git session (vs HEAD).
 * @returns {string[]}
 */
function getChangedFiles() {
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
 * @param {string[]} changedFiles
 * @param {string[]} blockedPatterns
 * @returns {{ file: string, pattern: string }[]}
 */
function detectBoundaryViolations(changedFiles, blockedPatterns) {
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
 * Run the test command and return exit code.
 * @param {string} testCommand
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
function runTests(testCommand) {
  if (!testCommand) {
    return { exitCode: 0, stdout: "(skipped — testCommand is empty)", stderr: "" };
  }
  try {
    const stdout = execSync(testCommand, {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/**
 * Append a single event to the ledger.
 * LedgerWriter handles hash chaining internally.
 *
 * @param {string} runId
 * @param {string} eventType
 * @param {Record<string, unknown>} payload
 * @returns {Promise<void>}
 */
async function appendEvent(runId, eventType, payload) {
  const { LedgerWriter } = await import("@agentledger/core");
  const writer = new LedgerWriter(ledgerPath);

  await writer.appendEvent({
    event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    run_id: runId,
    timestamp: new Date().toISOString(),
    actor: "plugin:session-end",
    event_type: eventType,
    payload,
  });
}

async function main() {
  const state = await readSessionState();

  // No active run — nothing to verify
  if (!state.runId || !state.dirty) {
    await clearSessionState();
    process.exit(0);
  }

  const { blockedFiles, testCommand } = loadConfig();
  const runId = state.runId;

  // Layer 2: git diff boundary check
  const changedFiles = getChangedFiles();
  const violations = detectBoundaryViolations(changedFiles, blockedFiles);

  let verificationPassed = true;
  let verificationReason = "";

  if (violations.length > 0) {
    verificationPassed = false;
    verificationReason = `BOUNDARY_VIOLATION: ${violations.map((v) => v.file).join(", ")}`;

    await appendEvent(runId, "BOUNDARY_VIOLATION", {
      violations: violations.map((v) => ({ file: v.file, matched_pattern: v.pattern })),
      detected_by: "git-diff",
    });
  }

  // Run test command
  console.log(`\n[agentledger] Running: ${testCommand || "(skipped)"}`);
  const testResult = runTests(testCommand);

  if (testResult.exitCode !== 0) {
    verificationPassed = false;
    verificationReason = verificationReason
      ? `${verificationReason}; TESTS_FAILED (exit ${testResult.exitCode})`
      : `TESTS_FAILED (exit ${testResult.exitCode})`;
  }

  // Emit verification event
  if (verificationPassed) {
    await appendEvent(runId, "VERIFICATION_PASSED", {
      test_command: testCommand,
      exit_code: 0,
      boundary_violations: 0,
    });
  } else {
    await appendEvent(runId, "VERIFICATION_FAILED", {
      test_command: testCommand,
      exit_code: testResult.exitCode,
      boundary_violations: violations.length,
      reason: verificationReason,
    });
  }

  // Emit run terminal event
  if (verificationPassed) {
    await appendEvent(runId, "RUN_COMPLETED", {
      summary: "Observed session completed — all checks passed",
      files_changed: changedFiles.length,
    });
  } else {
    await appendEvent(runId, "RUN_FAILED", {
      reason: verificationReason,
      files_changed: changedFiles.length,
    });
  }

  // Print summary
  console.log("");
  console.log("╔═══════════════════════════════════════╗");
  console.log("║       AgentLedger — Session End         ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log(`  Run ID   : ${runId.slice(0, 8)}`);
  console.log(`  Status   : ${verificationPassed ? "✓ PASSED" : "✗ FAILED"}`);
  if (violations.length > 0) {
    console.log(`  Boundary : ${violations.length} violation(s) detected (Bash)`);
    for (const v of violations) {
      console.log(`    - ${v.file}  [${v.pattern}]`);
    }
  } else {
    console.log("  Boundary : ✓ no violations");
  }
  console.log(`  Tests    : exit ${testResult.exitCode}`);
  console.log("");

  // Clear session state
  await clearSessionState();

  process.exit(0);
}

main().catch((err) => {
  console.error("[agentledger] session-end error:", err?.message);
  clearSessionState().catch(() => {});
  process.exit(0);
});
