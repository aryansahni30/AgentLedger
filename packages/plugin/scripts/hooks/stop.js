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
import { ensureRun } from "../run-init.js";
import { detectClaims, classifyClaims } from "../claim-detector.js";
import { verify } from "../verifier.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const configPath = path.join(projectDir, ".agentledger", "config.json");
const ledgerPath = path.join(projectDir, ".agentledger", "ledger.jsonl");

const DEBOUNCE_MS = 60_000; // Don't re-verify same claim type within 60s
const TEST_TIMEOUT_MS = 30_000; // Shorter timeout for mid-session checks

const DEBUG = Boolean(process.env["AGENTLEDGER_DEBUG"]);

/** @param {string} msg */
function trace(msg) {
  if (!DEBUG) return;
  process.stderr.write(`[agentledger:stop] ${msg}\n`);
  try {
    fs.appendFileSync(
      path.join(projectDir, ".agentledger", "stop-debug.log"),
      `${new Date().toISOString()} ${msg}\n`
    );
  } catch {
    // debug logging must never break the hook
  }
}

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
 *
 * Field order is taken from a captured live Stop payload, which carries:
 *   session_id, transcript_path, cwd, prompt_id, permission_mode, effort,
 *   hook_event_name, stop_hook_active, last_assistant_message, background_tasks
 *
 * `last_assistant_message` is preferred: it is exactly the turn that was just
 * spoken, and it costs nothing, where the transcript fallback re-parses a file
 * that reaches megabytes in a long session and returns "" if the final assistant
 * entry happens to hold only tool_use blocks. The fallback stays for payload
 * shapes that omit the field.
 *
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function extractAssistantMessage(input) {
  if (typeof input?.last_assistant_message === "string" && input.last_assistant_message) {
    return input.last_assistant_message;
  }

  if (input?.transcript_path) {
    return readLastAssistantMessage(String(input.transcript_path));
  }

  return "";
}

/**
 * Check if a claim type was recently verified (within debounce window).
 *
 * The window is read from session state, not process memory: this hook runs as a
 * fresh process on every assistant turn, so a module-level Map would be empty on
 * each invocation and debounce nothing. It previously was, and did.
 *
 * @param {Record<string, number> | undefined} recentVerifications
 * @param {string} claimType
 * @returns {boolean}
 */
function isDebounced(recentVerifications, claimType) {
  const last = recentVerifications?.[claimType];
  if (!last) return false;
  return Date.now() - last < DEBOUNCE_MS;
}

/**
 * Append a claim event to the ledger.
 *
 * Failures are reported, never swallowed. A silent catch here is what hid a
 * schema mismatch for an entire release: every CLAIM_* append threw because the
 * event types were missing from LedgerEventTypeSchema, and the ledger recorded
 * nothing while the hook reported success. A detector that fails silently is
 * worse than no detector, because it is trusted.
 *
 * @param {string} runId
 * @param {string} eventType
 * @param {Record<string, unknown>} payload
 * @returns {Promise<boolean>} whether the event was durably written
 */
async function appendClaimEvent(runId, eventType, payload) {
  if (!runId) {
    process.stderr.write(
      `[agentledger] cannot record ${eventType}: no run_id in session state\n`
    );
    return false;
  }

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
    return true;
  } catch (err) {
    process.stderr.write(
      `[agentledger] FAILED to record ${eventType} to the ledger: ${err?.message ?? err}\n`
    );
    return false;
  }
}

async function main() {
  trace(`entry: projectDir=${projectDir} cwd=${process.cwd()}`);
  const config = loadConfig();

  // Claim detection disabled in config
  if (!config.claimDetection) {
    trace("EXIT guard=claimDetection-disabled");
    process.exit(0);
  }

  // Read hook input
  let input;
  try {
    const raw = fs.readFileSync(0, "utf8");
    trace(`stdin: ${raw.length} bytes, keys=${Object.keys(JSON.parse(raw)).join(",")}`);
    if (DEBUG) fs.writeFileSync(path.join(projectDir, ".agentledger", "last-stop-payload.json"), raw);
    input = JSON.parse(raw);
  } catch (err) {
    trace(`EXIT guard=stdin-unreadable: ${err?.message}`);
    process.exit(0);
  }

  // Extract assistant message
  const message = extractAssistantMessage(input);
  if (!message) {
    trace(`EXIT guard=no-message (transcript_path=${input?.transcript_path ?? "ABSENT"})`);
    process.exit(0);
  }
  trace(`message: ${message.length} chars: ${JSON.stringify(message.slice(0, 120))}`);

  // Detect claims
  const claims = detectClaims(message);
  if (claims.length === 0) {
    trace("EXIT guard=no-claims-detected");
    process.exit(0);
  }
  trace(`claims: ${claims.map((c) => `${c.type}:"${c.text}"`).join(", ")}`);

  let state = await readSessionState();
  trace(
    `state: runId=${state.runId} edits=${state.edits} writes=${state.writes} ` +
      `bash=${state.bashCalls} recentVerifications=${JSON.stringify(state.recentVerifications ?? {})}`
  );

  // Filter out debounced claim types (window persisted in session state)
  const freshClaims = claims.filter((c) => !isDebounced(state.recentVerifications, c.type));
  if (freshClaims.length === 0) {
    trace("EXIT guard=debounced");
    process.exit(0);
  }

  // Skip only a session that has done literally nothing — a claim needs some work
  // to be about. This deliberately does NOT key on edits+writes, which it did until
  // it was found skipping every live session: "run the tests and tell me the result"
  // edits nothing, and misreporting a suite you ran but did not change is the exact
  // failure this hook exists to catch. Cost of the wider net is bounded by DEBOUNCE_MS.
  const toolCalls =
    (state.reads ?? 0) + (state.edits ?? 0) + (state.writes ?? 0) + (state.bashCalls ?? 0);
  if (toolCalls === 0) {
    trace("EXIT guard=no-tool-calls (nothing happened this session)");
    process.exit(0);
  }
  trace(`all guards passed (${toolCalls} tool calls) → verifying`);

  // A claim needs a run to attach to. No Edit or Write means no other hook has
  // lazy-inited one, so this hook is the first to see work worth recording.
  //
  // Persisted immediately, before verification rather than with the counters at the
  // end: RUN_CREATED is already in the ledger by this point, and verification below
  // can burn 30s against a 45s hook timeout. Being killed in between would strand a
  // run no session knows about, and every later turn would mint another one.
  const hadRun = Boolean(state.runId);
  state = await ensureRun(state, "plugin:stop");
  if (!hadRun) await writeSessionState(state);
  trace(`run: ${state.runId}${hadRun ? " (existing)" : " (created by stop)"}`);

  // Classify claims
  const hasTestCommand = Boolean(config.testCommand);
  const { verifiable, unverifiable } = classifyClaims(freshClaims, hasTestCommand);

  // Record every claim before checking it. The detection is a fact on its own —
  // if verification then crashes or times out, the ledger still shows what was
  // claimed, and an unresolved CLAIM_DETECTED is itself a signal.
  for (const claim of freshClaims) {
    await appendClaimEvent(state.runId, "CLAIM_DETECTED", {
      claim_text: claim.text,
      claim_type: claim.type,
      matched_pattern: claim.matchedPattern,
      verifiable: verifiable.includes(claim),
    });
  }

  // Seeded from the pre-turn state exactly once, then only ever incremented from its own
  // accumulated value below. Re-reading `state.X` inside the per-claim loops double-counts:
  // a turn saying "48 tests pass, typecheck clean" yields two claims, and `state.X + updates.X + 1`
  // on the second pass adds the prior total a second time (a prior 5 became 12, not 7).
  let stateUpdates = {
    claimsDetected: (state.claimsDetected ?? 0) + freshClaims.length,
    claimsUnverifiable: state.claimsUnverifiable ?? 0,
    claimsVerifiedTrue: state.claimsVerifiedTrue ?? 0,
    claimsVerifiedFalse: state.claimsVerifiedFalse ?? 0,
    falseClaims: [...(state.falseClaims ?? [])],
    recentVerifications: { ...(state.recentVerifications ?? {}) },
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
      claimsUnverifiable: stateUpdates.claimsUnverifiable + 1,
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
      stateUpdates = {
        ...stateUpdates,
        recentVerifications: { ...stateUpdates.recentVerifications, [claim.type]: Date.now() },
      };

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
          claimsVerifiedTrue: stateUpdates.claimsVerifiedTrue + 1,
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

        stateUpdates = {
          ...stateUpdates,
          claimsVerifiedFalse: stateUpdates.claimsVerifiedFalse + 1,
          falseClaims: [...stateUpdates.falseClaims, {
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
