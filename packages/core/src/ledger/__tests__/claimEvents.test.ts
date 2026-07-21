/**
 * Contract test: the ledger must accept every event type the Lie Detector emits.
 *
 * Regression guard. The plugin's Stop hook emitted CLAIM_* events that were absent
 * from LedgerEventTypeSchema, so LedgerWriter.appendEvent threw on every append and
 * the hook's bare catch swallowed it. Detection ran, nothing was ever recorded.
 * These assert against the real schema and the real writer — never a mock, since a
 * mocked writer is precisely what hid the bug.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { LedgerWriter } from "../LedgerWriter.js";
import { LedgerEventSchema, LedgerEventTypeSchema } from "../../schemas/index.js";

/** Every event type the plugin's Stop hook can emit. Keep in sync with stop.js. */
const CLAIM_EVENT_TYPES = [
  "CLAIM_DETECTED",
  "CLAIM_VERIFIED",
  "CLAIM_FALSIFIED",
  "CLAIM_UNVERIFIABLE",
] as const;

describe("LedgerEventTypeSchema — claim event contract", () => {
  test.each(CLAIM_EVENT_TYPES)("accepts %s as a valid event type", (eventType) => {
    expect(LedgerEventTypeSchema.safeParse(eventType).success).toBe(true);
  });

  test("still rejects an event type that is not in the enum", () => {
    expect(LedgerEventTypeSchema.safeParse("NOT_A_REAL_EVENT").success).toBe(false);
  });
});

describe("LedgerWriter — claim events round-trip to disk", () => {
  let dir: string;
  let ledgerPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agentledger-claim-"));
    ledgerPath = join(dir, "ledger.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test.each(CLAIM_EVENT_TYPES)("appendEvent writes a %s event without throwing", async (eventType) => {
    // Arrange
    const writer = new LedgerWriter(ledgerPath);

    // Act
    const written = await writer.appendEvent({
      event_id: `evt_${eventType}`,
      run_id: "run_test",
      timestamp: new Date().toISOString(),
      actor: "plugin:stop",
      event_type: eventType,
      payload: { claim_text: "tests pass", claim_type: "test_claim" },
    });

    // Assert
    expect(written.event_type).toBe(eventType);
    const onDisk = await readFile(ledgerPath, "utf8");
    expect(JSON.parse(onDisk.trim()).event_type).toBe(eventType);
  });

  test("a falsified claim carries its evidence through the schema unchanged", async () => {
    // Arrange
    const writer = new LedgerWriter(ledgerPath);
    const payload = {
      claim_text: "tests pass",
      claim_type: "test_claim",
      expected: "tests pass",
      actual: "npm test exit 1",
      verification: { test_exit_code: 1, boundary_clean: true, violations: [] },
    };

    // Act
    const written = await writer.appendEvent({
      event_id: "evt_lie",
      run_id: "run_test",
      timestamp: new Date().toISOString(),
      actor: "plugin:stop",
      event_type: "CLAIM_FALSIFIED",
      payload,
    });

    // Assert
    expect(written.payload).toEqual(payload);
    expect(LedgerEventSchema.safeParse(written).success).toBe(true);
  });

  test("claim events hash-chain onto preceding events", async () => {
    // Arrange
    const writer = new LedgerWriter(ledgerPath);
    const base = { run_id: "run_test", actor: "plugin:stop", payload: {} };

    // Act
    const first = await writer.appendEvent({
      ...base,
      event_id: "evt_1",
      timestamp: new Date().toISOString(),
      event_type: "CLAIM_DETECTED",
    });
    const second = await writer.appendEvent({
      ...base,
      event_id: "evt_2",
      timestamp: new Date().toISOString(),
      event_type: "CLAIM_FALSIFIED",
    });

    // Assert
    expect(first.previous_hash).toBe("genesis");
    expect(second.previous_hash).toBe(first.hash);
  });
});
