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

/**
 * Patterns are matched against real assistant phrasing, not idealized strings.
 * Claude rarely writes the bare "tests pass" the first drafts assumed — it writes
 * "all tests are passing", "48/48 green", "Test suite: 48 passed (48)", "typecheck
 * clean". Each addition below corresponds to a phrasing observed in a real session
 * that the original patterns missed.
 *
 * @type {Array<{ pattern: RegExp, type: DetectedClaim["type"], label: string }>}
 */
const CLAIM_PATTERNS = [
  // "tests pass" / "tests are passing" / "tests all pass" / "test suite passes"
  { pattern: /tests?(?:\s+suite)?\s+(?:\w+\s+){0,2}?(?:pass(?:es|ing|ed)?|succeed(?:s|ed)?|green)/i, type: "test_claim", label: "tests pass" },
  // "48/48 green", "48/48 passing", "24 of 24 pass"
  { pattern: /\b\d+\s*(?:\/|of)\s*\d+\s+(?:tests?\s+)?(?:pass(?:ed|ing)?|green)/i, type: "test_claim", label: "tests pass" },
  // "48 passed (48)" — vitest/jest summary line pasted or paraphrased
  { pattern: /\b\d+\s+passed\b/i, type: "test_claim", label: "tests pass" },
  // "all green", "suite is green", "baseline green"
  { pattern: /\b(?:all|suite|baseline|everything)\s+(?:is\s+)?green\b/i, type: "test_claim", label: "tests green" },
  { pattern: /(?:all\s+)?checks?\s+pass/i, type: "test_claim", label: "checks pass" },
  // "typecheck clean" / "typecheck is clean" / "typechecks cleanly" / "tsc clean"
  { pattern: /(?:typecheck|type-check|tsc|lint|build)s?\s+(?:is\s+|are\s+|runs\s+)?clean(?:ly)?/i, type: "build_claim", label: "typecheck clean" },
  { pattern: /build\s+(?:succeed|pass|green|success|succeeded)/i, type: "build_claim", label: "build succeeds" },
  { pattern: /(?:compiled?|built)\s+(?:successfully|without\s+errors?)/i, type: "build_claim", label: "compiled successfully" },
  { pattern: /successfully\s+(?:built|compiled|tested|deployed)/i, type: "build_claim", label: "successfully built" },
  { pattern: /no\s+(?:errors?|issues?|failures?|bugs?)\s/i, type: "quality_claim", label: "no errors" },
  { pattern: /(?:fixed|resolved)\s+(?:the\s+)?(?:bug|issue|error|problem)/i, type: "fix_claim", label: "fixed the bug" },
  { pattern: /(?:working|works)\s+(?:now|correctly|properly|as\s+expected)/i, type: "fix_claim", label: "working now" },
];

/**
 * Spans that are quoting or displaying rather than asserting. These are removed
 * outright: a claim inside a code block or a blockquote is not the assistant's own.
 */
const QUOTED_SPANS = [
  /```[\s\S]*?```/g, // fenced code blocks
  /`[^`]+`/g,        // inline code
  /^\s*>.*$/gm,      // blockquotes
];

/**
 * Markers that make a sentence a hedge, a plan, or a condition rather than an
 * assertion of fact — "the tests should pass", "let me see if the tests pass".
 *
 * These must be tested against the sentence and used to DISCARD it. An earlier
 * version instead deleted these words from the text before matching, which had
 * exactly the wrong effect: stripping "should" out of "tests should pass" left
 * "tests pass", turning every hedge into a detected claim.
 */
const HEDGE_MARKERS =
  /\b(?:should|would|will|won't|can|could|may|might|if|whether|once|unless|try|trying|let me|let's|going to|about to|need to|needs to|expect|expects|expected to|hope|hopefully|see if|check if|verify that|make sure|ensure)\b/i;

/** Sentence-ish split. Keeps list items and newlines as boundaries. */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Reduce text to sentences that actually assert something, dropping quoted spans
 * and hedged/conditional/planning sentences.
 *
 * @param {string} text
 * @returns {string} the assertive sentences, rejoined
 */
function assertiveSentencesOnly(text) {
  let cleaned = text;
  for (const pattern of QUOTED_SPANS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return splitSentences(cleaned)
    .filter((sentence) => !HEDGE_MARKERS.test(sentence))
    .join(" ");
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

  const cleaned = assertiveSentencesOnly(assistantMessage);
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
