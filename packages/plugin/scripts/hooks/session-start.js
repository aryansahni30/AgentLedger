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

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const agentledgerDir = path.join(projectDir, ".agentledger");
const configPath = path.join(agentledgerDir, "config.json");

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

async function main() {
  // 1. Ensure .agentledger/ exists
  fs.mkdirSync(agentledgerDir, { recursive: true });

  // 2. Write default config if absent
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  // 3. Install skills if not already present
  installSkills();

  // 4. Start dashboard (non-blocking — failure is non-fatal)
  let dashboardStatus = { running: false, port: 4242 };
  try {
    dashboardStatus = await ensureServerRunning();
  } catch {
    // Non-fatal
  }

  // 5. Small delay so AgentLedger banner renders after other plugin banners
  await new Promise((r) => setTimeout(r, 100));

  // 6. Write ledger summary as SessionStart additional context
  //    Claude Code SessionStart hooks must output a JSON envelope on stdout
  //    for content to appear in the model's context block:
  //    {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
  //    Raw text on stdout only appears as a transient "hook success" message.
  try {
    const summary = await buildSessionSummary(projectDir);
    summary.dashboardStatus = dashboardStatus;
    const banner = formatSummary(summary);
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: banner,
      },
      systemMessage: banner,
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
