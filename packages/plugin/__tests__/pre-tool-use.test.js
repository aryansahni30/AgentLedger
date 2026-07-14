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

  it("blocks a write to a .env file", () => {
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
      testCommand: "echo ok",
    });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, ".env") },
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain(".env");
  });

  it("allows a write to a non-blocked file", () => {
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env", "**/*.pem"],
      testCommand: "echo ok",
    });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "src", "index.ts") },
    });

    expect(result.status).toBe(0);
    // No block JSON emitted — stdout should not contain a block decision
    const stdout = result.stdout.trim();
    expect(stdout).not.toContain('"decision":"block"');
    expect(stdout).not.toContain('"decision": "block"');
  });

  it("allows all files when blockedFiles is empty", () => {
    writeConfig(tmpDir, { blockedFiles: [], testCommand: "echo ok" });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, ".env") },
    });

    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    expect(stdout).not.toContain('"decision"');
  });

  it("falls back to default blocked patterns when config is missing", () => {
    // No config.json written — hook uses hardcoded defaults
    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "prod.pem") },
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.decision).toBe("block");
  });

  it("writes TOOL_DENIED ledger event when a run is active", async () => {
    // Create ledger dir + config
    const agentledgerDir = join(tmpDir, ".agentledger");
    mkdirSync(agentledgerDir, { recursive: true });
    writeConfig(tmpDir, {
      blockedFiles: ["**/.env"],
      testCommand: "echo ok",
    });
    // Pre-seed ledger with a prior event so LedgerWriter has something to chain from
    // (empty ledger is fine — GENESIS_HASH handles it)
    writeFileSync(join(agentledgerDir, "ledger.jsonl"), "");
    // Active run in session state
    const runId = "test-run-id-12345";
    writeSession(tmpDir, { runId, dirty: true, sessionStart: new Date().toISOString() });

    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, ".env") },
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.decision).toBe("block");

    // Ledger must contain a TOOL_DENIED event
    const events = readLedger(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const denied = events.find((e) => e.event_type === "TOOL_DENIED");
    expect(denied).toBeDefined();
    expect(denied.run_id).toBe(runId);
    expect(denied.payload.tool).toBe("Edit");
  });
});
