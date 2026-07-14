import type { Response } from "express";
import type { LedgerEvent } from "@agentledger/core";

/**
 * Manages SSE client connections. Replays historical events on connect
 * and broadcasts new events to all connected clients.
 *
 * The eventStore is a shared mutable reference — the server appends to
 * it as the FileWatcher detects new ledger lines.
 */
export class SSEManager {
  private readonly _clients = new Map<string, Response>();

  constructor(private readonly _eventStore: LedgerEvent[]) {}

  /**
   * Register a new SSE client. Writes SSE headers, replays stored events
   * from sinceEventId (exclusive), then holds the connection open.
   */
  addClient(id: string, res: Response, sinceEventId?: string): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let replayFrom = 0;
    if (sinceEventId !== undefined) {
      const idx = this._eventStore.findIndex((e) => e.event_id === sinceEventId);
      replayFrom = idx === -1 ? 0 : idx + 1;
    }

    for (let i = replayFrom; i < this._eventStore.length; i++) {
      const event = this._eventStore[i];
      if (event !== undefined) {
        this._sendEvent(res, event);
      }
    }

    this._clients.set(id, res);
  }

  removeClient(id: string): void {
    this._clients.delete(id);
  }

  broadcast(event: LedgerEvent): void {
    for (const res of this._clients.values()) {
      this._sendEvent(res, event);
    }
  }

  closeAll(): void {
    for (const res of this._clients.values()) {
      res.end();
    }
    this._clients.clear();
  }

  get clientCount(): number {
    return this._clients.size;
  }

  private _sendEvent(res: Response, event: LedgerEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
