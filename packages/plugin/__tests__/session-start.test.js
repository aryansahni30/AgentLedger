import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SCRIPT = fileURLToPath(
  new URL("../scripts/hooks/session-start.js", import.meta.url)
);

/**
 * Spawn the session-start hook with an isolated temp dir.
 * Accepts ~2.1s overhead from server-manager polling timeout.
 */
function runHook(projectDir) {
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    timeout: 10_000,
  });
}

describe("session-start hook", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentledger-session-start-"));
  });

  it("creates .agentledger/ directory", () => {
    const agentledgerDir = join(tmpDir, ".agentledger");
    expect(existsSync(agentledgerDir)).toBe(false);

    const result = runHook(tmpDir);

    expect(result.status).toBe(0);
    expect(existsSync(agentledgerDir)).toBe(true);
  });

  it("writes default config.json with expected blocked patterns", () => {
    const configPath = join(tmpDir, ".agentledger", "config.json");

    runHook(tmpDir);

    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(Array.isArray(config.blockedFiles)).toBe(true);
    expect(config.blockedFiles).toContain("**/.env");
    expect(config.blockedFiles).toContain("**/*.pem");
    expect(typeof config.testCommand).toBe("string");
  });

  it("does not overwrite an existing config.json", () => {
    // First run creates the default config
    runHook(tmpDir);

    // Overwrite with custom config
    const configPath = join(tmpDir, ".agentledger", "config.json");
    const custom = { blockedFiles: ["**/custom.txt"], testCommand: "echo ok", operator: "alice" };
    writeFileSync(configPath, JSON.stringify(custom, null, 2));

    // Second run must not overwrite
    runHook(tmpDir);

    const after = JSON.parse(readFileSync(configPath, "utf8"));
    expect(after.blockedFiles).toEqual(["**/custom.txt"]);
    expect(after.operator).toBe("alice");
  });

  it("prints dashboard status in stdout", () => {
    const result = runHook(tmpDir);
    // Dashboard line always present (either URL if running, or "not running")
    expect(result.stdout).toContain("Dashboard");
  });
});
