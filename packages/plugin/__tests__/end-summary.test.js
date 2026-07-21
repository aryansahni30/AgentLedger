import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  writeLastSummary,
  readAndClearLastSummary,
  renderCheckpointBox,
} from "../scripts/end-summary.js";

describe("end-summary — persist and replay Session End box", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentledger-endbox-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("writeLastSummary persists text under .agentledger/", () => {
    // Arrange
    const box = "╔══╗\n Session End \n╚══╝";

    // Act
    writeLastSummary(projectDir, box);

    // Assert
    const p = path.join(projectDir, ".agentledger", "last-session-summary.txt");
    expect(fs.readFileSync(p, "utf8")).toBe(box);
  });

  test("readAndClearLastSummary returns the box then deletes it (renders once)", () => {
    // Arrange
    const box = "the end box";
    writeLastSummary(projectDir, box);

    // Act
    const first = readAndClearLastSummary(projectDir);
    const second = readAndClearLastSummary(projectDir);

    // Assert
    expect(first).toBe(box);
    expect(second).toBeNull();
  });

  test("readAndClearLastSummary returns null when no summary exists", () => {
    expect(readAndClearLastSummary(projectDir)).toBeNull();
  });

  test("writeLastSummary creates .agentledger/ if absent (never throws)", () => {
    // Arrange: projectDir has no .agentledger yet
    expect(() => writeLastSummary(projectDir, "x")).not.toThrow();
    expect(readAndClearLastSummary(projectDir)).toBe("x");
  });
});

describe("end-summary — live compaction checkpoint", () => {
  test("renderCheckpointBox includes claims, activity and trust", () => {
    // Arrange
    const state = {
      claimsVerifiedTrue: 5,
      claimsVerifiedFalse: 0,
      claimsUnverifiable: 1,
      reads: 9,
      edits: 3,
      writes: 1,
      blocks: 2,
    };
    const stats = { totalClaims: 6, trustScore: 0.75 };

    // Act
    const box = renderCheckpointBox(state, stats);

    // Assert
    expect(box).toContain("Session Checkpoint");
    expect(box).toContain("6 made · 5 verified · 0 false");
    expect(box).toContain("9 reads · 4 edits · 2 blocks");
    expect(box).toContain("Trust      : 75%");
    expect(box).toContain("session continues");
  });

  test("renderCheckpointBox omits claims line when no claims made", () => {
    // Arrange
    const box = renderCheckpointBox({ reads: 2, edits: 0 }, {});

    // Assert
    expect(box).not.toContain("Claims");
    expect(box).toContain("2 reads · 0 edits · 0 blocks");
  });

  test("renderCheckpointBox tolerates empty state and stats", () => {
    expect(() => renderCheckpointBox({}, {})).not.toThrow();
  });
});
