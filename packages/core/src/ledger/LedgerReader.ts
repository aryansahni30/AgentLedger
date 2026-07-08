import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { type LedgerEvent, LedgerEventSchema } from "../schemas/index.js";
import { isValidHash } from "./hashChain.js";

const GENESIS_HASH = "genesis";

export type ChainVerificationResult =
  | { valid: true }
  | { valid: false; firstInvalidIndex: number; reason: string };

export class LedgerReader {
  private readonly ledgerPath: string;

  constructor(ledgerPath: string) {
    this.ledgerPath = ledgerPath;
  }

  async readAll(): Promise<LedgerEvent[]> {
    if (!existsSync(this.ledgerPath)) {
      return [];
    }

    const content = await readFile(this.ledgerPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    return lines.map((line, index) => {
      try {
        return LedgerEventSchema.parse(JSON.parse(line));
      } catch (err) {
        throw new Error(`Failed to parse ledger line ${index}: ${String(err)}`);
      }
    });
  }

  async readByRunId(runId: string): Promise<LedgerEvent[]> {
    const events = await this.readAll();
    return events.filter((e) => e.run_id === runId);
  }

  async readByTaskId(taskId: string): Promise<LedgerEvent[]> {
    const events = await this.readAll();
    return events.filter((e) => e.task_id === taskId);
  }

  async verifyChain(): Promise<ChainVerificationResult> {
    const events = await this.readAll();

    if (events.length === 0) {
      return { valid: true };
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event === undefined) continue;

      const expectedPreviousHash = i === 0 ? GENESIS_HASH : events[i - 1]?.hash ?? GENESIS_HASH;

      if (event.previous_hash !== expectedPreviousHash) {
        return {
          valid: false,
          firstInvalidIndex: i,
          reason: `Event ${i} previous_hash mismatch: expected "${expectedPreviousHash}", got "${event.previous_hash}"`,
        };
      }

      if (!isValidHash(event.previous_hash, event.payload, event.hash)) {
        return {
          valid: false,
          firstInvalidIndex: i,
          reason: `Event ${i} hash is invalid (payload or hash was tampered)`,
        };
      }
    }

    return { valid: true };
  }
}
