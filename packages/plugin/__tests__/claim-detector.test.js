import { describe, it, expect } from "vitest";
import { detectClaims, classifyClaims } from "../scripts/claim-detector.js";

describe("claim-detector.js — detectClaims", () => {
  it("detects 'tests pass' claim", () => {
    const claims = detectClaims("All done! The tests pass and everything looks good.");
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("test_claim");
    expect(claims[0].text).toBe("tests pass");
  });

  it("detects 'tests passing' variation", () => {
    const claims = detectClaims("I verified that all tests passing correctly.");
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("test_claim");
  });

  it("detects build success claims", () => {
    const claims = detectClaims("The project compiled successfully with no warnings.");
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("build_claim");
  });

  it("detects fix claims", () => {
    const claims = detectClaims("I fixed the bug in the authentication module.");
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("fix_claim");
  });

  it("detects 'working now' claims", () => {
    const claims = detectClaims("The feature is working correctly after the change.");
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("fix_claim");
  });

  it("detects quality claims", () => {
    const claims = detectClaims("There are no errors in the output.");
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("quality_claim");
  });

  it("returns empty for messages with no claims", () => {
    const claims = detectClaims("I read the file and here are the contents.");
    expect(claims).toHaveLength(0);
  });

  it("returns empty for very short messages", () => {
    const claims = detectClaims("OK");
    expect(claims).toHaveLength(0);
  });

  it("returns empty for empty input", () => {
    expect(detectClaims("")).toHaveLength(0);
    expect(detectClaims(null)).toHaveLength(0);
    expect(detectClaims(undefined)).toHaveLength(0);
  });

  it("ignores claims inside code blocks", () => {
    const message = "Here's the output:\n```\ntests pass\n```\nLet me check again.";
    const claims = detectClaims(message);
    expect(claims).toHaveLength(0);
  });

  it("ignores claims inside inline code", () => {
    const message = "The command `tests pass` should be run manually.";
    const claims = detectClaims(message);
    expect(claims).toHaveLength(0);
  });

  it("detects at most one claim per type", () => {
    const message = "Tests pass! All tests passing! Check pass!";
    const claims = detectClaims(message);
    // All are test_claim type — should only get one
    const testClaims = claims.filter((c) => c.type === "test_claim");
    expect(testClaims).toHaveLength(1);
  });

  it("detects multiple claims of different types", () => {
    const message = "The tests pass and I fixed the bug.";
    const claims = detectClaims(message);
    expect(claims.length).toBeGreaterThanOrEqual(2);
    const types = claims.map((c) => c.type);
    expect(types).toContain("test_claim");
    expect(types).toContain("fix_claim");
  });
});

describe("claim-detector.js — classifyClaims", () => {
  it("classifies test claims as verifiable when test command exists", () => {
    const claims = [{ text: "tests pass", type: "test_claim", matchedPattern: "" }];
    const { verifiable, unverifiable } = classifyClaims(claims, true);
    expect(verifiable).toHaveLength(1);
    expect(unverifiable).toHaveLength(0);
  });

  it("classifies test claims as unverifiable when no test command", () => {
    const claims = [{ text: "tests pass", type: "test_claim", matchedPattern: "" }];
    const { verifiable, unverifiable } = classifyClaims(claims, false);
    expect(verifiable).toHaveLength(0);
    expect(unverifiable).toHaveLength(1);
  });

  it("classifies fix claims as verifiable when test command exists", () => {
    const claims = [{ text: "fixed the bug", type: "fix_claim", matchedPattern: "" }];
    const { verifiable } = classifyClaims(claims, true);
    expect(verifiable).toHaveLength(1);
  });

  it("handles mixed verifiable and unverifiable", () => {
    const claims = [
      { text: "tests pass", type: "test_claim", matchedPattern: "" },
      { text: "fixed", type: "fix_claim", matchedPattern: "" },
    ];
    const { verifiable, unverifiable } = classifyClaims(claims, false);
    expect(verifiable).toHaveLength(0);
    expect(unverifiable).toHaveLength(2);
  });
});
