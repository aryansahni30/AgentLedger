import { mkdir, appendFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { type LedgerEvent, LedgerEventSchema } from "../schemas/index.js";
import { computeHash } from "./hashChain.js";

const GENESIS_HASH = "genesis";

export class LedgerWriter {
  private readonly ledgerPath: string;
  /** Serial promise queue — ensures concurrent callers never interleave read-then-write */
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(ledgerPath: string) {
    this.ledgerPath = ledgerPath;
  }

  async appendEvent(
    event: Omit<LedgerEvent, "hash" | "previous_hash">,
  ): Promise<LedgerEvent> {
    return new Promise<LedgerEvent>((resolve, reject) => {
      this._writeQueue = this._writeQueue.then(async () => {
        try {
          const result = await this._appendEventUnsafe(event);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  private async _appendEventUnsafe(
    event: Omit<LedgerEvent, "hash" | "previous_hash">,
  ): Promise<LedgerEvent> {
    await this.ensureLedgerExists();

    const previousHash = await this.getLastEventHash();
    const hash = computeHash(previousHash, event.payload);

    const fullEvent: LedgerEvent = LedgerEventSchema.parse({
      ...event,
      hash,
      previous_hash: previousHash,
    });

    const line = JSON.stringify(fullEvent) + "\n";
    await appendFile(this.ledgerPath, line, { encoding: "utf8" });

    return fullEvent;
  }

  async getLastEventHash(): Promise<string> {
    if (!existsSync(this.ledgerPath)) {
      return GENESIS_HASH;
    }

    const content = await readFile(this.ledgerPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length === 0) {
      return GENESIS_HASH;
    }

    const lastLine = lines[lines.length - 1];
    if (lastLine === undefined) {
      return GENESIS_HASH;
    }

    const parsed: unknown = JSON.parse(lastLine);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "hash" in parsed &&
      typeof (parsed as Record<string, unknown>)["hash"] === "string"
    ) {
      return (parsed as Record<string, unknown>)["hash"] as string;
    }

    return GENESIS_HASH;
  }

  private async ensureLedgerExists(): Promise<void> {
    const dir = dirname(this.ledgerPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    if (!existsSync(this.ledgerPath)) {
      await appendFile(this.ledgerPath, "", { encoding: "utf8" });
    }
  }

  static createEventId(): string {
    return randomUUID();
  }
}
