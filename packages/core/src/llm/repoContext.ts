import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".agentledger", "coverage"]);
const MAX_FILES_LISTED = 60;

/**
 * Gathers lightweight repo context for the planner prompt:
 * - Top-level directory listing
 * - README.md content (if present)
 * - src/ directory listing (if present, up to MAX_FILES_LISTED)
 */
export async function gatherRepoContext(repoRoot: string): Promise<string> {
  const parts: string[] = [];

  // Top-level listing
  const topEntries = await readdir(repoRoot, { withFileTypes: true }).catch(() => []);
  const topLevel = topEntries
    .filter((e) => !IGNORED_DIRS.has(e.name))
    .map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
    .join("\n");
  parts.push(`Top-level files:\n${topLevel}`);

  // README
  const readmePath = join(repoRoot, "README.md");
  if (existsSync(readmePath)) {
    const readme = await readFile(readmePath, "utf8");
    const truncated = readme.length > 2000 ? readme.slice(0, 2000) + "\n...(truncated)" : readme;
    parts.push(`README.md:\n${truncated}`);
  }

  // src/ listing
  const srcPath = join(repoRoot, "src");
  if (existsSync(srcPath)) {
    const srcFiles = await collectFiles(srcPath, repoRoot, MAX_FILES_LISTED);
    parts.push(`src/ files:\n${srcFiles.join("\n")}`);
  }

  return parts.join("\n\n---\n\n");
}

async function collectFiles(
  dir: string,
  repoRoot: string,
  limit: number,
  results: string[] = [],
): Promise<string[]> {
  if (results.length >= limit) return results;

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (results.length >= limit) break;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, repoRoot, limit, results);
    } else {
      const rel = full.slice(repoRoot.length + 1);
      results.push(rel);
    }
  }

  return results;
}
