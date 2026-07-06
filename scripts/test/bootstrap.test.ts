// scripts/test/bootstrap.test.ts
//
// End-to-end check that scripts/bootstrap.sh is idempotent: invoking it
// against a tmpdir twice must both exit 0 and the second invocation must
// not modify any files.
//
// How it works:
//   1. Copy the Fil repo (sans node_modules / dist) into a tmpdir so the
//      bootstrap script has a real package.json + scripts/ to operate on.
//   2. Set FIL_BOOTSTRAP_SKIP_INSTALL=1 — proves the cache-fresh short-
//      circuit independently of any real `pnpm install` happening in the
//      tmpdir (the test runs in CI before deps are present in the
//      worktree; relying on a real install would be slow and fragile).
//   3. Record file mtimes via `find -printf %T@ %p\\n` before invocation 1.
//   4. Run scripts/bootstrap.sh twice.
//   5. Record mtimes again; assert the sets match (no file was touched).
//
// The script's prerequisite checks (node ≥ 20, pnpm ≥ 10, gh, wt) are
// expected to pass in any environment that can run `pnpm test` at all —
// if they don't, the failure surfaces as a non-zero exit in step 4.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = join(__dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "bootstrap.sh");

interface MtimeSnapshot { [path: string]: number; }

function snapshotMtimes(root: string): MtimeSnapshot {
  const out: MtimeSnapshot = {};
  // `find -printf '%T@\t%p\n'` gives us fractional epoch seconds + path,
  // tab-separated so paths containing spaces survive intact.
  const lines = execFileSync(
    "find",
    [".", "-type", "f", "-not", "-path", "./.git/*", "-printf", "%T@\t%p\n"],
    { cwd: root, encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const line of lines) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const ts = line.slice(0, tab);
    const path = line.slice(tab + 1);
    out[path] = Number(ts);
  }
  return out;
}

function snapshotChanged(a: MtimeSnapshot, b: MtimeSnapshot): string[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) changed.push(k);
  }
  return changed.sort();
}

function copyRepoInto(dst: string): void {
  // Walk every non-ignored file and copy with mtime preservation so the
  // "cache fresh" check inside bootstrap.sh behaves realistically.
  // Skip node_modules and packages/*/dist (they don't exist in a fresh
  // clone, but defend against partial leftovers).
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
  const SKIP_PREFIXES = ["packages/", "wt/"]; // sibling worktrees
  function walk(src: string): void {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const sp = join(src, entry.name);
      const rel = relative(REPO_ROOT, sp);
      if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
      const dp = join(dst, rel);
      if (entry.isDirectory()) {
        mkdirSync(dp, { recursive: true });
        walk(sp);
      } else if (entry.isFile()) {
        mkdirSync(dirname(dp), { recursive: true });
        copyFileSync(sp, dp);
      }
    }
  }
  mkdirSync(dst, { recursive: true });
  walk(REPO_ROOT);
}

describe("scripts/bootstrap.sh idempotency", () => {
  let workdir: string;
  let before: MtimeSnapshot;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), "fil-bootstrap-"));
    copyRepoInto(workdir);
    // We don't have a way to populate node_modules here without a real
    // pnpm install, so the FIL_BOOTSTRAP_SKIP_INSTALL override is what
    // makes this test self-contained — it makes bootstrap.sh treat the
    // cache as fresh without actually requiring one.
    // First, take the snapshot of file mtimes BEFORE the first run.
    before = snapshotMtimes(workdir);
  }, 60_000);

  it("runs the script twice with FIL_BOOTSTRAP_SKIP_INSTALL=1", () => {
    if (!existsSync(SCRIPT)) {
      throw new Error(`bootstrap script missing at ${SCRIPT}`);
    }
    const env = {
      ...process.env,
      FIL_BOOTSTRAP_SKIP_INSTALL: "1",
      PATH: process.env.PATH ?? "",
    };

    // Invocation 1 — should exit 0 and skip install (cache-fresh path).
    execFileSync("bash", [SCRIPT], { cwd: workdir, env, stdio: "pipe" });
    // Invocation 2 — should also exit 0 and again skip install.
    execFileSync("bash", [SCRIPT], { cwd: workdir, env, stdio: "pipe" });

    // Snapshot after the two runs and assert nothing changed.
    const after = snapshotMtimes(workdir);
    const changed = snapshotChanged(before, after);
    expect(changed, `files modified by bootstrap.sh: ${changed.join(", ")}`).toEqual([]);
  }, 30_000);

  it("is executable (chmod +x) so it can be invoked directly", () => {
    const s = statSync(SCRIPT);
    // Owner-execute bit must be set.
    expect(s.mode & 0o100).toBeGreaterThan(0);
  });
});