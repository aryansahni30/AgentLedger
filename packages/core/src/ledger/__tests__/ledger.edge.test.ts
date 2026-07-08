import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { LedgerWriter } from "../LedgerWriter.js";
import { LedgerReader } from "../LedgerReader.js";

function makeEventBase(overrides: Record<string, unknown> = {}) {
  return {
    event_id: LedgerWriter.createEventId(),
    run_id: "run-001",
    timestamp: new Date().toISOString(),
    actor: "orchestrator",
    event_type: "RUN_CREATED" as const,
    payload: { goal: "add email validation" },
    ...overrides,
  };
}

describe("LedgerReader — edge cases", () => {
  let tmpDir: string;
  let ledgerPath: string;
  let writer: LedgerWriter;
  let reader: LedgerReader;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-edge-"));
    ledgerPath = join(tmpDir, "ledger.jsonl");
    writer = new LedgerWriter(ledgerPath);
    reader = new LedgerReader(ledgerPath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws a descriptive error on malformed JSONL line", async () => {
    // Write one valid event via writer, then manually append unparseable text
    await writer.appendEvent(makeEventBase({ event_id: "evt-good" }));
    const { appendFile } = await import("fs/promises");
    await appendFile(ledgerPath, "not valid json at all\n", "utf8");
    await expect(reader.readAll()).rejects.toThrow(/Failed to parse ledger line 1/);
  });

  it("throws on line that is valid JSON but fails Zod schema", async () => {
    await writeFile(ledgerPath, '{"event_id":"x","missing_required_fields":true}\n', "utf8");
    await expect(reader.readAll()).rejects.toThrow(/Failed to parse ledger line 0/);
  });

  it("readByTaskId returns empty array when no events match", async () => {
    await writer.appendEvent(makeEventBase({ task_id: "task-X" }));
    const result = await reader.readByTaskId("task-DOES-NOT-EXIST");
    expect(result).toHaveLength(0);
  });

  it("readByRunId returns empty array when no events match", async () => {
    await writer.appendEvent(makeEventBase({ run_id: "run-A" }));
    const result = await reader.readByRunId("run-DOES-NOT-EXIST");
    expect(result).toHaveLength(0);
  });

  it("verifyChain detects tampered previous_hash field", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2" }));

    // Corrupt previous_hash of second event (not the hash field itself)
    const content = await import("fs/promises").then((m) =>
      m.readFile(ledgerPath, "utf8"),
    );
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const line1 = JSON.parse(lines[1] as string) as Record<string, unknown>;
    line1["previous_hash"] = "corrupted-previous-hash";
    lines[1] = JSON.stringify(line1);
    await writeFile(ledgerPath, lines.join("\n") + "\n", "utf8");

    const result = await reader.verifyChain();
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.firstInvalidIndex).toBe(1);
      expect(result.reason).toMatch(/previous_hash mismatch/);
    }
  });

  it("payload is preserved exactly through write/read round-trip", async () => {
    const complexPayload = {
      goal: "complex task",
      nested: { a: 1, b: [true, null, "str"] },
      count: 42,
    };
    await writer.appendEvent(
      makeEventBase({ event_id: "evt-payload", payload: complexPayload }),
    );

    const events = await reader.readAll();
    expect(events[0]?.payload).toEqual(complexPayload);
  });

  it("appendEvent returns full event with hash and previous_hash populated", async () => {
    const returned = await writer.appendEvent(makeEventBase({ event_id: "evt-check" }));

    expect(returned.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(returned.previous_hash).toBe("genesis");
    expect(returned.event_id).toBe("evt-check");
  });

  it("appendEvent return value matches what readAll returns", async () => {
    const returned = await writer.appendEvent(makeEventBase({ event_id: "evt-match" }));
    const events = await reader.readAll();

    expect(events[0]).toEqual(returned);
  });
});

describe("LedgerWriter — auto-create parent directory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-mkdir-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates parent directories that do not yet exist", async () => {
    const deepPath = join(tmpDir, "deep", "nested", "dir", "ledger.jsonl");
    const writer = new LedgerWriter(deepPath);
    const reader = new LedgerReader(deepPath);

    await writer.appendEvent({
      event_id: LedgerWriter.createEventId(),
      run_id: "run-deep",
      timestamp: new Date().toISOString(),
      actor: "orchestrator",
      event_type: "RUN_CREATED",
      payload: { goal: "deep dir test" },
    });

    const events = await reader.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]?.run_id).toBe("run-deep");
  });

  it("does not throw when ledger dir already exists", async () => {
    const existingDir = join(tmpDir, "already-exists");
    await mkdir(existingDir, { recursive: true });

    const writer = new LedgerWriter(join(existingDir, "ledger.jsonl"));
    await expect(
      writer.appendEvent({
        event_id: LedgerWriter.createEventId(),
        run_id: "run-idempotent",
        timestamp: new Date().toISOString(),
        actor: "orchestrator",
        event_type: "RUN_CREATED",
        payload: {},
      }),
    ).resolves.not.toThrow();
  });
});

describe("LedgerWriter — multi-event chain integrity", () => {
  let tmpDir: string;
  let ledgerPath: string;
  let writer: LedgerWriter;
  let reader: LedgerReader;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-chain-"));
    ledgerPath = join(tmpDir, "ledger.jsonl");
    writer = new LedgerWriter(ledgerPath);
    reader = new LedgerReader(ledgerPath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("chain of 5 events all pass verifyChain", async () => {
    for (let i = 0; i < 5; i++) {
      await writer.appendEvent(
        makeEventBase({ event_id: `evt-${i}`, event_type: "TASK_CREATED" }),
      );
    }
    const result = await reader.verifyChain();
    expect(result.valid).toBe(true);
  });

  it("each event in chain references the correct previous hash", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-0" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-1" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2" }));

    const events = await reader.readAll();
    expect(events[0]?.previous_hash).toBe("genesis");
    expect(events[1]?.previous_hash).toBe(events[0]?.hash);
    expect(events[2]?.previous_hash).toBe(events[1]?.hash);
  });

  it("appending to existing ledger continues chain correctly", async () => {
    // First session
    await writer.appendEvent(makeEventBase({ event_id: "evt-session1" }));

    // Second session: new writer instance pointing to same file
    const writer2 = new LedgerWriter(ledgerPath);
    await writer2.appendEvent(makeEventBase({ event_id: "evt-session2" }));

    const result = await reader.verifyChain();
    expect(result.valid).toBe(true);

    const events = await reader.readAll();
    expect(events).toHaveLength(2);
    expect(events[1]?.previous_hash).toBe(events[0]?.hash);
  });
});
