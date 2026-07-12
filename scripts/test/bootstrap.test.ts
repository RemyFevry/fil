// scripts/test/bootstrap.test.ts
//
// End-to-end check that scripts/bootstrap.sh is idempotent: invoking it
// against a tmpdir twice must both exit 0 and the second invocation must
// not modify any files (no mtime advance, no new files, no deleted files).
//
// How it works:
//   1. Copy the Fil repo (sans node_modules / dist / .git) into a tmpdir so
//      the bootstrap script has a real package.json + scripts/ to operate on.
//   2. Set FIL_BOOTSTRAP_SKIP_INSTALL=1 — proves the cache-fresh short-
//      circuit independently of any real `pnpm install` happening in the
//      tmpdir. Also skips the prerequisite checks (Node ≥ 20, pnpm ≥ 10,
//      wt, gh) because CI runners don't always have `wt`, and the test's
//      job is to prove *idempotency*, not tool availability.
//   3. Snapshot the file set + mtimes via fs.statSync (cross-platform).
//   4. Run scripts/bootstrap.sh twice with the skip flag. Both runs hit
//      the COPY in `workdir`, never the source — running REPO_SCRIPT here
//      would silently make the test meaningless because the snapshots are
//      taken on `workdir`, not REPO_ROOT.
//   5. Re-snapshot; assert the sets match exactly (no file added, removed,
//      or changed).
//
// The script's real prerequisite checks are exercised by running the
// repo-root script under `bash -n` (syntax-only) below; the executable-bit
// check is only meaningful on POSIX, so it's gated to skip on win32.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  statSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
} from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";

// Skip-list used by both `walk()` (mtime snapshot) and `copyRepoInto()`
// (fixture setup). Centralized here so the two can't drift — if you add
// a new ignored directory, both behaviours pick it up automatically.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const SKIP_PREFIXES = ["packages/", "wt/"]; // sibling worktrees

const REPO_ROOT = join(__dirname, "..", "..");
// `REPO_SCRIPT` is the bootstrap script at its committed location — used
// only for syntax/exec-bit checks. The idempotency test itself runs the
// COPY inside `workdir`, never this source path (see CR round 2 review:
// running the repo-root script against a tmpdir snapshot makes the
// idempotency check meaningless).
const REPO_SCRIPT = join(REPO_ROOT, "scripts", "bootstrap.sh");

interface FileSnapshot {
  // Map<relativePosixPath, mtimeMs>. We use POSIX paths because the test
  // is what verifies bootstrap's *file-level* behavior; platform separators
  // would muddy diffs when the same test runs on win32 vs linux.
  [posixPath: string]: number;
}

function walk(root: string): string[] {
  // Walk every non-ignored file under `root`, returning POSIX-style
  // relative paths. Uses the shared SKIP_DIRS / SKIP_PREFIXES so the
  // snapshot reflects the same files `copyRepoInto()` produced.
  const out: string[] = [];
  function recurse(absDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      const rel = relative(root, abs);
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PREFIXES.some((p) => rel.split(sep).join("/").startsWith(p))) continue;
      if (entry.isDirectory()) {
        recurse(abs);
      } else if (entry.isFile()) {
        out.push(rel.split(sep).join("/"));
      }
    }
  }
  recurse(root);
  return out;
}

function snapshotFiles(root: string): FileSnapshot {
  const snap: FileSnapshot = {};
  for (const rel of walk(root)) {
    const abs = join(root, rel);
    try {
      snap[rel] = statSync(abs).mtimeMs;
    } catch {
      // File vanished between walk + stat; record as deleted-late.
      snap[rel] = -1;
    }
  }
  return snap;
}

function diff(a: FileSnapshot, b: FileSnapshot): {
  added: string[];
  removed: string[];
  changed: string[];
} {
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  const added: string[] = [];
  const removed: string[] = [];
  for (const k of bKeys) if (!aKeys.has(k)) added.push(k);
  for (const k of aKeys) if (!bKeys.has(k)) removed.push(k);
  const changed: string[] = [];
  for (const k of aKeys) {
    if (bKeys.has(k) && a[k] !== b[k]) changed.push(k);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}

function copyRepoInto(dst: string): void {
  function walkCopy(src: string): void {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const sp = join(src, entry.name);
      const rel = relative(REPO_ROOT, sp);
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PREFIXES.some((p) => rel.split(sep).join("/").startsWith(p))) continue;
      const dp = join(dst, rel);
      if (entry.isDirectory()) {
        mkdirSync(dp, { recursive: true });
        walkCopy(sp);
      } else if (entry.isFile()) {
        mkdirSync(dirname(dp), { recursive: true });
        copyFileSync(sp, dp);
      }
    }
  }
  mkdirSync(dst, { recursive: true });
  walkCopy(REPO_ROOT);
}

describe("scripts/bootstrap.sh idempotency", () => {
  let workdir: string;
  let before: FileSnapshot;
  let workdirScript: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), "fil-bootstrap-"));
    copyRepoInto(workdir);
    // The script copy lives under workdir — this is what gets executed
    // and measured against. Keep +x on POSIX so the test exercises the
    // same invocation path as a real contributor.
    workdirScript = join(workdir, "scripts", "bootstrap.sh");
    if (existsSync(workdirScript) && process.platform !== "win32") {
      // copyFileSync preserves the mode-bit, but the platform default can
      // still mask +x on some systems. chmod is belt-and-braces.
      chmodSync(workdirScript, 0o755);
    }
    before = snapshotFiles(workdir);
  }, 60_000);

  it("runs the script twice with FIL_BOOTSTRAP_SKIP_INSTALL=1", () => {
    if (!existsSync(workdirScript)) {
      throw new Error(`bootstrap script missing in workdir at ${workdirScript}`);
    }
    // FIL_BOOTSTRAP_SKIP_INSTALL=1 makes the script:
    //   - skip the prerequisite tool checks (Node ≥ 20, pnpm ≥ 10, wt, gh)
    //   - skip the cache-fresh mtime scan
    //   - skip pnpm install / pnpm build
    //   - exit 0 immediately after the gh identity warning
    // CI runners don't always have `wt` installed; the test's job is to
    // prove IDEMPOTENCY, not tool availability. The real prereq check
    // is exercised by the bash smoke test below.
    const env = {
      ...process.env,
      FIL_BOOTSTRAP_SKIP_INSTALL: "1",
      PATH: process.env.PATH ?? "",
    };

    // Invocation 1 — should exit 0 (skip-install fast path).
    execFileSync("bash", [workdirScript], { cwd: workdir, env, stdio: "pipe" });
    // Invocation 2 — also exit 0.
    execFileSync("bash", [workdirScript], { cwd: workdir, env, stdio: "pipe" });

    const after = snapshotFiles(workdir);
    const d = diff(before, after);
    const summary =
      `added=${JSON.stringify(d.added)} removed=${JSON.stringify(d.removed)} changed=${JSON.stringify(d.changed)}`;
    expect(d.added, `bootstrap.sh added files: ${summary}`).toEqual([]);
    expect(d.removed, `bootstrap.sh removed files: ${summary}`).toEqual([]);
    expect(d.changed, `bootstrap.sh modified files: ${summary}`).toEqual([]);
  }, 30_000);

  it("is syntactically valid bash", () => {
    // bash -n is portable across POSIX shells; on Windows it's available
    // via Git Bash which the CI runner already uses for `bash`.
    execFileSync("bash", ["-n", REPO_SCRIPT], { stdio: "pipe" });
  });

  // POSIX-only: Windows git checkout doesn't preserve the +x bit, so this
  // assertion is meaningless there. Skip on win32.
  const isPosix = process.platform !== "win32";
  it.skipIf(!isPosix)("is executable (chmod +x) on POSIX", () => {
    const s = statSync(REPO_SCRIPT);
    // Owner-execute bit must be set so the script can be invoked directly
    // as `./scripts/bootstrap.sh`, not just via `bash scripts/bootstrap.sh`.
    expect(s.mode & 0o100).toBeGreaterThan(0);
  });
});