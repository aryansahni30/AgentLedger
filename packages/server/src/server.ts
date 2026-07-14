import http from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { LedgerEvent } from "@agentledger/core";
import { FileWatcher } from "./services/fileWatcher.js";
import { SSEManager } from "./services/sseManager.js";
import { createApp } from "./index.js";

export interface ServerOptions {
  ledgerDir: string;
  /** Pass 0 to let the OS assign a free port. */
  port: number;
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

/**
 * Creates and starts the AgentLedger API server.
 *
 * - FileWatcher loads all existing events into eventStore then watches for appends.
 * - SSEManager replays eventStore to new clients and broadcasts incremental events.
 * - Signal handlers (SIGINT/SIGTERM) live in packages/cli, not here.
 */
export async function createServer(opts: ServerOptions): Promise<ServerHandle> {
  const ledgerPath = join(opts.ledgerDir, "ledger.jsonl");
  const eventStore: LedgerEvent[] = [];
  const sseManager = new SSEManager(eventStore);

  const app = createApp({
    ledgerDir: opts.ledgerDir,
    eventStore,
    sseManager,
  });

  const server = http.createServer(app);

  const watcher = new FileWatcher(ledgerPath, (newEvents) => {
    for (const event of newEvents) {
      eventStore.push(event);
      sseManager.broadcast(event);
    }
  });

  // Reads existing lines into eventStore; starts fs.watch afterwards
  await watcher.start();

  await new Promise<void>((resolve) => {
    server.listen(opts.port, resolve);
  });

  const actualPort = (server.address() as AddressInfo).port;

  return {
    port: actualPort,
    close: async () => {
      watcher.stop();
      sseManager.closeAll();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
