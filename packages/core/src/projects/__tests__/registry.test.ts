/**
 * Project registry — the list of repos the dashboard knows about.
 *
 * Every hook process is short-lived and several can run at once in different
 * repos, so these drive the real module against a real file on disk, including
 * a genuinely concurrent write. Nothing is mocked: the failure this guards
 * against (two SessionStarts racing, one silently losing) is invisible to a
 * mocked filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRegistry, registerProject, registryPath } from "../registry.js";

let home: string;
let workspace: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentledger-home-"));
  workspace = mkdtempSync(join(tmpdir(), "agentledger-ws-"));
  process.env["AGENTLEDGER_HOME"] = home;
});

afterEach(() => {
  delete process.env["AGENTLEDGER_HOME"];
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

/**
 * Create a project directory with an .agentledger dir, as a real repo would
 * have. Returns the canonical (realpath) form — the same identity the registry
 * stores — so path assertions compare like with like. On macOS the temp dir
 * itself lives under /var, a symlink to /private/var, so the raw join() path is
 * never what the registry records.
 */
function makeProject(name: string): string {
  const dir = join(workspace, name);
  mkdirSync(join(dir, ".agentledger"), { recursive: true });
  return realpathSync(dir);
}

describe("project registry — registration", () => {
  it("registers a project under its basename", async () => {
    // Arrange
    const dir = makeProject("trust-test-app");

    // Act
    await registerProject(dir);

    // Assert
    const projects = await readRegistry();
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe("trust-test-app");
    expect(projects[0]!.path).toBe(dir);
  });

  it("creates the registry file when absent", async () => {
    // Arrange — nothing exists yet
    const dir = makeProject("alpha");

    // Act
    await registerProject(dir);

    // Assert
    expect(JSON.parse(readFileSync(registryPath(), "utf8")).version).toBe(1);
  });

  it("is idempotent — re-registering does not duplicate", async () => {
    // Arrange
    const dir = makeProject("alpha");

    // Act — every SessionStart in this repo calls this
    await registerProject(dir);
    await registerProject(dir);
    await registerProject(dir);

    // Assert
    expect(await readRegistry()).toHaveLength(1);
  });

  it("advances lastSeen on re-registration but keeps firstSeen", async () => {
    // Arrange
    const dir = makeProject("alpha");
    await registerProject(dir);
    const first = (await readRegistry())[0]!;

    // Act
    await new Promise((r) => setTimeout(r, 5));
    await registerProject(dir);

    // Assert
    const second = (await readRegistry())[0]!;
    expect(second.firstSeen).toBe(first.firstSeen);
    expect(second.lastSeen >= first.lastSeen).toBe(true);
  });

  it("keeps two repos that share a basename as separate entries", async () => {
    // Arrange — the collision case: same name, different paths. They share a
    // project identifier by design (basename keying), but the registry still
    // has to hold both paths or one repo's ledger becomes unreadable.
    const alpha = makeProject("alpha-parent");
    const beta = makeProject("beta-parent");
    const apiA = join(alpha, "api");
    const apiB = join(beta, "api");
    mkdirSync(join(apiA, ".agentledger"), { recursive: true });
    mkdirSync(join(apiB, ".agentledger"), { recursive: true });

    // Act
    await registerProject(apiA);
    await registerProject(apiB);

    // Assert
    const projects = await readRegistry();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name)).toEqual(["api", "api"]);
    expect(new Set(projects.map((p) => p.path)).size).toBe(2);
  });
});

describe("project registry — path canonicalization", () => {
  it("treats a symlinked path and its real path as one project", async () => {
    // Arrange — /tmp is a symlink to /private/tmp on macOS, so the same repo
    // arrives under two spellings depending on how the session was launched.
    // Without realpath this registers twice and the selector shows duplicates
    // that each hold half the sessions.
    const real = makeProject("shortener");
    const link = join(workspace, "shortener-link");
    symlinkSync(real, link);

    // Act
    await registerProject(real);
    await registerProject(link);

    // Assert
    const projects = await readRegistry();
    expect(projects).toHaveLength(1);
    expect(projects[0]!.path).toBe(real);
  });

  it("strips a trailing slash rather than registering a second entry", async () => {
    // Arrange
    const dir = makeProject("alpha");

    // Act
    await registerProject(dir);
    await registerProject(`${dir}/`);

    // Assert
    expect(await readRegistry()).toHaveLength(1);
  });
});

describe("project registry — resilience", () => {
  it("recovers from a corrupt registry instead of throwing", async () => {
    // Arrange — a half-written file. This project has already eaten one
    // corrupted-JSON incident; a hook must never crash a session over it.
    mkdirSync(home, { recursive: true });
    writeFileSync(registryPath(), '{"version":1,"projects":[{"path":');

    // Act
    await registerProject(makeProject("alpha"));

    // Assert — rebuilt, and the new project is in it
    const projects = await readRegistry();
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe("alpha");
  });

  it("drops entries that fail schema validation rather than serving junk", async () => {
    // Arrange
    mkdirSync(home, { recursive: true });
    writeFileSync(
      registryPath(),
      JSON.stringify({
        version: 1,
        projects: [{ path: "/real/alpha", name: "alpha", firstSeen: "x", lastSeen: "x" }, { nonsense: true }],
      }),
    );

    // Act
    const projects = await readRegistry();

    // Assert
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe("alpha");
  });

  it("returns an empty list when no registry exists", async () => {
    // Arrange — fresh home, nothing registered

    // Act / Assert
    expect(await readRegistry()).toEqual([]);
  });
});

describe("project registry — concurrent writers", () => {
  it("loses no project when many sessions register at once", async () => {
    // Arrange — eight repos registering simultaneously. proper-lockfile locks
    // through the filesystem (a lock *directory*), so it serializes writers
    // whether they are separate OS processes or, as here, concurrent calls in
    // one event loop. Both hit the same race: without the lock each caller reads
    // the same empty file and the last writer wins, collapsing eight repos to
    // one. Remove the lock in registry.ts and this test fails.
    const dirs = Array.from({ length: 8 }, (_, i) => makeProject(`proj-${i}`));

    // Act
    await Promise.all(dirs.map((dir) => registerProject(dir)));

    // Assert — all eight survived
    const projects = await readRegistry();
    expect(projects.map((p) => p.name).sort()).toEqual(dirs.map((_, i) => `proj-${i}`).sort());
  });
});
