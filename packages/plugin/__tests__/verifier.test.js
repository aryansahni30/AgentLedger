import { describe, it, expect } from "vitest";
import { detectBoundaryViolations } from "../scripts/verifier.js";

describe("verifier.js — detectBoundaryViolations", () => {
  it("detects .env file as violation", () => {
    const violations = detectBoundaryViolations(
      [".env", "src/app.ts"],
      ["**/.env"]
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(".env");
  });

  it("detects nested secret files", () => {
    const violations = detectBoundaryViolations(
      ["config/secrets.json", "src/app.ts"],
      ["**/secrets.*"]
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("config/secrets.json");
  });

  it("returns empty when no violations", () => {
    const violations = detectBoundaryViolations(
      ["src/app.ts", "src/utils.ts"],
      ["**/.env", "**/secrets.*"]
    );
    expect(violations).toHaveLength(0);
  });

  it("matches multiple violations", () => {
    const violations = detectBoundaryViolations(
      [".env", "secrets.yaml", "src/app.ts"],
      ["**/.env", "**/secrets.*"]
    );
    expect(violations).toHaveLength(2);
  });

  it("handles key file patterns", () => {
    const violations = detectBoundaryViolations(
      ["certs/server.pem", "certs/server.key"],
      ["**/*.pem", "**/*.key"]
    );
    expect(violations).toHaveLength(2);
  });
});
