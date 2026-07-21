#!/usr/bin/env node
/**
 * AgentLedger is now a native Claude Code plugin.
 *
 * It is no longer installed by writing hooks into ~/.claude/settings.json.
 * Instead, install it through the Claude Code plugin marketplace, which copies
 * the plugin into Claude Code's managed cache and registers its hooks and skills
 * automatically (skills namespace as /agentledger:<name>).
 *
 * This script is intentionally a no-op: it never mutates settings.json. Running
 * the old manual installer alongside a marketplace install would double-register
 * every hook and fire each one twice. It only prints instructions.
 */

const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

console.log(`
  ${BOLD}AgentLedger — the trust layer for AI coding agents${RESET}

  AgentLedger is now a native Claude Code plugin. Install it via the
  plugin marketplace (no manual settings.json edits):

    ${CYAN}/plugin marketplace add aryansahni30/AgentLeader${RESET}
    ${CYAN}/plugin install agentledger@agentledger${RESET}

  ${DIM}Then restart Claude Code. Hooks and skills (/agentledger:trust,${RESET}
  ${DIM}/agentledger:verify, /agentledger:audit, …) load automatically.${RESET}

  ${DIM}This installer no longer edits ~/.claude/settings.json — running it${RESET}
  ${DIM}alongside a marketplace install would fire every hook twice.${RESET}
`);
