/**
 * Cross-project registry: the list of repos the dashboard reads ledgers from.
 *
 * Lives at `~/.agentledger/projects.json` (override `AGENTLEDGER_HOME` for tests).
 * SessionStart appends the current repo on every launch; the server reads the
 * file to discover which ledgers to watch.
 *
 * Design constraints, each learned the hard way:
 *   - Every writer is a short-lived hook process and several run at once in
 *     different repos, so writes take a file lock — an unlocked read-modify-write
 *     silently drops all but the last concurrent registration.
 *   - Paths are canonicalized (realpath) so a repo reached via /tmp and via
 *     /private/tmp is one entry, not two half-populated ones.
 *   - A corrupt or partially-written file must never throw into a hook. It is
 *     rebuilt, not surfaced.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import lockfile from "proper-lockfile";
import { ProjectRegistrySchema, ProjectEntrySchema, type ProjectEntry } from "../schemas/index.js";

/** @returns the `~/.agentledger` directory (or `$AGENTLEDGER_HOME`). */
function homeDir(): string {
  return process.env["AGENTLEDGER_HOME"] ?? path.join(os.homedir(), ".agentledger");
}

/** Absolute path to the registry file. */
export function registryPath(): string {
  return path.join(homeDir(), "projects.json");
}

/**
 * Canonicalize a repo path so two spellings of one directory collapse to one
 * entry. realpath resolves symlinks (/tmp → /private/tmp) and normalizes away
 * trailing slashes; if the path does not exist yet we fall back to a normalized
 * form rather than throwing.
 */
function canonicalize(repoPath: string): string {
  try {
    return fs.realpathSync(repoPath);
  } catch {
    return path.resolve(repoPath);
  }
}

/**
 * Read and validate the registry, dropping any entry that fails schema
 * validation. Returns [] for a missing, empty, or unrecoverable file — reading
 * the registry is never allowed to fail a caller.
 *
 * @param file explicit registry path; defaults to `registryPath()`. The server
 *   passes one so it can be pointed at a test fixture without touching env.
 */
export async function readRegistry(file: string = registryPath()): Promise<ProjectEntry[]> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const full = ProjectRegistrySchema.safeParse(parsed);
  if (full.success) return full.data.projects;

  // Container is intact but some entries are junk — keep the valid ones rather
  // than discarding a whole file's worth of real projects over one bad row.
  const projects = (parsed as { projects?: unknown })?.projects;
  if (Array.isArray(projects)) {
    return projects.flatMap((entry) => {
      const row = ProjectEntrySchema.safeParse(entry);
      return row.success ? [row.data] : [];
    });
  }

  return [];
}

/**
 * Register (or refresh) a repo in the registry. Idempotent: an existing entry's
 * `lastSeen` advances and `firstSeen` is preserved; a new repo is appended.
 *
 * The read-modify-write is serialized by a lock on the registry file so
 * concurrent SessionStarts in different repos cannot clobber each other.
 *
 * @param repoPath project root (typically CLAUDE_PROJECT_DIR)
 */
export async function registerProject(repoPath: string): Promise<void> {
  const canonical = canonicalize(repoPath);
  const name = path.basename(canonical);
  const now = new Date().toISOString();
  const file = registryPath();

  fs.mkdirSync(path.dirname(file), { recursive: true });
  // proper-lockfile needs the target to exist before it can lock it.
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ version: 1, projects: [] }, null, 2));
  }

  const release = await lockfile.lock(file, { retries: { retries: 10, minTimeout: 50, maxTimeout: 500 } });
  try {
    const existing = await readRegistry();
    const prior = existing.find((p) => p.path === canonical);

    const next: ProjectEntry = prior
      ? { ...prior, lastSeen: now }
      : { path: canonical, name, firstSeen: now, lastSeen: now };

    const projects = prior
      ? existing.map((p) => (p.path === canonical ? next : p))
      : [...existing, next];

    fs.writeFileSync(file, JSON.stringify({ version: 1, projects }, null, 2));
  } finally {
    await release();
  }
}
