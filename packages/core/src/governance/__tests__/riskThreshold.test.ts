import { describe, it, expect } from "vitest";
import { checkRiskThreshold } from "../riskThreshold.js";
import type { GovernancePolicy } from "../../schemas/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function policy(overrides: Partial<GovernancePolicy> = {}): GovernancePolicy {
  return { rules: [], ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("checkRiskThreshold", () => {
  describe("no threshold configured", () => {
    it("returns null when riskThreshold is undefined", () => {
      expect(checkRiskThreshold(80, policy())).toBeNull();
    });

    it("returns null even with high score when threshold absent", () => {
      expect(checkRiskThreshold(100, policy({ rules: [] }))).toBeNull();
    });
  });

  describe("score below threshold", () => {
    it("returns breached=false when score < threshold", () => {
      const result = checkRiskThreshold(40, policy({ riskThreshold: 50 }));
      expect(result).not.toBeNull();
      expect(result!.breached).toBe(false);
    });

    it("returns correct threshold and actual score", () => {
      const result = checkRiskThreshold(30, policy({ riskThreshold: 60 }));
      expect(result!.threshold).toBe(60);
      expect(result!.actualScore).toBe(30);
    });
  });

  describe("score at threshold (not a breach)", () => {
    it("returns breached=false when score === threshold (equal is not a breach)", () => {
      const result = checkRiskThreshold(50, policy({ riskThreshold: 50 }));
      expect(result!.breached).toBe(false);
    });

    it("returns breached=false at threshold=0 and score=0", () => {
      const result = checkRiskThreshold(0, policy({ riskThreshold: 0 }));
      expect(result!.breached).toBe(false);
    });
  });

  describe("score above threshold (breach)", () => {
    it("returns breached=true when score > threshold", () => {
      const result = checkRiskThreshold(51, policy({ riskThreshold: 50 }));
      expect(result!.breached).toBe(true);
    });

    it("returns breached=true when score=1 and threshold=0", () => {
      const result = checkRiskThreshold(1, policy({ riskThreshold: 0 }));
      expect(result!.breached).toBe(true);
    });

    it("returns correct threshold and actual score on breach", () => {
      const result = checkRiskThreshold(75, policy({ riskThreshold: 60 }));
      expect(result!.threshold).toBe(60);
      expect(result!.actualScore).toBe(75);
    });
  });

  describe("threshold action", () => {
    it("defaults to 'warn' when thresholdAction is undefined", () => {
      const result = checkRiskThreshold(80, policy({ riskThreshold: 70 }));
      expect(result!.action).toBe("warn");
    });

    it("returns 'warn' action when configured", () => {
      const result = checkRiskThreshold(80, policy({ riskThreshold: 70, thresholdAction: "warn" }));
      expect(result!.action).toBe("warn");
    });

    it("returns 'pause' action when configured", () => {
      const result = checkRiskThreshold(80, policy({ riskThreshold: 70, thresholdAction: "pause" }));
      expect(result!.action).toBe("pause");
    });

    it("returns 'abort' action when configured", () => {
      const result = checkRiskThreshold(80, policy({ riskThreshold: 70, thresholdAction: "abort" }));
      expect(result!.action).toBe("abort");
    });

    it("includes action even when not breached", () => {
      const result = checkRiskThreshold(30, policy({ riskThreshold: 70, thresholdAction: "abort" }));
      expect(result!.breached).toBe(false);
      expect(result!.action).toBe("abort");
    });
  });

  describe("boundary values", () => {
    it("score 99 with threshold 100 → no breach", () => {
      const result = checkRiskThreshold(99, policy({ riskThreshold: 100 }));
      expect(result!.breached).toBe(false);
    });

    it("score 100 with threshold 100 → no breach (equal)", () => {
      const result = checkRiskThreshold(100, policy({ riskThreshold: 100 }));
      expect(result!.breached).toBe(false);
    });

    it("score 0 with threshold 1 → no breach", () => {
      const result = checkRiskThreshold(0, policy({ riskThreshold: 1 }));
      expect(result!.breached).toBe(false);
    });
  });

  describe("policy with rules (threshold orthogonal to rules)", () => {
    it("works correctly when policy also has rules", () => {
      const p: GovernancePolicy = {
        rules: [{ type: "deny_if", categories: ["secret"], minSeverity: "critical" }],
        riskThreshold: 50,
        thresholdAction: "pause",
      };
      const result = checkRiskThreshold(60, p);
      expect(result!.breached).toBe(true);
      expect(result!.action).toBe("pause");
    });
  });
});
