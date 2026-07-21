#!/usr/bin/env node
/**
 * SessionStart hook for the AgentLedger plugin.
 *
 * Responsibilities:
 *   1. Ensure .agentledger/ directory exists in the project
 *   2. Write default config.json if absent
 *   3. Ensure the dashboard server is running
 *   4. Print a compact ledger summary
 */

import fs from "fs";
import path from "path";
import os from "os";
import { ensureServerRunning } from "../server-manager.js";
import { buildSessionSummary, formatSummary } from "../summary.js";
import { readStats, writeStats } from "../stats.js";
import { readSessionState } from "../state.js";
import { readAndClearLastSummary, renderCheckpointBox } from "../end-summary.js";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const agentledgerDir = path.join(projectDir, ".agentledger");
const configPath = path.join(agentledgerDir, "config.json");
const statsPath = path.join(agentledgerDir, "stats.json");

/**
 * Delay before emitting our SessionStart systemMessage.
 *
 * Claude Code runs SessionStart hooks concurrently and renders each hook's
 * systemMessage in completion order. We want our box to land *below* other
 * plugins' banners (notably claude-mem's "recent context", which is emitted by
 * a health-poll + context-generation hook that finishes ~0.15s+ in). Losing the
 * race deliberately keeps the AgentLedger box as the last, closest-to-prompt
 * block. Tuned above claude-mem's warm emit plus jitter; raise if a cold worker
 * pushes claude-mem later on the first session after a reboot.
 */
const RENDER_LAST_DELAY_MS = 1500;

/** Default plugin config written on first run */
const DEFAULT_CONFIG = {
  blockedFiles: ["**/.env", "**/secrets.*", "**/*.pem", "**/*.key"],
  warnFiles: ["**/migrations/**", "**/auth/**", "package.json", "**/middleware.*"],
  testCommand: "npm test",
  testTimeout: 30000,
  claimDetection: true,
  dashboardPort: 4242,
  operator: "",
};

/**
 * Install skills to ~/.claude/skills/agentledger-<name>/SKILL.md
 * Idempotent — skips if file exists and differs (user customized).
 * Only installs if file is missing or identical to shipped version.
 */
function installSkills() {
  const claudeDir = path.join(os.homedir(), ".claude", "skills");
  // Works in both ESM (import.meta.url) and CJS (__dirname) contexts
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const skillsSrc = path.join(thisDir, "..", "skills");

  // Also check dist/skills/ for bundled installs
  const distSkillsSrc = path.join(thisDir, "..", "..", "dist", "skills");
  const srcDir = fs.existsSync(skillsSrc) ? skillsSrc : (fs.existsSync(distSkillsSrc) ? distSkillsSrc : null);

  if (!srcDir) return;

  try {
    const skillFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
    for (const file of skillFiles) {
      const name = file.replace(".md", "");
      const destDir = path.join(claudeDir, `agentledger-${name}`);
      const destFile = path.join(destDir, "SKILL.md");
      const srcContent = fs.readFileSync(path.join(srcDir, file), "utf8");

      if (fs.existsSync(destFile)) {
        const existing = fs.readFileSync(destFile, "utf8");
        if (existing !== srcContent) {
          // User has customized — don't clobber
          continue;
        }
        // Identical — skip (already installed)
        continue;
      }

      // Install
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(destFile, srcContent);
    }
  } catch {
    // Non-fatal — skills are a convenience, not required
  }
}

/**
 * Create stats.json with zeroed defaults if it does not exist yet.
 * Existing stats are never overwritten — readStats returns what is on disk and
 * writeStats puts it straight back, so a re-run cannot reset a trust score.
 */
async function ensureStatsInitialized() {
  try {
    if (fs.existsSync(statsPath)) return;
    await writeStats(await readStats());
  } catch (err) {
    // Non-fatal — a missing stats file degrades the banner, it does not break the session.
    console.error("[agentledger] Warning: could not initialize stats:", err?.message);
  }
}

/**
 * Read the SessionStart trigger from the hook payload on stdin.
 * Claude Code passes {"source":"startup"|"resume"|"clear"|"compact", ...} as JSON.
 * Defaults to "startup" if stdin is empty or unparseable (e.g. manual invocation).
 *
 * @returns {"startup" | "resume" | "clear" | "compact"}
 */
function readSource() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    const data = JSON.parse(raw);
    return typeof data.source === "string" ? data.source : "startup";
  } catch {
    return "startup";
  }
}

/**
 * Build the extra block appended below the Session Start banner:
 *   - source "compact": SessionEnd did NOT run, so render a live checkpoint box.
 *   - otherwise: replay the persisted Session End box once (fires on /clear and
 *     at the next launch after a hard quit), then delete it.
 *
 * @param {string} source
 * @param {import("../summary.js").Stats | undefined} stats
 * @returns {Promise<string>}
 */
async function buildExtraBlock(source, stats) {
  if (source === "compact") {
    try {
      const state = await readSessionState();
      return renderCheckpointBox(state, stats ?? {});
    } catch {
      return "";
    }
  }
  return readAndClearLastSummary(projectDir) ?? "";
}

async function main() {
  const source = readSource();

  // 1. Ensure .agentledger/ exists
  fs.mkdirSync(agentledgerDir, { recursive: true });

  // 1b. Register this repo in the cross-project registry so the dashboard can
  //     discover and read its ledger. Non-fatal: a registry write failure must
  //     never break a session.
  try {
    const { registerProject } = await import("@agentledger/core");
    await registerProject(projectDir);
  } catch (err) {
    console.error("[agentledger] Warning: could not register project:", err?.message);
  }

  // 2. Write default config if absent
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  // 3. Materialize stats.json so trust tracking has a file from the first session,
  //    not only after one ends cleanly. readStats() returns defaults in memory when
  //    the file is absent, which meant a session that was killed, crashed, or simply
  //    left open never produced stats on disk at all.
  await ensureStatsInitialized();

  // 4. Install skills if not already present
  installSkills();

  // 4. Start dashboard (non-blocking — failure is non-fatal)
  let dashboardStatus = { running: false, port: 4242 };
  try {
    dashboardStatus = await ensureServerRunning();
  } catch {
    // Non-fatal
  }

  // 5. Delay so our systemMessage renders after other plugin banners (see const)
  await new Promise((r) => setTimeout(r, RENDER_LAST_DELAY_MS));

  // 6. Write ledger summary as SessionStart additional context
  //    Claude Code SessionStart hooks must output a JSON envelope on stdout
  //    for content to appear in the model's context block:
  //    {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
  //    Raw text on stdout only appears as a transient "hook success" message.
  try {
    const summary = await buildSessionSummary(projectDir);
    summary.dashboardStatus = dashboardStatus;
    const banner = formatSummary(summary);

    // Append the Session End box (on /clear or next launch) or a live checkpoint
    // (on compact). This is the only reliably visible path for end-of-session data:
    // SessionStart stdout renders as a systemMessage, SessionEnd stdout does not.
    const extra = await buildExtraBlock(source, summary.stats);
    const full = extra ? `${banner}\n${extra}` : banner;

    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: full,
      },
      systemMessage: full,
    });
    process.stdout.write(payload);
  } catch (err) {
    // Non-fatal — session continues regardless
    console.error("[agentledger] Warning: could not build summary:", err?.message);
  }
}

main().catch((err) => {
  console.error("[agentledger] session-start error:", err?.message);
  process.exit(0); // Never block Claude Code from starting
});
