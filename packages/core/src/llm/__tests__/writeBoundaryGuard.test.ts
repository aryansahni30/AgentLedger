import { describe, it, expect } from "vitest";
import { checkWritePermission } from "../writeBoundaryGuard.js";

describe("checkWritePermission", () => {
  // ─── Blocked file matches ────────────────────────────────────────────────────

  it("denies exact match in blockedFiles", () => {
    const result = checkWritePermission(".env", ["src/**"], [".env"]);
    expect(result.denied).toBe(true);
    if (result.denied) {
      expect(result.violationType).toBe("BLOCKED_FILE");
      expect(result.reason).toContain(".env");
    }
  });

  it("denies glob match in blockedFiles", () => {
    const result = checkWritePermission("secrets/prod.key", ["src/**"], ["secrets/**"]);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.violationType).toBe("BLOCKED_FILE");
  });

  it("blocked takes priority over allowed — even if file matches both", () => {
    // File matches both allowedFiles and blockedFiles — blocked wins
    const result = checkWritePermission("src/config.ts", ["src/**"], ["src/config.ts"]);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.violationType).toBe("BLOCKED_FILE");
  });

  it("denial reason string contains BLOCKED prefix", () => {
    const result = checkWritePermission(".env", ["**"], [".env"]);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.reason).toMatch(/^BLOCKED:/);
  });

  // ─── Dot file glob matching ──────────────────────────────────────────────────

  it("matches dot files with glob pattern using minimatch dot:true", () => {
    // "**" should match ".env" when dot:true is set
    const blockedResult = checkWritePermission(".env", ["**"], ["**/.env"]);
    expect(blockedResult.denied).toBe(true);
  });

  it("allows dot file when in allowedFiles and not blocked", () => {
    const result = checkWritePermission(".eslintrc.json", [".eslintrc.json"], [".env"]);
    expect(result.denied).toBe(false);
  });

  // ─── Allowed file matches ────────────────────────────────────────────────────

  it("allows exact match in allowedFiles", () => {
    const result = checkWritePermission("src/index.ts", ["src/index.ts"], []);
    expect(result.denied).toBe(false);
  });

  it("allows glob match in allowedFiles", () => {
    const result = checkWritePermission("src/utils/helpers.ts", ["src/**"], []);
    expect(result.denied).toBe(false);
  });

  it("allows nested path matching allowedFiles glob", () => {
    const result = checkWritePermission("src/components/ui/button.tsx", ["src/**/*.tsx"], []);
    expect(result.denied).toBe(false);
  });

  // ─── Unowned file (not in allowedFiles) ─────────────────────────────────────

  it("denies file not matching any allowedFiles pattern", () => {
    const result = checkWritePermission("package.json", ["src/**"], []);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.violationType).toBe("UNOWNED_FILE");
  });

  it("denial reason string contains UNOWNED prefix for unowned files", () => {
    const result = checkWritePermission("README.md", ["src/**"], []);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.reason).toMatch(/^UNOWNED:/);
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────────

  it("denies all writes when allowedFiles is empty", () => {
    const result = checkWritePermission("src/index.ts", [], []);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.violationType).toBe("UNOWNED_FILE");
  });

  it("allows matching file when blockedFiles is empty", () => {
    const result = checkWritePermission("src/index.ts", ["src/**"], []);
    expect(result.denied).toBe(false);
  });

  it("denies file that matches blocked glob even when allowedFiles is broad", () => {
    const result = checkWritePermission("migrations/001_init.sql", ["**"], ["migrations/**"]);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.violationType).toBe("BLOCKED_FILE");
  });

  it("allows file when multiple allowedFiles patterns — one matches", () => {
    const result = checkWritePermission("tests/unit/foo.test.ts", ["src/**", "tests/**"], []);
    expect(result.denied).toBe(false);
  });
});
