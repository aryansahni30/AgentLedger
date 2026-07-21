/**
 * Stop hook — the Lie Detector's entry point.
 *
 * These drive the real hook as a subprocess against a real project, a real
 * transcript, a real test command and the real LedgerWriter. Nothing is mocked.
 *
 * That is deliberate. The hook shipped with unit tests that asserted on the
 * detector's return value and never exercised an append, so a schema mismatch
 * (CLAIM_* types missing from LedgerEventTypeSchema) rejected every event while
 * the hook reported success. Assertions here are against bytes on disk.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SCRIPT = fileURLToPath(new URL("../scripts/hooks/stop.js", import.meta.url));

const PASSING_TEST_CMD = "node -e \"process.exit(0)\"";
const FAILING_TEST_CMD = "node -e \"process.exit(1)\"";

let projectDir;

function writeConfig(config) {
  mkdirSync(join(projectDir, ".agentledger"), { recursive: true });
  writeFileSync(
    join(projectDir, ".agentledger", "config.json"),
    JSON.stringify(config, null, 2)
  );
}

/** Seed a session that has already done work. Override the counters to vary that. */
function writeSessionState(overrides = {}) {
  mkdirSync(join(projectDir, ".agentledger"), { recursive: true });
  writeFileSync(
    join(projectDir, ".agentledger", "session.json"),
    JSON.stringify({
      runId: "run_test_123",
      dirty: true,
      sessionStart: new Date().toISOString(),
      reads: 3,
      edits: 5,
      writes: 1,
      bashCalls: 2,
      blocks: 0,
      warnings: 0,
      claimsDetected: 0,
      claimsVerifiedTrue: 0,
      claimsVerifiedFalse: 0,
      claimsUnverifiable: 0,
      filesRead: [],
      filesEdited: [],
      editWithoutRead: [],
      falseClaims: [],
      recentVerifications: {},
      ...overrides,
    })
  );
}

/** Write a Claude Code transcript whose last assistant turn says `text`. */
function writeTranscript(text) {
  const path = join(projectDir, "transcript.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "build it" } }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
    }),
  ];
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

function runStopHook(transcriptPath) {
  return spawnSync("node", [SCRIPT], {
    input: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "sess_test",
      transcript_path: transcriptPath,
      stop_hook_active: false,
      cwd: projectDir,
    }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    timeout: 30_000,
  });
}

function readLedger() {
  const p = join(projectDir, ".agentledger", "ledger.jsonl");
  if (!existsSync(p)) return [];
  const content = readFileSync(p, "utf8").trim();
  if (!content) return [];
  return content.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function readSessionState() {
  return JSON.parse(readFileSync(join(projectDir, ".agentledger", "session.json"), "utf8"));
}

function eventTypes() {
  return readLedger().map((e) => e.event_type);
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "agentledger-stop-"));
});

describe("Stop hook — claim falsified", () => {
  it("records CLAIM_DETECTED and CLAIM_FALSIFIED when the test command fails", () => {
    // Arrange — Claude claims the suite is green; the suite exits 1.
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: ["**/.env"] });
    writeSessionState();
    const transcript = writeTranscript("Implemented the endpoint. 48 tests pass, typecheck clean.");

    // Act
    runStopHook(transcript);

    // Assert
    expect(eventTypes()).toContain("CLAIM_DETECTED");
    expect(eventTypes()).toContain("CLAIM_FALSIFIED");
    expect(eventTypes()).not.toContain("CLAIM_VERIFIED");
  });

  it("records the real exit code as evidence, not the claim", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState();

    // Act
    runStopHook(writeTranscript("All 48 tests pass."));

    // Assert
    const falsified = readLedger().find((e) => e.event_type === "CLAIM_FALSIFIED");
    expect(falsified.payload.claim_text).toBe("tests pass");
    expect(falsified.payload.verification.test_exit_code).toBe(1);
    expect(falsified.payload.actual).toContain("exit 1");
  });

  it("warns the user on stderr when a claim is contradicted", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState();

    // Act
    const result = runStopHook(writeTranscript("Done — the tests pass."));

    // Assert
    expect(result.stderr).toContain("CLAIM CHECK");
  });

  it("counts the false claim in session state", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState();

    // Act
    runStopHook(writeTranscript("48 tests pass."));

    // Assert
    const state = readSessionState();
    expect(state.claimsVerifiedFalse).toBe(1);
    expect(state.falseClaims).toHaveLength(1);
  });
});

describe("Stop hook — counters accumulate correctly across multiple claims", () => {
  // "48 tests pass, typecheck clean" yields two claims (test_claim + build_claim) from a
  // single turn, so a per-claim loop runs twice. Counters that re-read the pre-turn state
  // inside that loop double-count. A session whose prior counts are all zero hides this —
  // 0 + 0 + 1 is correct by luck — so these seed non-zero priors on purpose.

  it("adds exactly one per falsified claim to a non-zero prior count", () => {
    // Arrange — 5 lies already on record this session, 2 more coming
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ claimsVerifiedFalse: 5 });

    // Act
    runStopHook(writeTranscript("48 tests pass, typecheck clean."));

    // Assert
    expect(readSessionState().claimsVerifiedFalse).toBe(7);
  });

  it("adds exactly one per verified claim to a non-zero prior count", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: PASSING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ claimsVerifiedTrue: 5 });

    // Act
    runStopHook(writeTranscript("48 tests pass, typecheck clean."));

    // Assert
    expect(readSessionState().claimsVerifiedTrue).toBe(7);
  });

  it("adds exactly one per unverifiable claim to a non-zero prior count", () => {
    // Arrange — no test command, so claims cannot be checked
    writeConfig({ operator: "test", testCommand: "", blockedFiles: [] });
    writeSessionState({ claimsUnverifiable: 5 });

    // Act
    runStopHook(writeTranscript("48 tests pass, typecheck clean."));

    // Assert
    expect(readSessionState().claimsUnverifiable).toBe(7);
  });

  it("appends new false claims without duplicating existing history", () => {
    // Arrange — one lie already recorded
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    const priorClaim = { claim: "earlier lie", actual: "exit 1", timestamp: "2026-01-01T00:00:00.000Z" };
    writeSessionState({ claimsVerifiedFalse: 1, falseClaims: [priorClaim] });

    // Act
    runStopHook(writeTranscript("48 tests pass, typecheck clean."));

    // Assert — the prior claim appears exactly once, plus the two new ones
    const { falseClaims } = readSessionState();
    expect(falseClaims.filter((c) => c.claim === "earlier lie")).toHaveLength(1);
    expect(falseClaims).toHaveLength(3);
  });
});

describe("Stop hook — claim verified", () => {
  it("records CLAIM_VERIFIED when the test command actually passes", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: PASSING_TEST_CMD, blockedFiles: [] });
    writeSessionState();

    // Act
    runStopHook(writeTranscript("48 tests pass, typecheck clean."));

    // Assert
    expect(eventTypes()).toContain("CLAIM_DETECTED");
    expect(eventTypes()).toContain("CLAIM_VERIFIED");
    expect(eventTypes()).not.toContain("CLAIM_FALSIFIED");
  });
});

describe("Stop hook — ledger integrity", () => {
  it("hash-chains claim events onto the existing ledger", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState();

    // Act
    runStopHook(writeTranscript("The tests pass."));

    // Assert — every event links to its predecessor
    const events = readLedger();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].previous_hash).toBe("genesis");
    for (let i = 1; i < events.length; i++) {
      expect(events[i].previous_hash).toBe(events[i - 1].hash);
    }
  });

  it("writes events under the session's run_id", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ runId: "run_specific_id" });

    // Act
    runStopHook(writeTranscript("The tests pass."));

    // Assert
    expect(readLedger().every((e) => e.run_id === "run_specific_id")).toBe(true);
  });
});

describe("Stop hook — quiet paths", () => {
  it("records nothing when the assistant makes no claim", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState();

    // Act
    runStopHook(writeTranscript("Here is what the redirect endpoint does, and why 302."));

    // Assert
    expect(readLedger()).toHaveLength(0);
  });

  it("records nothing when the session made no tool calls at all", () => {
    // Arrange — nothing happened, so there is nothing for a claim to be about
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ reads: 0, edits: 0, writes: 0, bashCalls: 0 });

    // Act
    runStopHook(writeTranscript("48 tests pass."));

    // Assert
    expect(readLedger()).toHaveLength(0);
  });

  it("does not re-verify the same claim type inside the debounce window", () => {
    // Arrange — a verification for test_claim just happened
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ recentVerifications: { test_claim: Date.now() } });

    // Act
    runStopHook(writeTranscript("48 tests pass."));

    // Assert
    expect(readLedger()).toHaveLength(0);
  });

  it("exits zero and never blocks the session, even with no config", () => {
    // Arrange — no config, no state
    const transcript = writeTranscript("48 tests pass.");

    // Act
    const result = runStopHook(transcript);

    // Assert
    expect(result.status).toBe(0);
  });
});

/**
 * The scenario the hook was built for, and the one it silently skipped in every
 * live session: Claude runs the suite and reports the result without editing a
 * file. The old guard keyed on edits+writes, so a run-tests-and-report turn —
 * the single most common way an agent misreports — was never checked. Every
 * test above seeds edits:5 and a runId, which is exactly why they all passed
 * while the live hook did nothing.
 */
describe("Stop hook — claims from sessions that changed no files", () => {
  it("verifies a test claim from a session that only ran commands", () => {
    // Arrange — Bash only: no edits, no writes. Claude claims green; suite exits 1.
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ reads: 0, edits: 0, writes: 0, bashCalls: 1 });

    // Act
    runStopHook(writeTranscript("All green: 48 tests pass across 6 files."));

    // Assert
    expect(eventTypes()).toContain("CLAIM_DETECTED");
    expect(eventTypes()).toContain("CLAIM_FALSIFIED");
  });

  it("verifies a test claim from a read-only session", () => {
    // Arrange — a claim about tests Claude never ran is the most suspect of all
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ reads: 2, edits: 0, writes: 0, bashCalls: 0 });

    // Act
    runStopHook(writeTranscript("All green: 48 tests pass across 6 files."));

    // Assert
    expect(eventTypes()).toContain("CLAIM_FALSIFIED");
  });

  it("creates a run lazily so the claim has somewhere to land", () => {
    // Arrange — no Edit/Write means no hook ever lazy-inited a run: runId is null
    writeConfig({ operator: "test", testCommand: PASSING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ runId: null, reads: 0, edits: 0, writes: 0, bashCalls: 1 });

    // Act
    runStopHook(writeTranscript("All green: 48 tests pass across 6 files."));

    // Assert — the run is created and the claim is chained onto it
    expect(eventTypes()).toEqual([
      "RUN_CREATED",
      "INTENT_COMPILED",
      "CLAIM_DETECTED",
      "CLAIM_VERIFIED",
    ]);
    const runIds = new Set(readLedger().map((e) => e.run_id));
    expect(runIds.size).toBe(1);
  });

  it("persists the lazily created runId so later hooks reuse it", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: PASSING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ runId: null, reads: 0, edits: 0, writes: 0, bashCalls: 1 });

    // Act
    runStopHook(writeTranscript("All green: 48 tests pass across 6 files."));

    // Assert
    const runId = readSessionState().runId;
    expect(runId).toBeTruthy();
    expect(readLedger()[0].run_id).toBe(runId);
  });
});

/**
 * Payload shape, pinned against a real Stop payload captured from a live
 * session. The hook's original fallbacks read `stop_response` and `content` —
 * neither field exists in any payload Claude Code actually sends.
 */
describe("Stop hook — live payload shape", () => {
  it("reads the claim from last_assistant_message when no transcript is parsed", () => {
    // Arrange
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ reads: 0, edits: 0, writes: 0, bashCalls: 1 });

    // Act — the exact field set of a captured live payload, no transcript_path
    spawnSync("node", [SCRIPT], {
      input: JSON.stringify({
        session_id: "2369ab27-86c8-49e7-a868-587e03c0e636",
        cwd: projectDir,
        permission_mode: "acceptEdits",
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "All green: 48 tests pass across 6 files in 464ms, no failures.",
        background_tasks: [],
      }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      timeout: 30_000,
    });

    // Assert
    expect(eventTypes()).toContain("CLAIM_FALSIFIED");
  });

  it("prefers last_assistant_message over a stale transcript", () => {
    // Arrange — transcript holds an older turn; the payload holds the current one
    writeConfig({ operator: "test", testCommand: FAILING_TEST_CMD, blockedFiles: [] });
    writeSessionState({ reads: 0, edits: 0, writes: 0, bashCalls: 1 });
    const transcript = writeTranscript("Let me look at the redirect handler.");

    // Act
    spawnSync("node", [SCRIPT], {
      input: JSON.stringify({
        hook_event_name: "Stop",
        transcript_path: transcript,
        last_assistant_message: "All green: 48 tests pass across 6 files.",
        cwd: projectDir,
      }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      timeout: 30_000,
    });

    // Assert
    expect(eventTypes()).toContain("CLAIM_FALSIFIED");
  });
});

/**
 * RUN_CREATED reaches the ledger before verification runs, and verification can
 * spend 30s against a 45s hook timeout. If the hook is killed in that window the
 * runId must already be on disk, or the run is stranded and the next turn mints
 * another one.
 */
describe("Stop hook — lazily created run survives a kill during verification", () => {
  it("persists the runId before the test command runs", () => {
    // Arrange — a test command slower than the hook's patience, so the kill lands
    // inside verification, after the run exists
    writeConfig({
      operator: "test",
      testCommand: "node -e \"setTimeout(() => process.exit(0), 10000)\"",
      blockedFiles: [],
    });
    writeSessionState({ runId: null, reads: 0, edits: 0, writes: 0, bashCalls: 1 });

    // Act — kill the hook mid-verification
    spawnSync("node", [SCRIPT], {
      input: JSON.stringify({
        hook_event_name: "Stop",
        last_assistant_message: "All green: 48 tests pass across 6 files.",
        cwd: projectDir,
      }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      timeout: 2_000,
      killSignal: "SIGKILL",
    });

    // Assert — the run is on disk, and it is the one the ledger recorded
    const runId = readSessionState().runId;
    expect(runId).toBeTruthy();
    expect(readLedger().find((e) => e.event_type === "RUN_CREATED").run_id).toBe(runId);
  });
});
