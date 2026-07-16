#!/usr/bin/env node
/**
 * SessionEnd hook — verification gate.
 *
 * Responsibilities:
 *   1. If no active run (session.json has no runId or dirty=false) → exit cleanly
 *   2. Run verification via shared verifier (git diff + test command)
 *   3. Emit VERIFICATION_PASSED or VERIFICATION_FAILED
 *   4. Emit RUN_COMPLETED or RUN_FAILED
 *   5. Merge session stats into persistent stats.json
 *   6. Clear session state
 *   7. Print enhanced summary with trust delta
 *
 * LedgerWriter.appendEvent computes hash/previous_hash internally.
 */

import fs from "fs";
import path from "path";
import { readSessionState, clearSessionState } from "../state.js";
import { readStats, mergeSessionStats } from "../stats.js";
import { verify } from "../verifier.js";

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

  // Run verification using shared verifier module
  console.log(`\n[agentledger] Running: ${testCommand || "(skipped)"}`);
  const result = verify({ testCommand, blockedFiles, projectDir });
  const { violations, testExitCode, testsPassed, boundaryClean } = result;
  const verificationPassed = testsPassed && boundaryClean;

  // Build reason string for failed verification
  let verificationReason = "";
  if (!boundaryClean) {
    verificationReason = `BOUNDARY_VIOLATION: ${violations.map((v) => v.file).join(", ")}`;
    await appendEvent(runId, "BOUNDARY_VIOLATION", {
      violations: violations.map((v) => ({ file: v.file, matched_pattern: v.pattern })),
      detected_by: "git-diff",
    });
  }
  if (!testsPassed) {
    verificationReason = verificationReason
      ? `${verificationReason}; TESTS_FAILED (exit ${testExitCode})`
      : `TESTS_FAILED (exit ${testExitCode})`;
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
      exit_code: testExitCode,
      boundary_violations: violations.length,
      reason: verificationReason,
    });
  }

  // Emit run terminal event
  if (verificationPassed) {
    await appendEvent(runId, "RUN_COMPLETED", {
      summary: "Observed session completed — all checks passed",
      files_changed: 0,
    });
  } else {
    await appendEvent(runId, "RUN_FAILED", {
      reason: verificationReason,
      files_changed: 0,
    });
  }

  // Merge session stats into persistent stats.json
  const statsBefore = await readStats();
  const trustBefore = statsBefore.totalClaims > 0 ? Math.round(statsBefore.trustScore * 100) : null;

  const reads = state.reads ?? 0;
  const edits = (state.edits ?? 0) + (state.writes ?? 0);
  const readEditRatio = edits > 0 ? (reads / edits).toFixed(1) : (reads > 0 ? "∞" : "—");
  const readEditLabel = edits > 0 && reads / edits < 1.0 ? "⚠ low" : "healthy";

  const updatedStats = await mergeSessionStats({
    claimsVerifiedTrue: state.claimsVerifiedTrue ?? 0,
    claimsVerifiedFalse: state.claimsVerifiedFalse ?? 0,
    claimsUnverifiable: state.claimsUnverifiable ?? 0,
    blocks: state.blocks ?? 0,
    warnings: state.warnings ?? 0,
    filesRead: (state.filesRead ?? []).length,
    filesEdited: (state.filesEdited ?? []).length,
    falseClaims: state.falseClaims ?? [],
  });

  const trustAfter = Math.round(updatedStats.trustScore * 100);
  const sessionClaims = (state.claimsVerifiedTrue ?? 0) + (state.claimsVerifiedFalse ?? 0) + (state.claimsUnverifiable ?? 0);
  const sessionFalse = state.claimsVerifiedFalse ?? 0;

  // Print enhanced summary
  console.log("");
  console.log("╔═══════════════════════════════════════╗");
  console.log("║       AgentLedger — Session End       ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log(`  Status     : ${verificationPassed ? "✓ PASSED" : "✗ FAILED"}`);

  if (sessionClaims > 0) {
    console.log(`  Claims     : ${sessionClaims} made · ${state.claimsVerifiedTrue ?? 0} verified · ${sessionFalse} false`);
  }

  if (violations.length > 0) {
    console.log(`  Boundary   : ${violations.length} violation(s) detected`);
    for (const v of violations) {
      console.log(`    - ${v.file}  [${v.pattern}]`);
    }
  } else {
    console.log("  Boundary   : ✓ clean");
  }
  console.log(`  Tests      : exit ${testExitCode}`);
  console.log(`  Read:Edit  : ${readEditRatio}x (${readEditLabel})`);

  if (trustBefore !== null) {
    const delta = trustAfter - trustBefore;
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    console.log(`  Trust Δ    : ${trustBefore}% → ${trustAfter}%  ${arrow}`);
  } else if (sessionClaims > 0) {
    console.log(`  Trust      : ${trustAfter}% (first measurement)`);
  }

  if ((state.editWithoutRead ?? []).length > 0) {
    console.log(`  ⚠ Edited without reading: ${state.editWithoutRead.map((f) => path.basename(f)).join(", ")}`);
  }

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
