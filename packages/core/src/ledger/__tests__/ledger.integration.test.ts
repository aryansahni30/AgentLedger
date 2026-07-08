import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
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

describe("LedgerWriter + LedgerReader integration", () => {
  let tmpDir: string;
  let ledgerPath: string;
  let writer: LedgerWriter;
  let reader: LedgerReader;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-test-"));
    ledgerPath = join(tmpDir, "ledger.jsonl");
    writer = new LedgerWriter(ledgerPath);
    reader = new LedgerReader(ledgerPath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends events and reads them back", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2", event_type: "TASK_CREATED" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-3", event_type: "TASK_STARTED" }));

    const events = await reader.readAll();
    expect(events).toHaveLength(3);
    expect(events[0]?.event_id).toBe("evt-1");
    expect(events[1]?.event_id).toBe("evt-2");
    expect(events[2]?.event_id).toBe("evt-3");
  });

  it("first event has previous_hash === 'genesis'", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1" }));
    const events = await reader.readAll();
    expect(events[0]?.previous_hash).toBe("genesis");
  });

  it("each event's previous_hash links to prior event's hash", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-3" }));

    const events = await reader.readAll();
    expect(events[1]?.previous_hash).toBe(events[0]?.hash);
    expect(events[2]?.previous_hash).toBe(events[1]?.hash);
  });

  it("verifyChain passes on valid ledger", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-3" }));

    const result = await reader.verifyChain();
    expect(result.valid).toBe(true);
  });

  it("verifyChain fails when a hash is tampered", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-3" }));

    // Tamper: replace the hash in line 2 (index 1)
    const content = await readFile(ledgerPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const line1 = JSON.parse(lines[1] as string) as Record<string, unknown>;
    line1["hash"] = "tampered-hash-value";
    lines[1] = JSON.stringify(line1);
    await writeFile(ledgerPath, lines.join("\n") + "\n", "utf8");

    const result = await reader.verifyChain();
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Either index 1 fails (its own hash is invalid) or index 2 fails (previous_hash mismatch)
      expect(result.firstInvalidIndex).toBeGreaterThanOrEqual(1);
    }
  });

  it("readByRunId filters by run_id", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1", run_id: "run-A" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2", run_id: "run-B" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-3", run_id: "run-A" }));

    const eventsA = await reader.readByRunId("run-A");
    const eventsB = await reader.readByRunId("run-B");

    expect(eventsA).toHaveLength(2);
    expect(eventsA[0]?.event_id).toBe("evt-1");
    expect(eventsA[1]?.event_id).toBe("evt-3");
    expect(eventsB).toHaveLength(1);
    expect(eventsB[0]?.event_id).toBe("evt-2");
  });

  it("readByTaskId filters by task_id", async () => {
    await writer.appendEvent(makeEventBase({ event_id: "evt-1", task_id: "task-X" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-2", task_id: "task-Y" }));
    await writer.appendEvent(makeEventBase({ event_id: "evt-3", task_id: "task-X" }));

    const eventsX = await reader.readByTaskId("task-X");
    const eventsY = await reader.readByTaskId("task-Y");

    expect(eventsX).toHaveLength(2);
    expect(eventsY).toHaveLength(1);
  });

  it("readAll returns empty array when ledger does not exist", async () => {
    const events = await reader.readAll();
    expect(events).toHaveLength(0);
  });

  it("verifyChain returns valid on empty ledger", async () => {
    const result = await reader.verifyChain();
    expect(result.valid).toBe(true);
  });

  it("getLastEventHash returns 'genesis' on empty ledger", async () => {
    const hash = await writer.getLastEventHash();
    expect(hash).toBe("genesis");
  });
});
