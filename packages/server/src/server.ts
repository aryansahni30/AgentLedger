import http from "node:http";
import type { AddressInfo } from "node:net";
import { registryPath } from "@agentledger/core";
import { SSEManager } from "./services/sseManager.js";
import { LedgerRegistry } from "./services/ledgerRegistry.js";
import type { TaggedEvent } from "./services/ledgerRegistry.js";
import { createApp } from "./index.js";

export interface ServerOptions {
  /**
   * Optional explicit ledger dir to watch in addition to the registry. The
   * spawner passes its own `{projectRoot}/.agentledger`; tests pass a fixture.
   * Omit to watch only registered projects.
   */
  ledgerDir?: string;
  /** Pass 0 to let the OS assign a free port. */
  port: number;
  /**
   * Registry file to discover projects from. Defaults to the real
   * `~/.agentledger/projects.json`; tests point it at an isolated fixture.
   */
  registryFile?: string;
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

/**
 * Creates and starts the AgentLedger API server.
 *
 * - LedgerRegistry discovers every registered project, loads their existing
 *   events into the tagged eventStore, then watches each ledger (and the
 *   registry itself) for appends.
 * - SSEManager replays eventStore to new clients and broadcasts incremental
 *   events, tags included.
 * - Signal handlers (SIGINT/SIGTERM) live in packages/cli, not here.
 */
export async function createServer(opts: ServerOptions): Promise<ServerHandle> {
  const eventStore: TaggedEvent[] = [];
  const sseManager = new SSEManager(eventStore);

  const ledgerRegistry = new LedgerRegistry({
    registryFile: opts.registryFile ?? registryPath(),
    explicitLedgerDir: opts.ledgerDir,
    onNewEvents: (events) => {
      for (const event of events) {
        eventStore.push(event);
        sseManager.broadcast(event);
      }
    },
  });

  const app = createApp({
    eventStore,
    sseManager,
    getProjectSummaries: () => ledgerRegistry.projectSummaries(eventStore),
  });

  const server = http.createServer(app);

  // Loads existing events into eventStore; starts watchers afterwards.
  await ledgerRegistry.start();

  await new Promise<void>((resolve) => {
    server.listen(opts.port, "127.0.0.1", resolve);
  });

  const actualPort = (server.address() as AddressInfo).port;

  return {
    port: actualPort,
    close: async () => {
      ledgerRegistry.stop();
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
