#!/usr/bin/env node
/**
 * Stop hook — real-time claim detection and instant verification.
 *
 * Fires every time Claude finishes responding. Scans the assistant's
 * last message for completion claims ("tests pass", "fixed", "done").
 * When a claim is detected, runs quick verification (test command +
 * boundary check) and surfaces any discrepancy immediately.
 *
 * Hook input on stdin:
 *   { stop_hook_active: true, transcript_path?: string, ... }
 *
 * Output (stderr, user-visible):
 *   ⚠ CLAIM CHECK: Claude said "tests pass" → actual: npm test exit 1
 *   ✓ CLAIM CHECK: Claude said "fixed" → verified: tests pass, no violations
 */

import fs from "fs";
import path from "path";
import { readSessionState, writeSessionState } from "../state.js";
import { detectClaims, classifyClaims } from "../claim-detector.js";
import { verify } from "../verifier.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const configPath = path.join(projectDir, ".agentledger", "config.json");
const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");

const DEBOUNCE_MS = 60_000; // Don't re-verify same claim type within 60s
const TEST_TIMEOUT_MS = 30_000; // Shorter timeout for mid-session checks

/** @type {Map<string, number>} claim type → last verification timestamp */
const recentVerifications = new Map();

/** @returns {{ blockedFiles: string[], testCommand: string, claimDetection: boolean }} */
function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    return {
      blockedFiles: Array.isArray(config.blockedFiles)
        ? config.blockedFiles
        : ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
      testCommand: typeof config.testCommand === "string" ? config.testCommand : "npm test",
      claimDetection: config.claimDetection !== false, // default on
    };
  } catch {
    return {
      blockedFiles: ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
      testCommand: "npm test",
      claimDetection: true,
    };
  }
}

/**
 * Extract the assistant's last message from the transcript file.
 * Claude Code writes a JSONL transcript; we read the last assistant turn.
 *
 * @param {string} transcriptPath
 * @returns {string}
 */
function readLastAssistantMessage(transcriptPath) {
  try {
    const raw = fs.readFileSync(transcriptPath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);

    // Walk backwards to find last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === "assistant") {
          const content = entry.message?.content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            return content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n");
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Transcript not available
  }
  return "";
}

/**
 * Read the assistant's last message from stdin hook input.
 * The Stop hook receives the conversation context.
 *
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function extractAssistantMessage(input) {
  // Stop hook may provide transcript_path or inline message
  if (input?.transcript_path) {
    return readLastAssistantMessage(String(input.transcript_path));
  }

  // Try to get from stop_response or last message
  if (typeof input?.stop_response === "string") {
    return input.stop_response;
  }

  // Try content array format
  if (Array.isArray(input?.content)) {
    return input.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  return "";
}

/**
 * Check if a claim type was recently verified (within debounce window).
 * @param {string} claimType
 * @returns {boolean}
 */
function isDebounced(claimType) {
  const last = recentVerifications.get(claimType);
  if (!last) return false;
  return Date.now() - last < DEBOUNCE_MS;
}

/**
 * Append a claim event to the ledger.
 * @param {string} runId
 * @param {string} eventType
 * @param {Record<string, unknown>} payload
 */
async function appendClaimEvent(runId, eventType, payload) {
  if (!runId) return;

  try {
    const { LedgerWriter } = await import("@agentledger/core");
    const writer = new LedgerWriter(ledgerPath);
    await writer.appendEvent({
      event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      run_id: runId,
      timestamp: new Date().toISOString(),
      actor: "plugin:stop",
      event_type: eventType,
      payload,
    });
  } catch {
    // Non-fatal — claim check still happens
  }
}

async function main() {
  const config = loadConfig();

  // Claim detection disabled in config
  if (!config.claimDetection) {
    process.exit(0);
  }

  // Read hook input
  let input;
  try {
    const raw = fs.readFileSync("/dev/stdin", "utf8");
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // Extract assistant message
  const message = extractAssistantMessage(input);
  if (!message) {
    process.exit(0);
  }

  // Detect claims
  const claims = detectClaims(message);
  if (claims.length === 0) {
    process.exit(0);
  }

  // Filter out debounced claim types
  const freshClaims = claims.filter((c) => !isDebounced(c.type));
  if (freshClaims.length === 0) {
    process.exit(0);
  }

  const state = await readSessionState();

  // Skip if no file changes in this session (informational statement, not work claim)
  const hasFileChanges = (state.edits ?? 0) + (state.writes ?? 0) > 0;
  if (!hasFileChanges) {
    process.exit(0);
  }

  // Classify claims
  const hasTestCommand = Boolean(config.testCommand);
  const { verifiable, unverifiable } = classifyClaims(freshClaims, hasTestCommand);

  let stateUpdates = {
    claimsDetected: (state.claimsDetected ?? 0) + freshClaims.length,
  };

  // Log unverifiable claims
  for (const claim of unverifiable) {
    await appendClaimEvent(state.runId, "CLAIM_UNVERIFIABLE", {
      claim_text: claim.text,
      claim_type: claim.type,
      reason: "no test command configured",
    });
    stateUpdates = {
      ...stateUpdates,
      claimsUnverifiable: (state.claimsUnverifiable ?? 0) + (stateUpdates.claimsUnverifiable ?? 0) + 1,
    };
  }

  // Verify verifiable claims
  if (verifiable.length > 0) {
    const result = verify({
      testCommand: config.testCommand,
      blockedFiles: config.blockedFiles,
      projectDir,
      testTimeout: TEST_TIMEOUT_MS,
    });

    for (const claim of verifiable) {
      recentVerifications.set(claim.type, Date.now());

      const passed = result.testsPassed && result.boundaryClean;

      if (passed) {
        // Verified true
        await appendClaimEvent(state.runId, "CLAIM_VERIFIED", {
          claim_text: claim.text,
          claim_type: claim.type,
          verification: {
            test_exit_code: result.testExitCode,
            boundary_clean: result.boundaryClean,
          },
        });

        process.stderr.write(
          `✓ CLAIM CHECK: Claude said "${claim.text}" → verified: tests pass, no violations\n`
        );

        stateUpdates = {
          ...stateUpdates,
          claimsVerifiedTrue: (state.claimsVerifiedTrue ?? 0) + (stateUpdates.claimsVerifiedTrue ?? 0) + 1,
        };
      } else {
        // Falsified
        const actualParts = [];
        if (!result.testsPassed) actualParts.push(`${config.testCommand} exit ${result.testExitCode}`);
        if (!result.boundaryClean) actualParts.push(`${result.violations.length} boundary violation(s)`);
        const actual = actualParts.join(", ");

        await appendClaimEvent(state.runId, "CLAIM_FALSIFIED", {
          claim_text: claim.text,
          claim_type: claim.type,
          expected: claim.text,
          actual,
          verification: {
            test_exit_code: result.testExitCode,
            boundary_clean: result.boundaryClean,
            violations: result.violations,
          },
        });

        process.stderr.write(
          `⚠ CLAIM CHECK: Claude said "${claim.text}" → actual: ${actual}\n`
        );

        const falseClaims = state.falseClaims ?? [];
        stateUpdates = {
          ...stateUpdates,
          claimsVerifiedFalse: (state.claimsVerifiedFalse ?? 0) + (stateUpdates.claimsVerifiedFalse ?? 0) + 1,
          falseClaims: [...falseClaims, ...(stateUpdates.falseClaims ?? []), {
            claim: claim.text,
            actual,
            timestamp: new Date().toISOString(),
          }],
        };
      }
    }
  }

  // Update session state with claim counters
  await writeSessionState({ ...state, ...stateUpdates });

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[agentledger] stop hook error: ${err?.message}\n`);
  process.exit(0); // Never block Claude Code on plugin error
});
