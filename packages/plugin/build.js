#!/usr/bin/env node
/**
 * Build script for the AgentLedger plugin.
 *
 * Bundles each hook entry point + all dependencies (@agentledger/core,
 * minimatch, proper-lockfile, zod) into self-contained ESM files under dist/.
 *
 * Result: the plugin can run standalone without a pnpm workspace link
 * or any node_modules except Node.js built-ins.
 */

import { build } from "esbuild";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");

mkdirSync(distDir, { recursive: true });

// Hook entry points — each becomes a self-contained bundle
const hookEntryPoints = [
  "scripts/hooks/session-start.js",
  "scripts/hooks/pre-tool-use.js",
  "scripts/hooks/post-tool-use.js",
  "scripts/hooks/stop.js",
  "scripts/hooks/session-end.js",
];

// Flatten output: dist/session-start.js, dist/pre-tool-use.js, etc.
const entryNames = {
  "scripts/hooks/session-start.js": "session-start",
  "scripts/hooks/pre-tool-use.js": "pre-tool-use",
  "scripts/hooks/post-tool-use.js": "post-tool-use",
  "scripts/hooks/stop.js": "stop",
  "scripts/hooks/session-end.js": "session-end",
};

// Build each hook as a separate bundle
for (const entry of hookEntryPoints) {
  const outName = entryNames[entry];
  await build({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(distDir, `${outName}.cjs`),
    // Keep Node built-ins external — everything else gets bundled
    packages: "bundle",
    external: [],
    // Inject import.meta.url polyfill for CJS output
    banner: {
      js: "var import_meta_url = require('url').pathToFileURL(__filename).href;",
    },
    define: {
      "import.meta.url": "import_meta_url",
    },
    // Minify identifiers but keep code readable for debugging
    minifySyntax: true,
    treeShaking: true,
    // Silence warnings about dynamic imports we've resolved
    logLevel: "warning",
  });
  console.log(`  bundled: dist/${outName}.cjs`);
}

// Skills (skills/<name>/SKILL.md) and hooks/hooks.json are loaded by Claude Code
// directly from the plugin root at their canonical locations — no dist copy needed.

console.log("\nPlugin build complete. All hooks are self-contained.");
