import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SCRIPT = fileURLToPath(
  new URL("../scripts/hooks/post-tool-use.js", import.meta.url)
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

function setupDir(projectDir) {
  mkdirSync(join(projectDir, ".agentledger"), { recursive: true });
  // Write minimal config so operator lookup works
  writeFileSync(
    join(projectDir, ".agentledger", "config.json"),
    JSON.stringify({ blockedFiles: ["**/.env"], testCommand: "echo ok", operator: "test-user" }, null, 2)
  );
}

describe("post-tool-use hook", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentledger-post-tool-use-"));
    setupDir(tmpDir);
  });

  it("first Edit emits RUN_CREATED, INTENT_COMPILED, TOOL_CALLED (3 events)", () => {
    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "src", "index.ts") },
      tool_response: {},
    });

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    expect(events).toHaveLength(3);
    expect(events[0].event_type).toBe("RUN_CREATED");
    expect(events[1].event_type).toBe("INTENT_COMPILED");
    expect(events[2].event_type).toBe("TOOL_CALLED");
    expect(events[2].payload.tool).toBe("Edit");
  });

  it("second Edit appends only TOOL_CALLED (total 4 events)", () => {
    // First Edit initializes the run
    runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "a.ts") },
      tool_response: {},
    });

    // Second Edit — run already active, only TOOL_CALLED added
    const result = runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "b.ts") },
      tool_response: {},
    });

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    expect(events).toHaveLength(4);
    expect(events[3].event_type).toBe("TOOL_CALLED");
    expect(events[3].payload.file_path).toBe(join(tmpDir, "b.ts"));
  });

  it("Bash alone (no prior Edit/Write) produces 0 ledger events", () => {
    const result = runHook(tmpDir, {
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_response: {},
    });

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    expect(events).toHaveLength(0);
  });

  it("Bash after Edit appends TOOL_CALLED with command payload", () => {
    // Edit initializes run
    runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "src", "app.ts") },
      tool_response: {},
    });

    // Bash — run is active, records TOOL_CALLED
    const result = runHook(tmpDir, {
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: {},
    });

    expect(result.status).toBe(0);
    const events = readLedger(tmpDir);
    expect(events).toHaveLength(4);
    const bashEvent = events[3];
    expect(bashEvent.event_type).toBe("TOOL_CALLED");
    expect(bashEvent.payload.tool).toBe("Bash");
    expect(bashEvent.payload.command).toBe("npm test");
  });

  it("ledger hash chain is valid across multiple spawned processes", () => {
    // Three sequential hook invocations — each is a separate Node process
    runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "file1.ts") },
      tool_response: {},
    });
    runHook(tmpDir, {
      tool_name: "Write",
      tool_input: { file_path: join(tmpDir, "file2.ts") },
      tool_response: {},
    });
    runHook(tmpDir, {
      tool_name: "Edit",
      tool_input: { file_path: join(tmpDir, "file3.ts") },
      tool_response: {},
    });

    const events = readLedger(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(4); // RUN_CREATED, INTENT_COMPILED, TOOL_CALLED ×3+

    // First event chains from genesis
    expect(events[0].previous_hash).toBe("genesis");

    // Each subsequent event's previous_hash must equal the prior event's hash
    for (let i = 1; i < events.length; i++) {
      expect(events[i].previous_hash).toBe(events[i - 1].hash);
    }
  });
});
