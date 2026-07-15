import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SCRIPT = fileURLToPath(
  new URL("../scripts/hooks/pre-tool-use.js", import.meta.url)
);

function runHook(projectDir, stdinData) {
  return spawnSync("node", [SCRIPT], {
    input: JSON.stringify(stdinData),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    timeout: 10_000,
  });
}

function readLedger(projectDir) {
  const ledgerPath = join(projectDir, ".agentledger", "ledger.jsonl");
  if (!existsSync(ledgerPath)) return [];
  const content = readFileSync(ledgerPath, "utf8").trim();
  if (!content) return [];
  return content.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function writeConfig(projectDir, config) {
  const dir = join(projectDir, ".agentledger");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2));
}

function writeSession(projectDir, state) {
  const dir = join(projectDir, ".agentledger");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), JSON.stringify(state, null, 2));
}

describe("pre-tool-use hook", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentledger-pre-tool-use-"));
  });

  it("blocks a write to a .env file with exit code 2", () => {
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
      testCommand: "echo ok",
    });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, ".env") },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(".env");
    expect(result.stderr).toContain("blocked");
  });

  it("allows a write to a non-blocked file (exit 0)", () => {
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env", "**/*.pem"],
      testCommand: "echo ok",
    });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "src", "index.ts") },
    });

    expect(result.status).toBe(0);
  });

  it("allows all files when blockedFiles is empty", () => {
    writeConfig(tmpDir, { blockedFiles: [], testCommand: "echo ok" });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, ".env") },
    });

    expect(result.status).toBe(0);
  });

  it("falls back to default blocked patterns when config is missing", () => {
    // No config.json written — hook uses hardcoded defaults
    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "prod.pem") },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("prod.pem");
    expect(result.stderr).toContain("blocked");
  });

  it("writes TOOL_DENIED ledger event when a run is active", async () => {
    // Active run pre-seeded in session state
    const agentledgerDir = join(tmpDir, ".agentledger");
    mkdirSync(agentledgerDir, { recursive: true });
    writeConfig(tmpDir, { blockedFiles: ["**/.env"], testCommand: "echo ok" });
    writeFileSync(join(agentledgerDir, "ledger.jsonl"), "");
    const runId = "test-run-id-12345";
    writeSession(tmpDir, { runId, dirty: true, sessionStart: new Date().toISOString() });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, ".env") },
    });

    expect(result.status).toBe(2);

    const events = readLedger(tmpDir);
    const denied = events.find((e) => e.event_type === "TOOL_DENIED");
    expect(denied).toBeDefined();
    expect(denied.run_id).toBe(runId);
    expect(denied.payload.tool).toBe("Edit");
    expect(denied.payload.file_path).toBe(join(tmpDir, ".env"));
    expect(denied.payload.matched_pattern).toBe("**/.env");
  });

  it("lazy-inits run when no active run and file is blocked", async () => {
    // No session state — no active run
    writeConfig(tmpDir, { blockedFiles: ["**/.env"], testCommand: "echo ok" });

    const result = runHook(tmpDir, {
      tool_name: "Write",
      tool_input: { file_path: join(tmpDir, ".env") },
    });

    expect(result.status).toBe(2);

    const events = readLedger(tmpDir);
    // Should have: RUN_CREATED, INTENT_COMPILED, TOOL_DENIED
    expect(events.length).toBe(3);
    expect(events[0].event_type).toBe("RUN_CREATED");
    expect(events[0].payload.run_mode).toBe("observed");
    expect(events[1].event_type).toBe("INTENT_COMPILED");
    expect(events[2].event_type).toBe("TOOL_DENIED");
    expect(events[2].payload.tool).toBe("Write");
    expect(events[2].payload.matched_pattern).toBe("**/.env");

    // Session state should have runId set
    const sessionPath = join(tmpDir, ".agentledger", "session.json");
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(session.runId).toBeTruthy();
    expect(session.dirty).toBe(true);
  });
});
