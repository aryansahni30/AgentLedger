import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import { detectBoundaryViolations, runTestCommand } from "../scripts/verifier.js";

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

describe("verifier.js — runTestCommand", () => {
  it("reports exit 0 for a passing command", () => {
    const result = runTestCommand("exit 0", tmpdir());
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("reports a non-zero exit for a failing command", () => {
    const result = runTestCommand("exit 3", tmpdir());
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it("flags a command killed by timeout as timedOut, not a plain failure", () => {
    // A 5s sleep against a 200ms budget is killed by SIGTERM; execSync leaves
    // err.status null, which must surface as timedOut rather than a generic exit 1.
    const result = runTestCommand("sleep 5", tmpdir(), 200);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  it("skips cleanly when no test command is configured", () => {
    const result = runTestCommand("", tmpdir());
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});
