import { createReadStream, watch } from "node:fs";
import { createInterface } from "node:readline";
import type { LedgerEvent } from "@agentledger/core";

/**
 * Watches a JSONL ledger file for new lines and calls onNewEvents with any
 * newly appended events. Uses line-count tracking (not byte offset) and a
 * 100ms debounce with an in-flight guard to prevent overlapping reads.
 */
export class FileWatcher {
  private _lineCount = 0;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _reading = false;
  private _watcher: ReturnType<typeof watch> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly onNewEvents: (events: LedgerEvent[]) => void,
  ) {}

  /**
   * Reads existing file content to initialise line count, then starts
   * watching for appends. Any events already in the file are delivered
   * once via onNewEvents before this promise resolves.
   */
  async start(): Promise<void> {
    await this._readNewLines();
    this._watcher = watch(this.filePath, () => {
      this._onFileChange();
    });
  }

  stop(): void {
    if (this._watcher !== null) {
      this._watcher.close();
      this._watcher = null;
    }
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  private _onFileChange(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      if (this._reading) return;
      void this._readNewLines();
    }, 100);
  }

  private async _readNewLines(): Promise<void> {
    if (this._reading) return;
    this._reading = true;
    try {
      const newEvents: LedgerEvent[] = [];
      let currentLine = 0;

      const rl = createInterface({
        input: createReadStream(this.filePath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (currentLine >= this._lineCount && line.trim() !== "") {
          try {
            const event = JSON.parse(line) as LedgerEvent;
            newEvents.push(event);
          } catch {
            // skip malformed lines
          }
        }
        currentLine++;
      }

      this._lineCount = currentLine;

      if (newEvents.length > 0) {
        this.onNewEvents(newEvents);
      }
    } catch {
      // file may not exist yet — silently ignore
    } finally {
      this._reading = false;
    }
  }
}
