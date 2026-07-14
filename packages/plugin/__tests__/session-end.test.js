import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { spawnSync, execSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SCRIPT = fileURLToPath(
  new URL("../scripts/hooks/session-end.js", import.meta.url)
);

const POST_SCRIPT = fileURLToPath(
  new URL("../scripts/hooks/post-tool-use.js", import.meta.url)
);

function runHook(projectDir) {
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    timeout: 30_000, // testCommand can take time
  });
}

function runPostHook(projectDir, stdinData) {
  return spawnSync("node", [POST_SCRIPT], {
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

/**
 * Initialize a git repo with an initial commit in tmpDir.
 * Returns tmpDir for chaining.
 */
function initGitRepo(dir) {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@agentledger.test'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'AgentLedger Test'", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "# Test Repo");
  execSync("git add README.md", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m 'initial commit'", { cwd: dir, stdio: "pipe" });
}

describe("session-end hook", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentledger-session-end-"));
  });

  it("exits cleanly without ledger events when dirty=false", () => {
    writeConfig(tmpDir, { blockedFiles: ["**/.env"], testCommand: "echo ok" });
    // Session exists but dirty=false — no active run to verify
    writeSession(tmpDir, { runId: "run-123", dirty: false, sessionStart: new Date().toISOString() });

    const result = runHook(tmpDir);

    expect(result.status).toBe(0);
    // No ledger should exist (or be empty) since no run was initialized
    const events = readLedger(tmpDir);
    expect(events).toHaveLength(0);
  });

  it("exits cleanly without ledger events when runId is null", () => {
    writeConfig(tmpDir, { blockedFiles: ["**/.env"], testCommand: "echo ok" });
    writeSession(tmpDir, { runId: null, dirty: true, sessionStart: new Date().toISOString() });

    const result = runHook(tmpDir);

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    expect(events).toHaveLength(0);
  });

  it("emits VERIFICATION_PASSED and RUN_COMPLETED when tests pass", () => {
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env"],
      testCommand: "exit 0",
    });

    // Use post-tool-use to create a real run (creates RUN_CREATED + INTENT_COMPILED + TOOL_CALLED)
    runPostHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "src", "app.ts") },
      tool_response: {},
    });

    const result = runHook(tmpDir);

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    const types = events.map((e) => e.event_type);
    expect(types).toContain("VERIFICATION_PASSED");
    expect(types).toContain("RUN_COMPLETED");
    expect(types).not.toContain("VERIFICATION_FAILED");
    expect(types).not.toContain("RUN_FAILED");
  });

  it("emits VERIFICATION_FAILED and RUN_FAILED when tests fail", () => {
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env"],
      testCommand: "exit 1",
    });

    // Create run via post-tool-use
    runPostHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "src", "app.ts") },
      tool_response: {},
    });

    const result = runHook(tmpDir);

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    const types = events.map((e) => e.event_type);
    expect(types).toContain("VERIFICATION_FAILED");
    expect(types).toContain("RUN_FAILED");
    expect(types).not.toContain("VERIFICATION_PASSED");
    expect(types).not.toContain("RUN_COMPLETED");

    const failedEvent = events.find((e) => e.event_type === "VERIFICATION_FAILED");
    expect(failedEvent.payload.exit_code).not.toBe(0);
  });

  it("emits BOUNDARY_VIOLATION when a blocked file appears in git diff", () => {
    initGitRepo(tmpDir);
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env"],
      testCommand: "exit 0",
    });

    // Stage a .env file without committing — it shows in git diff --name-only HEAD
    writeFileSync(join(tmpDir, ".env"), "SECRET=hunter2");
    execSync("git add .env", { cwd: tmpDir, stdio: "pipe" });

    // Create run
    runPostHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "README.md") },
      tool_response: {},
    });

    const result = runHook(tmpDir);

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    const types = events.map((e) => e.event_type);
    expect(types).toContain("BOUNDARY_VIOLATION");
    expect(types).toContain("VERIFICATION_FAILED");

    const violation = events.find((e) => e.event_type === "BOUNDARY_VIOLATION");
    expect(violation.payload.violations[0].file).toBe(".env");
  });

  it("clears session state after the run completes", () => {
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env"],
      testCommand: "exit 0",
    });

    // Create run
    runPostHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "file.ts") },
      tool_response: {},
    });

    const sessionPath = join(tmpDir, ".agentledger", "session.json");
    expect(existsSync(sessionPath)).toBe(true);

    runHook(tmpDir);

    // session.json should be deleted after session-end finalizes
    expect(existsSync(sessionPath)).toBe(false);
  });
});
