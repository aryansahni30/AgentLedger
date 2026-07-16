/**
 * Persistent stats management for AgentLedger plugin.
 *
 * Stats live in {projectDir}/.agentledger/stats.json.
 * Tracks trust score, claim accuracy, file operations, and session history.
 * Updated at session end; read at session start for the banner.
 */

import fs from "fs";
import path from "path";
import lockfile from "proper-lockfile";

const STATS_VERSION = 1;
const MAX_RECENT_FALSE_CLAIMS = 10;

/** @returns {string} */
function statsPath() {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  return path.join(projectDir, ".agentledger", "stats.json");
}

/**
 * @typedef {{
 *   version: number,
 *   totalClaims: number,
 *   verifiedTrue: number,
 *   verifiedFalse: number,
 *   unverifiable: number,
 *   trustScore: number,
 *   totalBlocks: number,
 *   totalWarnings: number,
 *   sessionsTracked: number,
 *   filesReadTotal: number,
 *   filesEditedTotal: number,
 *   readEditRatio: number,
 *   recentFalseClaims: Array<{ claim: string, actual: string, timestamp: string }>,
 *   lastUpdated: string
 * }} Stats
 */

/** @returns {Stats} */
function defaultStats() {
  return {
    version: STATS_VERSION,
    totalClaims: 0,
    verifiedTrue: 0,
    verifiedFalse: 0,
    unverifiable: 0,
    trustScore: 0,
    totalBlocks: 0,
    totalWarnings: 0,
    sessionsTracked: 0,
    filesReadTotal: 0,
    filesEditedTotal: 0,
    readEditRatio: 0,
    recentFalseClaims: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Read current stats, returning defaults if file absent or invalid.
 * @returns {Promise<Stats>}
 */
export async function readStats() {
  const filePath = statsPath();

  if (!fs.existsSync(filePath)) {
    return defaultStats();
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    // Ensure version compatibility
    if (parsed.version !== STATS_VERSION) {
      return defaultStats();
    }
    return parsed;
  } catch {
    return defaultStats();
  }
}

/**
 * Write stats atomically using a lockfile.
 * @param {Stats} stats
 * @returns {Promise<void>}
 */
export async function writeStats(stats) {
  const filePath = statsPath();
  const dir = path.dirname(filePath);

  fs.mkdirSync(dir, { recursive: true });

  // Ensure file exists for lockfile
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultStats(), null, 2));
  }

  let release;
  try {
    release = await lockfile.lock(filePath, { retries: { retries: 5, minTimeout: 50 } });
    fs.writeFileSync(filePath, JSON.stringify(stats, null, 2));
  } finally {
    if (release) await release();
  }
}

/**
 * Compute trust score from verified/falsified counts.
 * Only counts deterministically verifiable claims.
 * @param {number} verifiedTrue
 * @param {number} verifiedFalse
 * @returns {number} 0-1 score, 0 if no claims
 */
function computeTrustScore(verifiedTrue, verifiedFalse) {
  const total = verifiedTrue + verifiedFalse;
  if (total === 0) return 0;
  return verifiedTrue / total;
}

/**
 * Compute read:edit ratio.
 * @param {number} reads
 * @param {number} edits
 * @returns {number}
 */
function computeReadEditRatio(reads, edits) {
  if (edits === 0) return reads > 0 ? reads : 0;
  return reads / edits;
}

/**
 * @typedef {{
 *   claimsVerifiedTrue: number,
 *   claimsVerifiedFalse: number,
 *   claimsUnverifiable: number,
 *   blocks: number,
 *   warnings: number,
 *   filesRead: number,
 *   filesEdited: number,
 *   falseClaims: Array<{ claim: string, actual: string, timestamp: string }>
 * }} SessionStats
 */

/**
 * Merge a completed session's stats into the persistent stats file.
 * Immutable — reads current, computes new, writes new.
 *
 * @param {SessionStats} session
 * @returns {Promise<Stats>} the updated stats
 */
export async function mergeSessionStats(session) {
  const current = await readStats();

  const verifiedTrue = current.verifiedTrue + session.claimsVerifiedTrue;
  const verifiedFalse = current.verifiedFalse + session.claimsVerifiedFalse;
  const filesReadTotal = current.filesReadTotal + session.filesRead;
  const filesEditedTotal = current.filesEditedTotal + session.filesEdited;

  // Merge recent false claims, keep last N
  const allFalseClaims = [...current.recentFalseClaims, ...session.falseClaims];
  const recentFalseClaims = allFalseClaims.slice(-MAX_RECENT_FALSE_CLAIMS);

  const updated = {
    ...current,
    totalClaims: current.totalClaims + session.claimsVerifiedTrue + session.claimsVerifiedFalse + session.claimsUnverifiable,
    verifiedTrue,
    verifiedFalse,
    unverifiable: current.unverifiable + session.claimsUnverifiable,
    trustScore: computeTrustScore(verifiedTrue, verifiedFalse),
    totalBlocks: current.totalBlocks + session.blocks,
    totalWarnings: current.totalWarnings + session.warnings,
    sessionsTracked: current.sessionsTracked + 1,
    filesReadTotal,
    filesEditedTotal,
    readEditRatio: computeReadEditRatio(filesReadTotal, filesEditedTotal),
    recentFalseClaims,
    lastUpdated: new Date().toISOString(),
  };

  await writeStats(updated);
  return updated;
}
