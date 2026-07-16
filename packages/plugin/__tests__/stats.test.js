import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readStats, writeStats, mergeSessionStats } from "../scripts/stats.js";

describe("stats.js", () => {
  let tmpDir;
  let originalEnv;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentledger-stats-test-"));
    await mkdir(join(tmpDir, ".agentledger"), { recursive: true });
    originalEnv = process.env["CLAUDE_PROJECT_DIR"];
    process.env["CLAUDE_PROJECT_DIR"] = tmpDir;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env["CLAUDE_PROJECT_DIR"] = originalEnv;
    } else {
      delete process.env["CLAUDE_PROJECT_DIR"];
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("readStats", () => {
    it("returns defaults when stats.json missing", async () => {
      const stats = await readStats();
      expect(stats.version).toBe(1);
      expect(stats.totalClaims).toBe(0);
      expect(stats.trustScore).toBe(0);
      expect(stats.recentFalseClaims).toEqual([]);
    });

    it("reads existing stats.json", async () => {
      const existing = {
        version: 1,
        totalClaims: 10,
        verifiedTrue: 8,
        verifiedFalse: 2,
        unverifiable: 0,
        trustScore: 0.8,
        totalBlocks: 1,
        totalWarnings: 0,
        sessionsTracked: 3,
        filesReadTotal: 50,
        filesEditedTotal: 20,
        readEditRatio: 2.5,
        recentFalseClaims: [],
        lastUpdated: "2026-07-15T00:00:00Z",
      };
      await writeFile(join(tmpDir, ".agentledger", "stats.json"), JSON.stringify(existing));
      const stats = await readStats();
      expect(stats.totalClaims).toBe(10);
      expect(stats.trustScore).toBe(0.8);
    });

    it("returns defaults on corrupt JSON", async () => {
      await writeFile(join(tmpDir, ".agentledger", "stats.json"), "not json{{{");
      const stats = await readStats();
      expect(stats.version).toBe(1);
      expect(stats.totalClaims).toBe(0);
    });
  });

  describe("writeStats", () => {
    it("writes valid JSON to stats.json", async () => {
      const stats = {
        version: 1, totalClaims: 5, verifiedTrue: 4, verifiedFalse: 1,
        unverifiable: 0, trustScore: 0.8, totalBlocks: 0, totalWarnings: 0,
        sessionsTracked: 1, filesReadTotal: 10, filesEditedTotal: 3,
        readEditRatio: 3.33, recentFalseClaims: [], lastUpdated: "2026-07-15T00:00:00Z",
      };
      await writeStats(stats);
      const raw = await readFile(join(tmpDir, ".agentledger", "stats.json"), "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.totalClaims).toBe(5);
      expect(parsed.trustScore).toBe(0.8);
    });
  });

  describe("mergeSessionStats", () => {
    it("increments counters from session data", async () => {
      const result = await mergeSessionStats({
        claimsVerifiedTrue: 3,
        claimsVerifiedFalse: 1,
        claimsUnverifiable: 0,
        blocks: 2,
        warnings: 1,
        filesRead: 10,
        filesEdited: 4,
        falseClaims: [{ claim: "tests pass", actual: "exit 1", timestamp: "2026-07-15T00:00:00Z" }],
      });

      expect(result.totalClaims).toBe(4);
      expect(result.verifiedTrue).toBe(3);
      expect(result.verifiedFalse).toBe(1);
      expect(result.trustScore).toBe(0.75);
      expect(result.totalBlocks).toBe(2);
      expect(result.totalWarnings).toBe(1);
      expect(result.sessionsTracked).toBe(1);
      expect(result.filesReadTotal).toBe(10);
      expect(result.filesEditedTotal).toBe(4);
      expect(result.readEditRatio).toBe(2.5);
      expect(result.recentFalseClaims).toHaveLength(1);
    });

    it("accumulates across multiple sessions", async () => {
      await mergeSessionStats({
        claimsVerifiedTrue: 5, claimsVerifiedFalse: 0, claimsUnverifiable: 0,
        blocks: 0, warnings: 0, filesRead: 20, filesEdited: 8, falseClaims: [],
      });

      const result = await mergeSessionStats({
        claimsVerifiedTrue: 3, claimsVerifiedFalse: 2, claimsUnverifiable: 1,
        blocks: 1, warnings: 2, filesRead: 10, filesEdited: 5, falseClaims: [],
      });

      expect(result.totalClaims).toBe(11); // 5+0 + 3+2+1
      expect(result.verifiedTrue).toBe(8);
      expect(result.verifiedFalse).toBe(2);
      expect(result.trustScore).toBe(0.8);
      expect(result.sessionsTracked).toBe(2);
      expect(result.filesReadTotal).toBe(30);
      expect(result.filesEditedTotal).toBe(13);
    });

    it("computes trust score excluding unverifiable claims", async () => {
      const result = await mergeSessionStats({
        claimsVerifiedTrue: 4, claimsVerifiedFalse: 1, claimsUnverifiable: 5,
        blocks: 0, warnings: 0, filesRead: 0, filesEdited: 0, falseClaims: [],
      });

      // Trust score = 4 / (4+1) = 0.8, not 4/10
      expect(result.trustScore).toBe(0.8);
      expect(result.totalClaims).toBe(10);
    });

    it("caps recentFalseClaims at 10", async () => {
      const falseClaims = Array.from({ length: 12 }, (_, i) => ({
        claim: `claim-${i}`, actual: "fail", timestamp: new Date().toISOString(),
      }));

      const result = await mergeSessionStats({
        claimsVerifiedTrue: 0, claimsVerifiedFalse: 12, claimsUnverifiable: 0,
        blocks: 0, warnings: 0, filesRead: 0, filesEdited: 0, falseClaims,
      });

      expect(result.recentFalseClaims).toHaveLength(10);
      // Should keep the last 10 (most recent)
      expect(result.recentFalseClaims[0].claim).toBe("claim-2");
    });

    it("returns trust score 0 when no verifiable claims", async () => {
      const result = await mergeSessionStats({
        claimsVerifiedTrue: 0, claimsVerifiedFalse: 0, claimsUnverifiable: 3,
        blocks: 0, warnings: 0, filesRead: 5, filesEdited: 0, falseClaims: [],
      });

      expect(result.trustScore).toBe(0);
    });
  });
});
