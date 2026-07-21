import { watch, existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { LedgerReader, readRegistry } from "@agentledger/core";
import type { LedgerEvent } from "@agentledger/core";
import { FileWatcher } from "./fileWatcher.js";

/** A ledger event tagged with the project whose ledger it came from. */
export type TaggedEvent = LedgerEvent & { project: string };

/** One project summary for the selector + per-project chain badge. */
export interface ProjectSummary {
  /** basename identifier — the value events are tagged with */
  name: string;
  /** canonical project root */
  path: string;
  eventCount: number;
  sessionCount: number;
  /** false if this project's hash chain fails to verify */
  chainValid: boolean;
  chainError?: string | undefined;
  lastActivity?: string | undefined;
}

interface LedgerSource {
  name: string;
  ledgerPath: string;
  watcher: FileWatcher;
}

export interface LedgerRegistryOptions {
  /** resolved registry file; watched for projects appearing at runtime */
  registryFile: string;
  /** optional explicit ledger dir (test fixture / spawner fallback), watched in addition to the registry */
  explicitLedgerDir?: string | undefined;
  /** delivered tagged events — existing on start, then every append */
  onNewEvents: (events: TaggedEvent[]) => void;
}

const REGISTRY_DEBOUNCE_MS = 200;

/**
 * Derive a project identifier from a raw ledger dir. The spawner passes
 * `{projectRoot}/.agentledger`, whose basename is useless; fall back to the
 * project root's name. A test fixture passes the dir directly.
 */
function nameForLedgerDir(ledgerDir: string): string {
  const base = basename(ledgerDir);
  return base === ".agentledger" ? basename(dirname(ledgerDir)) : base;
}

/**
 * Discovers and watches every registered project's ledger, tagging each event
 * with its project before delivery. This is what makes the dashboard
 * cross-project: the server no longer reads one repo's ledger, it reads all of
 * them.
 *
 * The registry file is itself watched, so a brand-new project registering
 * mid-run is picked up without a server restart. A registered project whose
 * ledger.jsonl does not exist yet gets an empty one touched into place (append
 * mode — never truncates a concurrent first write) so fs.watch has a file to
 * watch and the first real event is not missed.
 */
export class LedgerRegistry {
  private readonly _sources = new Map<string, LedgerSource>(); // keyed by ledgerPath
  private _registryWatcher: ReturnType<typeof watch> | null = null;
  private _registryDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly _opts: LedgerRegistryOptions) {}

  async start(): Promise<void> {
    // Explicit dir first so it wins the dedupe if the registry also lists it.
    if (this._opts.explicitLedgerDir !== undefined) {
      await this._addSource(
        nameForLedgerDir(this._opts.explicitLedgerDir),
        join(this._opts.explicitLedgerDir, "ledger.jsonl"),
      );
    }
    await this._syncFromRegistry();
    this._watchRegistry();
  }

  stop(): void {
    for (const source of this._sources.values()) {
      source.watcher.stop();
    }
    this._sources.clear();
    if (this._registryWatcher !== null) {
      this._registryWatcher.close();
      this._registryWatcher = null;
    }
    if (this._registryDebounce !== null) {
      clearTimeout(this._registryDebounce);
      this._registryDebounce = null;
    }
  }

  /**
   * Per-project summaries for the /api/projects route. Chain validity is
   * verified per ledger file — chains are per-repo and cannot be merged, so a
   * broken chain in one project must not taint another's badge.
   */
  async projectSummaries(eventStore: readonly TaggedEvent[]): Promise<ProjectSummary[]> {
    const byProject = new Map<string, { events: number; runs: Set<string>; last?: string }>();
    for (const e of eventStore) {
      const agg = byProject.get(e.project) ?? { events: 0, runs: new Set<string>() };
      agg.events += 1;
      agg.runs.add(e.run_id);
      if (agg.last === undefined || e.timestamp > agg.last) agg.last = e.timestamp;
      byProject.set(e.project, agg);
    }

    return Promise.all(
      [...this._sources.values()].map(async (source) => {
        const agg = byProject.get(source.name);
        let chainValid = true;
        let chainError: string | undefined;
        try {
          const result = await new LedgerReader(source.ledgerPath).verifyChain();
          chainValid = result.valid;
          if (!result.valid) chainError = result.reason;
        } catch (err) {
          chainValid = false;
          chainError = String(err);
        }
        return {
          name: source.name,
          path: dirname(dirname(source.ledgerPath)),
          eventCount: agg?.events ?? 0,
          sessionCount: agg?.runs.size ?? 0,
          chainValid,
          chainError,
          lastActivity: agg?.last,
        };
      }),
    );
  }

  private async _syncFromRegistry(): Promise<void> {
    const entries = await readRegistry(this._opts.registryFile);
    for (const entry of entries) {
      await this._addSource(entry.name, join(entry.path, ".agentledger", "ledger.jsonl"));
    }
  }

  private async _addSource(name: string, ledgerPath: string): Promise<void> {
    if (this._sources.has(ledgerPath)) return;

    // Guarantee the file exists so fs.watch has a target and the first append is
    // seen. Append mode creates-if-absent and never truncates a concurrent write.
    try {
      mkdirSync(dirname(ledgerPath), { recursive: true });
      if (!existsSync(ledgerPath)) closeSync(openSync(ledgerPath, "a"));
    } catch {
      // Another repo's dir may be unwritable — skip rather than crash the server.
      return;
    }

    const watcher = new FileWatcher(ledgerPath, (events) => {
      this._opts.onNewEvents(events.map((e) => ({ ...e, project: name })));
    });
    this._sources.set(ledgerPath, { name, ledgerPath, watcher });
    await watcher.start();
  }

  private _watchRegistry(): void {
    const file = this._opts.registryFile;
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (!existsSync(file)) closeSync(openSync(file, "a"));
      this._registryWatcher = watch(file, () => this._onRegistryChange());
    } catch {
      // No registry to watch — explicit ledgerDir (if any) still works.
    }
  }

  private _onRegistryChange(): void {
    if (this._registryDebounce !== null) clearTimeout(this._registryDebounce);
    this._registryDebounce = setTimeout(() => {
      void this._syncFromRegistry();
    }, REGISTRY_DEBOUNCE_MS);
  }
}
