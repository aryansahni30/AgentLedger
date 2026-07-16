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
  claimDetection: true,
  operator: "",
};

async function main() {
  // 1. Ensure .agentledger/ exists
  fs.mkdirSync(agentledgerDir, { recursive: true });

  // 2. Write default config if absent
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  // 3. Start dashboard (non-blocking — failure is non-fatal)
  ensureServerRunning().catch(() => {});

  // 4. Small delay so AgentLedger banner renders after other plugin banners
  await new Promise((r) => setTimeout(r, 100));

  // 5. Write ledger summary as SessionStart additional context
  //    Claude Code SessionStart hooks must output a JSON envelope on stdout
  //    for content to appear in the model's context block:
  //    {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
  //    Raw text on stdout only appears as a transient "hook success" message.
  try {
    const summary = await buildSessionSummary(projectDir);
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
