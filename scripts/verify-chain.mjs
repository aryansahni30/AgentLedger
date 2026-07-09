#!/usr/bin/env node
/**
 * AgentLedger — Standalone Hash Chain Verifier
 *
 * Verifies the SHA-256 hash chain of any AgentLedger ledger.jsonl file.
 * No dependencies. Requires Node.js >= 18.
 *
 * Usage:
 *   node scripts/verify-chain.mjs .agentledger/ledger.jsonl
 *   node scripts/verify-chain.mjs --quiet .agentledger/ledger.jsonl
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { resolve } from "path";

const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const quietFlag = args.includes("--quiet") || args.includes("-q");
const filePath = args.find((a) => !a.startsWith("-"));

if (!filePath) {
  console.error(`Usage: node verify-chain.mjs [--quiet] <path-to-ledger.jsonl>`);
  process.exit(1);
}

const ledgerPath = resolve(filePath);

// ── Hash logic (matches LedgerWriter exactly) ─────────────────────────────────

function computeHash(previousHash, payload) {
  return createHash("sha256")
    .update(previousHash + JSON.stringify(payload))
    .digest("hex");
}

// ── Read and verify ───────────────────────────────────────────────────────────

async function verifyChain(path) {
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  let previousHash = "genesis";
  let totalEvents = 0;
  const violations = [];

  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      violations.push({ lineNumber, reason: "invalid JSON", raw: trimmed.slice(0, 80) });
      continue;
    }

    totalEvents++;

    const { hash, previous_hash, payload, event_id, event_type, timestamp } = event;

    // Structural checks
    if (!hash || !previous_hash || !payload) {
      violations.push({
        lineNumber,
        eventId: event_id ?? "(unknown)",
        eventType: event_type ?? "(unknown)",
        reason: "missing required fields (hash, previous_hash, or payload)",
      });
      previousHash = hash ?? previousHash;
      continue;
    }

    // Chain continuity
    if (previous_hash !== previousHash) {
      violations.push({
        lineNumber,
        eventId: event_id,
        eventType: event_type,
        timestamp,
        reason: `previous_hash mismatch — expected ${previousHash.slice(0, 12)}… got ${previous_hash.slice(0, 12)}…`,
      });
    }

    // Hash integrity
    const expected = computeHash(previous_hash, payload);
    if (expected !== hash) {
      violations.push({
        lineNumber,
        eventId: event_id,
        eventType: event_type,
        timestamp,
        reason: `hash mismatch — expected ${expected.slice(0, 12)}… got ${hash.slice(0, 12)}…`,
      });
    }

    previousHash = hash;
  }

  return { totalEvents, violations, lineNumber };
}

// ── Output ────────────────────────────────────────────────────────────────────

(async () => {
  if (!quietFlag) {
    console.log(`\n${BOLD}${CYAN}AgentLedger — Hash Chain Verifier${RESET}`);
    console.log(`${DIM}${ledgerPath}${RESET}\n`);
  }

  let result;
  try {
    result = await verifyChain(ledgerPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(`${RED}Error: file not found: ${ledgerPath}${RESET}`);
    } else {
      console.error(`${RED}Error: ${err.message}${RESET}`);
    }
    process.exit(1);
  }

  const { totalEvents, violations } = result;

  if (violations.length === 0) {
    if (!quietFlag) {
      console.log(`${GREEN}✓ Chain intact — ${totalEvents} event(s) verified${RESET}`);
      console.log(`${DIM}  Algorithm: SHA-256(previous_hash + JSON.stringify(payload))${RESET}`);
      console.log(`${DIM}  Genesis:   previous_hash = "genesis"${RESET}\n`);
    } else {
      console.log(`OK ${totalEvents}`);
    }
    process.exit(0);
  } else {
    if (!quietFlag) {
      console.log(`${RED}✗ Chain invalid — ${violations.length} violation(s) in ${totalEvents} event(s)${RESET}\n`);
      for (const v of violations) {
        console.log(`  ${RED}✗${RESET} line ${v.lineNumber}${v.eventType ? ` [${v.eventType}]` : ""}`);
        console.log(`    ${DIM}${v.reason}${RESET}`);
        if (v.eventId) console.log(`    ${DIM}event_id: ${v.eventId}${RESET}`);
        if (v.raw)     console.log(`    ${DIM}raw:      ${v.raw}${RESET}`);
        console.log();
      }
    } else {
      console.log(`FAIL ${violations.length}`);
    }
    process.exit(1);
  }
})();
