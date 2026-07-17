#!/usr/bin/env node
/**
 * AgentLedger Plugin Installer
 *
 * Usage: npx agentledger-install
 *    or: node install.js
 *
 * What it does:
 *   1. Detects the plugin's install directory
 *   2. Merges hooks into ~/.claude/settings.json (preserves existing hooks)
 *   3. Installs skills to ~/.claude/skills/agentledger-{name}/SKILL.md
 *   4. Prints confirmation
 *
 * Idempotent — safe to run multiple times.
 * Never overwrites user-customized skills.
 * Merges hooks — never clobbers existing hook entries.
 */

import fs from "fs";
import path from "path";
import os from "os";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const SKILLS_DIR = path.join(CLAUDE_DIR, "skills");

// Resolve plugin root (where this script lives)
const PLUGIN_ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST_DIR = path.join(PLUGIN_ROOT, "dist");
const SKILLS_SRC = path.join(PLUGIN_ROOT, "skills");

// ── Hooks to register ─────────────────────────────────────────────────────

function buildHooks() {
  const distDir = fs.existsSync(DIST_DIR) ? DIST_DIR : null;

  if (!distDir) {
    console.error("Error: dist/ not found. Run 'npm run build' first (or 'node build.js').");
    process.exit(1);
  }

  // Use absolute paths so hooks work from any project directory
  const abs = (file) => path.join(distDir, file);

  return {
    SessionStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `node "${abs("session-start.cjs")}"`,
            timeout: 15,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Edit|Write",
        hooks: [
          {
            type: "command",
            command: `node "${abs("pre-tool-use.cjs")}"`,
            timeout: 10,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Edit|Write|Bash|Read",
        hooks: [
          {
            type: "command",
            command: `node "${abs("post-tool-use.cjs")}"`,
            timeout: 10,
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `node "${abs("stop.cjs")}"`,
            timeout: 45,
          },
        ],
      },
    ],
    SessionEnd: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `node "${abs("session-end.cjs")}"`,
            timeout: 120,
          },
        ],
      },
    ],
  };
}

// ── Settings merge ────────────────────────────────────────────────────────

/**
 * Check if an AgentLedger hook entry already exists in a hook array.
 * Identifies by command containing "agentledger" or our dist path.
 */
function isAgentLedgerHook(entry) {
  const hooks = entry?.hooks ?? [];
  return hooks.some(
    (h) =>
      typeof h.command === "string" &&
      (h.command.toLowerCase().includes("agentledger") ||
        h.command.includes("agentledger-plugin") ||
        h.command.includes("/plugin/scripts/hooks/") ||
        h.command.includes("/plugin/dist/") ||
        h.command.includes("session-start.cjs") ||
        h.command.includes("pre-tool-use.cjs") ||
        h.command.includes("post-tool-use.cjs") ||
        h.command.includes("stop.cjs") ||
        h.command.includes("session-end.cjs"))
  );
}

function mergeHooksIntoSettings() {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });

  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
      // Parse JSONC — strip comments outside of strings
      // Simple approach: try plain JSON first, fallback to comment stripping
      try {
        settings = JSON.parse(raw);
      } catch {
        // Strip block comments, then line comments only outside strings
        // Replace strings with placeholders, strip comments, restore strings
        const strings = [];
        const withPlaceholders = raw.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
          strings.push(match);
          return `"__PLACEHOLDER_${strings.length - 1}__"`;
        });
        const stripped = withPlaceholders
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        const restored = stripped.replace(/"__PLACEHOLDER_(\d+)__"/g, (_, i) => strings[Number(i)]);
        settings = JSON.parse(restored);
      }
    } catch (err) {
      console.error(`Warning: could not parse ${SETTINGS_PATH}: ${err.message}`);
      console.error("Creating backup and starting fresh hooks section.");
      fs.copyFileSync(SETTINGS_PATH, SETTINGS_PATH + ".backup");
      settings = {};
    }
  }

  const newHooks = buildHooks();
  const existingHooks = settings.hooks ?? {};

  // For each hook type, remove old AgentLedger entries and append new ones
  for (const [hookType, newEntries] of Object.entries(newHooks)) {
    const existing = Array.isArray(existingHooks[hookType])
      ? existingHooks[hookType]
      : [];

    // Filter out old AgentLedger entries
    const kept = existing.filter((entry) => !isAgentLedgerHook(entry));

    // Append new entries
    existingHooks[hookType] = [...kept, ...newEntries];
  }

  settings.hooks = existingHooks;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

  return Object.keys(newHooks).length;
}

// ── Skills install ────────────────────────────────────────────────────────

function installSkills() {
  // Check both source locations
  const srcDir = fs.existsSync(SKILLS_SRC)
    ? SKILLS_SRC
    : fs.existsSync(path.join(DIST_DIR, "skills"))
      ? path.join(DIST_DIR, "skills")
      : null;

  if (!srcDir) {
    console.log("  Skills: source not found (non-fatal)");
    return 0;
  }

  const skillFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
  let installed = 0;
  let skipped = 0;

  for (const file of skillFiles) {
    const name = file.replace(".md", "");
    const destDir = path.join(SKILLS_DIR, `agentledger-${name}`);
    const destFile = path.join(destDir, "SKILL.md");
    const srcContent = fs.readFileSync(path.join(srcDir, file), "utf8");

    if (fs.existsSync(destFile)) {
      const existing = fs.readFileSync(destFile, "utf8");
      if (existing !== srcContent) {
        skipped++;
        continue; // User customized — don't clobber
      }
      // Identical — already up to date
      continue;
    }

    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(destFile, srcContent);
    installed++;
  }

  return { installed, skipped, total: skillFiles.length };
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  console.log("\n  AgentLedger Plugin Installer\n");

  // 1. Check dist exists
  if (!fs.existsSync(DIST_DIR)) {
    console.error("  Error: dist/ directory not found.");
    console.error("  Run 'node build.js' in the plugin directory first.\n");
    process.exit(1);
  }

  // 2. Merge hooks
  console.log("  [1/2] Registering hooks in ~/.claude/settings.json...");
  const hookCount = mergeHooksIntoSettings();
  console.log(`         ${hookCount} hook types registered (merged with existing hooks)`);

  // 3. Install skills
  console.log("  [2/2] Installing skills to ~/.claude/skills/...");
  const skillResult = installSkills();
  if (typeof skillResult === "object") {
    const parts = [];
    if (skillResult.installed > 0) parts.push(`${skillResult.installed} installed`);
    if (skillResult.skipped > 0) parts.push(`${skillResult.skipped} skipped (user-customized)`);
    const upToDate = skillResult.total - skillResult.installed - skillResult.skipped;
    if (upToDate > 0) parts.push(`${upToDate} up-to-date`);
    console.log(`         ${parts.join(", ")}`);
  }

  // 4. Done
  console.log("\n  ✓ AgentLedger installed successfully!\n");
  console.log("  What happens next:");
  console.log("  • Open any project in Claude Code");
  console.log("  • AgentLedger will auto-create .agentledger/ in the project");
  console.log("  • Protected files (.env, *.pem, *.key) are blocked automatically");
  console.log("  • Trust score starts tracking on first claim detection");
  console.log("  • Use /agentledger-trust to see your trust score\n");
}

main();
