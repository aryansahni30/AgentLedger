import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";
import { readSessionState, writeSessionState, clearSessionState } from "../scripts/state.js";

describe("state.js", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-state-test-"));
    // sessionStatePath() reads CLAUDE_PROJECT_DIR at call time — set here
    process.env["CLAUDE_PROJECT_DIR"] = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env["CLAUDE_PROJECT_DIR"];
  });

  it("readSessionState returns defaults when session.json missing", async () => {
    const state = await readSessionState();

    expect(state.runId).toBeNull();
    expect(state.dirty).toBe(false);
    expect(typeof state.sessionStart).toBe("string");
  });

  it("writeSessionState creates session.json if missing", async () => {
    const statePath = join(tmpDir, ".agentledger", "session.json");

    expect(existsSync(statePath)).toBe(false);

    await writeSessionState({ runId: "run-123", dirty: true, sessionStart: new Date().toISOString() });

    expect(existsSync(statePath)).toBe(true);
    const after = await readSessionState();
    expect(after.runId).toBe("run-123");
    expect(after.dirty).toBe(true);
  });

  it("readSessionState returns written value", async () => {
    const ts = new Date().toISOString();

    await writeSessionState({ runId: "run-abc", dirty: false, sessionStart: ts });
    const state = await readSessionState();

    expect(state.runId).toBe("run-abc");
    expect(state.dirty).toBe(false);
    expect(state.sessionStart).toBe(ts);
  });

  it("clearSessionState removes session.json", async () => {
    const statePath = join(tmpDir, ".agentledger", "session.json");

    await writeSessionState({ runId: "run-xyz", dirty: true, sessionStart: new Date().toISOString() });
    expect(existsSync(statePath)).toBe(true);

    await clearSessionState();
    expect(existsSync(statePath)).toBe(false);
  });

  it("concurrent writes produce valid JSON, no corruption", async () => {
    // Initialize file first
    await writeSessionState({ runId: null, dirty: false, sessionStart: new Date().toISOString() });

    // 5 concurrent writes
    const writes = Array.from({ length: 5 }, (_, i) =>
      writeSessionState({ runId: `run-${i}`, dirty: true, sessionStart: new Date().toISOString() })
    );
    await Promise.all(writes);

    // Should be readable valid JSON (last writer wins)
    const state = await readSessionState();
    expect(state).toBeDefined();
    expect(typeof state.runId).toBe("string");
    expect(typeof state.dirty).toBe("boolean");
  });
});
