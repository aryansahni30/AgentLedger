/**
 * Claim detection for AgentLedger plugin.
 *
 * Scans assistant output for completion claims (e.g. "tests pass", "fixed the bug")
 * and classifies them by type for downstream verification.
 */

/**
 * @typedef {{
 *   text: string,
 *   type: "test_claim" | "build_claim" | "fix_claim" | "completion_claim" | "quality_claim",
 *   matchedPattern: string
 * }} DetectedClaim
 */

/** @type {Array<{ pattern: RegExp, type: DetectedClaim["type"], label: string }>} */
const CLAIM_PATTERNS = [
  { pattern: /tests?\s+(pass|passing|succeed|green|succeeded)/i, type: "test_claim", label: "tests pass" },
  { pattern: /(?:all\s+)?checks?\s+pass/i, type: "test_claim", label: "checks pass" },
  { pattern: /build\s+(?:succeed|pass|green|success|succeeded)/i, type: "build_claim", label: "build succeeds" },
  { pattern: /(?:compiled?|built)\s+(?:successfully|without\s+errors?)/i, type: "build_claim", label: "compiled successfully" },
  { pattern: /successfully\s+(?:built|compiled|tested|deployed)/i, type: "build_claim", label: "successfully built" },
  { pattern: /no\s+(?:errors?|issues?|failures?|bugs?)\s/i, type: "quality_claim", label: "no errors" },
  { pattern: /(?:fixed|resolved)\s+(?:the\s+)?(?:bug|issue|error|problem)/i, type: "fix_claim", label: "fixed the bug" },
  { pattern: /(?:working|works)\s+(?:now|correctly|properly|as\s+expected)/i, type: "fix_claim", label: "working now" },
];

/**
 * Patterns that indicate Claude is quoting/referencing rather than claiming.
 * Reduces false positives from code blocks, error messages, etc.
 */
const NEGATION_CONTEXTS = [
  /```[\s\S]*?```/g,         // code blocks
  /`[^`]+`/g,                // inline code
  /> .*/g,                   // blockquotes
  /\bif\b.*\bthen\b/gi,     // conditional language
  /\bwhen\b.*\b(?:pass|fail)/gi, // conditional
  /\bshould\b/gi,            // suggestions, not claims
  /\bwill\b/gi,              // future tense
  /\bcan\b/gi,               // ability, not claim
  /\btry\b/gi,               // attempt, not claim
  /\bneed to\b/gi,           // instruction, not claim
];

/**
 * Strip contexts that are likely quoting/referencing, not claiming.
 * @param {string} text
 * @returns {string}
 */
function stripNonClaimContexts(text) {
  let cleaned = text;
  for (const pattern of NEGATION_CONTEXTS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleaned;
}

/**
 * Detect completion claims in assistant output text.
 *
 * @param {string} assistantMessage — the assistant's response text
 * @returns {DetectedClaim[]} — array of detected claims (may be empty)
 */
export function detectClaims(assistantMessage) {
  if (!assistantMessage || assistantMessage.length < 10) {
    return [];
  }

  const cleaned = stripNonClaimContexts(assistantMessage);
  const claims = [];
  const seenTypes = new Set();

  for (const { pattern, type, label } of CLAIM_PATTERNS) {
    // Only detect one claim per type per message
    if (seenTypes.has(type)) continue;

    if (pattern.test(cleaned)) {
      seenTypes.add(type);
      claims.push({
        text: label,
        type,
        matchedPattern: pattern.source,
      });
    }
  }

  return claims;
}

/**
 * Determine which claims are verifiable with a test command vs unverifiable.
 *
 * @param {DetectedClaim[]} claims
 * @param {boolean} hasTestCommand — whether a test command is configured
 * @returns {{ verifiable: DetectedClaim[], unverifiable: DetectedClaim[] }}
 */
export function classifyClaims(claims, hasTestCommand) {
  const verifiable = [];
  const unverifiable = [];

  for (const claim of claims) {
    if (claim.type === "test_claim" || claim.type === "build_claim") {
      // These need a test/build command to verify
      if (hasTestCommand) {
        verifiable.push(claim);
      } else {
        unverifiable.push(claim);
      }
    } else if (claim.type === "fix_claim" || claim.type === "completion_claim") {
      // Can partially verify with tests + boundary check
      if (hasTestCommand) {
        verifiable.push(claim);
      } else {
        unverifiable.push(claim);
      }
    } else {
      // quality_claim
      if (hasTestCommand) {
        verifiable.push(claim);
      } else {
        unverifiable.push(claim);
      }
    }
  }

  return { verifiable, unverifiable };
}
