import { describe, it, expect } from "vitest";
import { scanPatch } from "../patchScanner.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDiff(filePath: string, lines: string[]): string {
  const added = lines.map((l) => `+${l}`).join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    "@@ -1,0 +1,5 @@",
    added,
  ].join("\n");
}

// ─── Empty / trivial ──────────────────────────────────────────────────────────

describe("scanPatch — empty input", () => {
  it("returns [] for empty string", () => {
    expect(scanPatch("")).toHaveLength(0);
  });

  it("returns [] for whitespace-only string", () => {
    expect(scanPatch("   \n  \n")).toHaveLength(0);
  });

  it("returns [] for diff with no added lines", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,0 @@",
      "-const x = 1;",
      "-const y = 2;",
      "-const z = 3;",
    ].join("\n");
    expect(scanPatch(diff)).toHaveLength(0);
  });
});

// ─── Secret detection ─────────────────────────────────────────────────────────

describe("scanPatch — secret detection", () => {
  it("detects api_key assignment", () => {
    const risks = scanPatch(makeDiff("src/config.ts", ['const API_KEY = "my_secret_key_1234567890"']));
    expect(risks.some((r) => r.category === "secret")).toBe(true);
  });

  it("detects OpenAI key pattern (sk-...)", () => {
    const risks = scanPatch(makeDiff("src/ai.ts", ['const key = "sk-abcdefghijklmnopqrstuvwxyz1234"']));
    expect(risks.some((r) => r.category === "secret")).toBe(true);
  });

  it("detects GitHub PAT (ghp_...)", () => {
    const risks = scanPatch(makeDiff(".env", ['GITHUB_TOKEN=ghp_' + "A".repeat(36)]));
    expect(risks.some((r) => r.category === "secret")).toBe(true);
  });

  it("secret risk has severity critical", () => {
    const risks = scanPatch(makeDiff("src/config.ts", ['const password = "super_secret_pass123"']));
    const secret = risks.find((r) => r.category === "secret");
    expect(secret?.severity).toBe("critical");
  });

  it("secret risk captures filePath", () => {
    const risks = scanPatch(makeDiff("src/secrets.ts", ['const API_KEY = "my_secret_key_1234567890"']));
    const secret = risks.find((r) => r.category === "secret");
    expect(secret?.filePath).toBe("src/secrets.ts");
  });

  it("secret risk captures lineNumber", () => {
    const risks = scanPatch(makeDiff("src/secrets.ts", ["const x = 1;", 'const API_KEY = "my_secret_key_1234567890"']));
    const secret = risks.find((r) => r.category === "secret");
    expect(secret?.lineNumber).toBe(2);
  });

  it("lineContext is truncated to 120 chars", () => {
    const longLine = 'const API_KEY = "' + "a".repeat(200) + '"';
    const risks = scanPatch(makeDiff("src/config.ts", [longLine]));
    const secret = risks.find((r) => r.category === "secret");
    expect((secret?.lineContext ?? "").length).toBeLessThanOrEqual(120);
  });
});

// ─── Schema mutation detection ────────────────────────────────────────────────

describe("scanPatch — schema mutation detection", () => {
  it("detects ALTER TABLE", () => {
    const risks = scanPatch(makeDiff("migrations/001.sql", ["ALTER TABLE users ADD COLUMN email TEXT;"]));
    expect(risks.some((r) => r.category === "schema_mutation")).toBe(true);
  });

  it("detects DROP TABLE", () => {
    const risks = scanPatch(makeDiff("db/schema.sql", ["DROP TABLE sessions;"]));
    expect(risks.some((r) => r.category === "schema_mutation")).toBe(true);
  });

  it("detects CREATE TABLE", () => {
    const risks = scanPatch(makeDiff("db/migrations/002.sql", ["CREATE TABLE accounts (id UUID PRIMARY KEY);"]));
    expect(risks.some((r) => r.category === "schema_mutation")).toBe(true);
  });

  it("schema mutation risk has severity high", () => {
    const risks = scanPatch(makeDiff("db.sql", ["ALTER TABLE users DROP COLUMN old_field;"]));
    const schema = risks.find((r) => r.category === "schema_mutation");
    expect(schema?.severity).toBe("high");
  });
});

// ─── Auth code detection ──────────────────────────────────────────────────────

describe("scanPatch — auth code detection", () => {
  it("detects jwt.sign", () => {
    const risks = scanPatch(makeDiff("src/auth.ts", ["const token = jwt.sign(payload, secret);"]));
    expect(risks.some((r) => r.category === "auth_code")).toBe(true);
  });

  it("detects bcrypt.hash", () => {
    const risks = scanPatch(makeDiff("src/user.ts", ["const hashed = await bcrypt.hash(password, 10);"]));
    expect(risks.some((r) => r.category === "auth_code")).toBe(true);
  });

  it("detects role check", () => {
    const risks = scanPatch(makeDiff("src/middleware.ts", ['if (user.role === "admin") {']));
    expect(risks.some((r) => r.category === "auth_code")).toBe(true);
  });

  it("auth code risk has severity medium", () => {
    const risks = scanPatch(makeDiff("src/auth.ts", ["const token = jwt.verify(raw, secret);"]));
    const auth = risks.find((r) => r.category === "auth_code");
    expect(auth?.severity).toBe("medium");
  });
});

// ─── Dependency change detection ──────────────────────────────────────────────

describe("scanPatch — dependency change detection", () => {
  it("detects new external import", () => {
    const risks = scanPatch(makeDiff("src/server.ts", ['import express from "express";']));
    expect(risks.some((r) => r.category === "dependency_change")).toBe(true);
  });

  it("dependency change risk has severity medium", () => {
    const risks = scanPatch(makeDiff("src/server.ts", ['import axios from "axios";']));
    const dep = risks.find((r) => r.category === "dependency_change");
    expect(dep?.severity).toBe("medium");
  });
});

// ─── Multiple files ───────────────────────────────────────────────────────────

describe("scanPatch — multiple files in diff", () => {
  it("tracks correct filePath for each file", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,0 +1,1 @@",
      '+const API_KEY = "secret_key_1234567890_abcde";',
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,0 +1,1 @@",
      "+ALTER TABLE users ADD COLUMN x TEXT;",
    ].join("\n");

    const risks = scanPatch(diff);
    const secretRisk = risks.find((r) => r.category === "secret");
    const schemaRisk = risks.find((r) => r.category === "schema_mutation");
    expect(secretRisk?.filePath).toBe("src/a.ts");
    expect(schemaRisk?.filePath).toBe("src/b.ts");
  });
});

// ─── No false positives ───────────────────────────────────────────────────────

describe("scanPatch — clean diff", () => {
  it("returns [] for typical TypeScript utility code", () => {
    const risks = scanPatch(
      makeDiff("src/utils.ts", [
        "export function add(a: number, b: number): number {",
        "  return a + b;",
        "}",
      ]),
    );
    expect(risks).toHaveLength(0);
  });
});
