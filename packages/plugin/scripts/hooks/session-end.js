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
import { ensureRun } from "../run-init.js";
import { readStats, mergeSessionStats } from "../stats.js";
import { verify } from "../verifier.js";
import { writeLastSummary } from "../end-summary.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");
const configPath = path.join(projectDir, ".agentledger", "config.json");

// Bound the test run well under the SessionEnd hook timeout (120s in hooks.json)
// so the summary box always has headroom to print. A suite that ran to the hook
// timeout would be SIGKILLed before console.log ever fired — the exact reason the
// documented Session End box could silently never appear.
const TEST_TIMEOUT_MS = 90_000;

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
  let state = await readSessionState();

  // Skip only a session that did literally nothing. `dirty` is flipped true by
  // post-tool-use on the first tool call of ANY kind (Read/Bash/Edit/Write), so a
  // read-only or review session still prints its summary. The previous guard also
  // required a runId — minted only on Edit/Write — so every no-edit session was
  // silently skipped and the documented Session End box never rendered.
  if (!state.dirty) {
    await clearSessionState();
    process.exit(0);
  }

  const { blockedFiles, testCommand } = loadConfig();

  // Every summary needs a run to attach its VERIFICATION_*/RUN_* events to. A
  // read-only session never triggered ensureRun elsewhere, so mint one here.
  state = await ensureRun(state, "plugin:session-end");
  const runId = state.runId;

  // Only shell the test suite when this session actually edited files. Nothing was
  // changed otherwise, so there is nothing to re-verify — and running a full suite
  // on every read-only session end is the slow path that hits the hook timeout and
  // eats the summary. The boundary check (git diff) is cheap and always runs.
  const editCount = (state.edits ?? 0) + (state.writes ?? 0);
  const shouldRunTests = editCount > 0 && Boolean(testCommand);

  console.log(
    shouldRunTests
      ? `\n[agentledger] Running: ${testCommand}`
      : "\n[agentledger] No edits this session — verifying boundaries only"
  );

  const result = verify({
    testCommand: shouldRunTests ? testCommand : "",
    blockedFiles,
    projectDir,
    testTimeout: TEST_TIMEOUT_MS,
  });
  const { violations, testExitCode, testsPassed, boundaryClean, testTimedOut } = result;

  // A skipped suite is neither pass nor fail — verification then rides on the
  // boundary check alone. A timed-out suite is inconclusive and treated as
  // not-passed so Status never falsely reports PASSED.
  const testsOk = !shouldRunTests || (testsPassed && !testTimedOut);
  const verificationPassed = testsOk && boundaryClean;

  // Build reason string for failed verification
  let verificationReason = "";
  if (!boundaryClean) {
    verificationReason = `BOUNDARY_VIOLATION: ${violations.map((v) => v.file).join(", ")}`;
    await appendEvent(runId, "BOUNDARY_VIOLATION", {
      violations: violations.map((v) => ({ file: v.file, matched_pattern: v.pattern })),
      detected_by: "git-diff",
    });
  }
  if (shouldRunTests && testTimedOut) {
    const timeoutReason = `TESTS_TIMED_OUT (>${TEST_TIMEOUT_MS / 1000}s)`;
    verificationReason = verificationReason ? `${verificationReason}; ${timeoutReason}` : timeoutReason;
  } else if (shouldRunTests && !testsPassed) {
    const failReason = `TESTS_FAILED (exit ${testExitCode})`;
    verificationReason = verificationReason ? `${verificationReason}; ${failReason}` : failReason;
  }

  // Emit verification event
  if (verificationPassed) {
    await appendEvent(runId, "VERIFICATION_PASSED", {
      test_command: shouldRunTests ? testCommand : null,
      tests_run: shouldRunTests,
      exit_code: shouldRunTests ? 0 : null,
      boundary_violations: 0,
    });
  } else {
    await appendEvent(runId, "VERIFICATION_FAILED", {
      test_command: shouldRunTests ? testCommand : null,
      tests_run: shouldRunTests,
      timed_out: shouldRunTests && testTimedOut,
      exit_code: shouldRunTests ? testExitCode : null,
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

  // Build the enhanced summary as an array so it can be BOTH printed and
  // persisted. SessionEnd stdout is swallowed by Claude Code (terminal is tearing
  // down), so console.log alone is invisible. writeLastSummary persists the box for
  // the next SessionStart to replay into a rendered systemMessage — see end-summary.js.
  const box = [];
  box.push("");
  box.push("╔═══════════════════════════════════════╗");
  box.push("║       AgentLedger — Session End       ║");
  box.push("╚═══════════════════════════════════════╝");
  box.push(`  Status     : ${verificationPassed ? "✓ PASSED" : "✗ FAILED"}`);

  if (sessionClaims > 0) {
    box.push(`  Claims     : ${sessionClaims} made · ${state.claimsVerifiedTrue ?? 0} verified · ${sessionFalse} false`);
  }

  if (violations.length > 0) {
    box.push(`  Boundary   : ${violations.length} violation(s) detected`);
    for (const v of violations) {
      box.push(`    - ${v.file}  [${v.pattern}]`);
    }
  } else {
    box.push("  Boundary   : ✓ clean");
  }
  const testsDisplay = !shouldRunTests
    ? "— (no edits)"
    : testTimedOut
      ? `timeout (>${TEST_TIMEOUT_MS / 1000}s)`
      : `exit ${testExitCode}`;
  box.push(`  Tests      : ${testsDisplay}`);
  box.push(`  Read:Edit  : ${readEditRatio}x (${readEditLabel})`);

  if (trustBefore !== null) {
    const delta = trustAfter - trustBefore;
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    box.push(`  Trust Δ    : ${trustBefore}% → ${trustAfter}%  ${arrow}`);
  } else if (sessionClaims > 0) {
    box.push(`  Trust      : ${trustAfter}% (first measurement)`);
  }

  if ((state.editWithoutRead ?? []).length > 0) {
    box.push(`  ⚠ Edited without reading: ${state.editWithoutRead.map((f) => path.basename(f)).join(", ")}`);
  }

  box.push("");

  const boxText = box.join("\n");
  console.log(boxText);
  // Persist so the next SessionStart can render it (the only reliably visible path).
  writeLastSummary(projectDir, boxText);

  // Clear session state
  await clearSessionState();

  process.exit(0);
}

main().catch((err) => {
  console.error("[agentledger] session-end error:", err?.message);
  clearSessionState().catch(() => {});
  process.exit(0);
});
