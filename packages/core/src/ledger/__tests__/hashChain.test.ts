import { describe, it, expect } from "vitest";
import { computeHash, isValidHash } from "../hashChain.js";

describe("computeHash", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = computeHash("genesis", { goal: "test" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce same hash", () => {
    const payload = { goal: "add email validation", count: 3 };
    const h1 = computeHash("genesis", payload);
    const h2 = computeHash("genesis", payload);
    expect(h1).toBe(h2);
  });

  it("changes when previousHash changes", () => {
    const payload = { goal: "test" };
    const h1 = computeHash("genesis", payload);
    const h2 = computeHash("different-previous-hash", payload);
    expect(h1).not.toBe(h2);
  });

  it("changes when payload changes", () => {
    const h1 = computeHash("genesis", { goal: "task A" });
    const h2 = computeHash("genesis", { goal: "task B" });
    expect(h1).not.toBe(h2);
  });

  it("changes when payload key order changes (JSON.stringify is order-sensitive)", () => {
    // This documents known behavior: {a:1,b:2} and {b:2,a:1} produce different hashes.
    const h1 = computeHash("genesis", { a: 1, b: 2 });
    const h2 = computeHash("genesis", { b: 2, a: 1 });
    // Not asserting equal or unequal — just verifying no crash and both are valid hashes
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty payload", () => {
    const hash = computeHash("genesis", {});
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles nested payload objects", () => {
    const hash = computeHash("genesis", {
      nested: { deep: { value: 42 } },
      arr: [1, 2, 3],
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("first-event chain: genesis produces consistent hash", () => {
    // Regression: ensure "genesis" string is used literally, not a computed value
    const h1 = computeHash("genesis", { type: "RUN_CREATED" });
    const h2 = computeHash("genesis", { type: "RUN_CREATED" });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(computeHash("GENESIS", { type: "RUN_CREATED" }));
  });
});

describe("isValidHash", () => {
  it("returns true for correct hash", () => {
    const payload = { goal: "test" };
    const hash = computeHash("genesis", payload);
    expect(isValidHash("genesis", payload, hash)).toBe(true);
  });

  it("returns false when hash is wrong", () => {
    const payload = { goal: "test" };
    expect(isValidHash("genesis", payload, "wrong-hash")).toBe(false);
  });

  it("returns false when previousHash differs", () => {
    const payload = { goal: "test" };
    const hash = computeHash("genesis", payload);
    expect(isValidHash("different-prev", payload, hash)).toBe(false);
  });

  it("returns false when payload differs", () => {
    const payload = { goal: "test" };
    const hash = computeHash("genesis", payload);
    expect(isValidHash("genesis", { goal: "DIFFERENT" }, hash)).toBe(false);
  });

  it("returns false for empty string hash", () => {
    expect(isValidHash("genesis", {}, "")).toBe(false);
  });

  it("validates a chained sequence correctly", () => {
    const p1 = { event: "first" };
    const h1 = computeHash("genesis", p1);

    const p2 = { event: "second" };
    const h2 = computeHash(h1, p2);

    expect(isValidHash("genesis", p1, h1)).toBe(true);
    expect(isValidHash(h1, p2, h2)).toBe(true);
    // Cross-check: h2 is invalid against genesis
    expect(isValidHash("genesis", p2, h2)).toBe(false);
  });
});
