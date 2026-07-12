// scripts/test/worktree-guard.test.ts
//
// Exercises the canonical worktree guard (scripts/require-worktree.sh) and the
// master launcher (scripts/master.sh) — the pieces that issue #101 changed.
//
// What's under test:
//   1. The two trunk hatches behave as documented:
//        FIL_ALLOW_MAIN_WORKTREE=1 — human escape hatch (also set by
//                                    `pnpm master`).
//        FIL_MASTER_SESSION=1      — auto-detected master hatch (injected by
//                                    the OpenCode plugin when the active agent
//                                    is the master).
//      In the primary checkout, either hatch lets bash through; neither hatch
//      lets a *non-master* through (the vars are simply absent for subagents,
//      which are different sessions in their own worktrees).
//   2. The linked-worktree fast path still allows everything regardless of
//      hatches, and the "not a git repo" fallback still allows.
//   3. The `wt <verb>` bootstrap whitelist still matches, and a non-whitelisted
//      command (`wt merge main`) still falls through to the worktree check.
//   4. scripts/master.sh exports FIL_ALLOW_MAIN_WORKTREE=1 and resolves the
//      runtime argument (default opencode), proven via its dry-run mode so the
//      test never launches an interactive runtime.
//
// The script's decision logic is the single source of truth, so this test
// covers the "master gets the hatch automatically; non-master does not"
// acceptance criterion at exactly the layer that owns the decision.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Pure env-scrub helper extracted from the OpenCode plugin, so the decision
// "non-master sessions can never satisfy either trunk hatch" can be unit-
// tested in isolation. The plugin file isn't part of the build (it lives under
// .opencode/, excluded from tsconfig + eslint), but importing the exported
// pure function here is safe — it touches no `import.meta` / opencode runtime.
import { buildGuardEnv } from "../../.opencode/plugins/worktree-guard";

const REPO_ROOT = join(__dirname, "..", "..");
const GATE = join(REPO_ROOT, "scripts", "require-worktree.sh");
const MASTER = join(REPO_ROOT, "scripts", "master.sh");

/** Result of invoking the gate script. */
interface GateResult {
  code: number;
  stderr: string;
}

/**
 * Run the canonical gate in `cwd` with optional extra env and a bash command
 * (passed as $1 so the bootstrap whitelist can match). Returns the exit code
 * and stderr instead of throwing on the expected exit-2 block.
 */
function runGate(opts: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  command?: string;
}): GateResult {
  // Hermetic: scrub any ambient trunk hatch from process.env BEFORE layering
  // opts.env, so negative-path assertions aren't spuriously satisfied when the
  // test suite itself runs inside a `pnpm master` session (process.env carrying
  // FIL_ALLOW_MAIN_WORKTREE=1). Hatch tests pass the vars explicitly via
  // opts.env, so they are unaffected.
  const baseEnv = { ...process.env };
  delete baseEnv.FIL_ALLOW_MAIN_WORKTREE;
  delete baseEnv.FIL_MASTER_SESSION;
  const env = { ...baseEnv, ...(opts.env ?? {}) };
  try {
    execFileSync("bash", [GATE, opts.command ?? ""], {
      cwd: opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer | string };
    const code = typeof err.status === "number" ? err.status : -1;
    const se = err.stderr;
    const stderr = typeof se === "string" ? se : se?.toString?.() ?? "";
    return { code, stderr };
  }
}

/**
 * Materialize a throwaway git topology: a PRIMARY checkout (`.git` is a
 * directory) containing one commit, plus a LINKED worktree (`.git` is a file)
 * on its own branch. Returns both paths. `git worktree add` needs a real
 * commit to reference, hence the initial empty commit.
 */
function makeRepos(): { primary: string; linked: string } {
  const root = mkdtempSync(join(tmpdir(), "fil-guard-"));
  const primary = join(root, "primary");
  const linked = join(root, "linked");

  // Identity is required for the empty commit; scope it to the env passed to
  // git so it never touches the user's global config.
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "fil-test",
    GIT_AUTHOR_EMAIL: "fil-test@example.com",
    GIT_COMMITTER_NAME: "fil-test",
    GIT_COMMITTER_EMAIL: "fil-test@example.com",
  };

  execFileSync("git", ["init", "-q", primary], { env: gitEnv, stdio: "pipe" });
  execFileSync(
    "git",
    ["-C", primary, "commit", "-q", "--allow-empty", "-m", "init"],
    { env: gitEnv, stdio: "pipe" },
  );
  execFileSync(
    "git",
    ["-C", primary, "worktree", "add", "-q", "-b", "linked", linked],
    { env: gitEnv, stdio: "pipe" },
  );

  return { primary, linked };
}

describe("scripts/require-worktree.sh", () => {
  let repos: { primary: string; linked: string };
  let noGit: string;

  beforeAll(() => {
    repos = makeRepos();
    noGit = mkdtempSync(join(tmpdir(), "fil-nogit-"));
    // sanity: the fixtures actually have the .git shape the guard keys on
    expect(existsSync(join(repos.primary, ".git"))).toBe(true);
    expect(existsSync(join(repos.linked, ".git"))).toBe(true);
    const primaryGit = statSync(join(repos.primary, ".git"));
    const linkedGit = statSync(join(repos.linked, ".git"));
    expect(primaryGit.isDirectory()).toBe(true);
    expect(linkedGit.isFile()).toBe(true);
  }, 60_000);

  afterAll(() => {
    rmSync(join(repos.primary, ".."), { recursive: true, force: true });
    rmSync(noGit, { recursive: true, force: true });
  });

  it("is syntactically valid bash", () => {
    execFileSync("bash", ["-n", GATE], { stdio: "pipe" });
  });

  it("blocks the primary checkout with no hatch and no whitelist match", () => {
    const r = runGate({ cwd: repos.primary, command: "gh issue list" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("primary worktree");
  });

  it("lets the human escape hatch FIL_ALLOW_MAIN_WORKTREE=1 through", () => {
    const r = runGate({
      cwd: repos.primary,
      command: "gh issue list",
      env: { FIL_ALLOW_MAIN_WORKTREE: "1" },
    });
    expect(r.code).toBe(0);
  });

  it("lets the auto-detected master hatch FIL_MASTER_SESSION=1 through", () => {
    // This is the signal the OpenCode plugin injects when it detects the
    // master agent. A non-master session never has it set, so only the
    // master gets the hatch automatically.
    const r = runGate({
      cwd: repos.primary,
      command: "gh issue list",
      env: { FIL_MASTER_SESSION: "1" },
    });
    expect(r.code).toBe(0);
  });

  it("does NOT grant the hatch when neither master signal is present (non-master)", () => {
    // Subagents in worktrees are covered by the linked-worktree test below.
    // Here we prove the primary stays blocked for anything that isn't the
    // master: garbage values must not satisfy either hatch.
    const r = runGate({
      cwd: repos.primary,
      command: "rm -rf /",
      env: { FIL_MASTER_SESSION: "0", FIL_ALLOW_MAIN_WORKTREE: "no" },
    });
    expect(r.code).toBe(2);
  });

  it("auto-master hatch works WITHOUT the human override (end-to-end via buildGuardEnv)", () => {
    // Regression for the CodeRabbit nitpick: the master-path gate test must not
    // depend on FIL_ALLOW_MAIN_WORKTREE. Exercise the real session-classification
    // path — buildGuardEnv on a minimal base with NO human override — and confirm
    // the gate ALLOWS the call in the primary purely on the auto-master signal.
    const masterEnv = buildGuardEnv({ PATH: process.env.PATH ?? "/bin" }, true);
    // Sanity: the master env carries the auto hatch and NOT the human override.
    expect(masterEnv.FIL_MASTER_SESSION).toBe("1");
    expect(masterEnv.FIL_ALLOW_MAIN_WORKTREE).toBeUndefined();

    const allowed = runGate({ cwd: repos.primary, command: "gh issue list", env: masterEnv });
    expect(allowed.code).toBe(0);
  });

  it("non-master env from the same minimal base is BLOCKED in the primary", () => {
    // Symmetric negative: buildGuardEnv on a non-master session scrubs both
    // hatch vars, so the gate blocks in the primary even though the base env
    // is identical to the master case above.
    const nonMasterEnv = buildGuardEnv({ PATH: process.env.PATH ?? "/bin" }, false);
    expect(nonMasterEnv.FIL_MASTER_SESSION).toBeUndefined();
    expect(nonMasterEnv.FIL_ALLOW_MAIN_WORKTREE).toBeUndefined();

    const blocked = runGate({ cwd: repos.primary, command: "gh issue list", env: nonMasterEnv });
    expect(blocked.code).toBe(2);
  });

  it("whitelists bootstrap `wt` subcommands from the primary", () => {
    // The guard never invokes `wt` — it only pattern-matches $1 — so this
    // works whether or not `wt` is installed (CI runners may lack it).
    expect(runGate({ cwd: repos.primary, command: "wt switch -c foo" }).code).toBe(0);
    expect(runGate({ cwd: repos.primary, command: "wt list" }).code).toBe(0);
    expect(runGate({ cwd: repos.primary, command: "wt path" }).code).toBe(0);
  });

  it("does not whitelist mutating `wt merge` / `wt remove`", () => {
    expect(runGate({ cwd: repos.primary, command: "wt merge main" }).code).toBe(2);
    expect(runGate({ cwd: repos.primary, command: "wt remove foo" }).code).toBe(2);
  });

  it("rejects compound commands smuggled past the whitelist", () => {
    // Shell metacharacters must not slip through the strict alphabet.
    expect(
      runGate({ cwd: repos.primary, command: "wt switch foo; rm -rf /" }).code,
    ).toBe(2);
  });

  it("allows everything inside a linked worktree (subagents), regardless of hatches", () => {
    // Subagents live in worktrees; the .git-file fast path lets them through
    // even with no hatch set, and even if a hatch were set it's a no-op.
    expect(runGate({ cwd: repos.linked, command: "echo hi" }).code).toBe(0);
    expect(
      runGate({ cwd: repos.linked, command: "echo hi", env: { FIL_MASTER_SESSION: "0" } }).code,
    ).toBe(0);
  });

  it("allows when not inside a git repo at all", () => {
    expect(runGate({ cwd: noGit, command: "echo hi" }).code).toBe(0);
  });
});

describe("scripts/master.sh", () => {
  it("is syntactically valid bash", () => {
    execFileSync("bash", ["-n", MASTER], { stdio: "pipe" });
  });

  // POSIX-only: Windows checkouts don't preserve the +x bit.
  it.skipIf(process.platform === "win32")("is executable (chmod +x) on POSIX", () => {
    expect(statSync(MASTER).mode & 0o100).toBeGreaterThan(0);
  });

  it("exports FIL_ALLOW_MAIN_WORKTREE=1 (dry run, default runtime)", () => {
    // Dry-run mode prints the hatch without launching an interactive runtime,
    // so the test asserts the canonical launch path sets the var with zero
    // manual export.
    const out = execFileSync("bash", [MASTER], {
      env: { ...process.env, FIL_MASTER_DRY_RUN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    expect(out).toContain("FIL_ALLOW_MAIN_WORKTREE: 1");
    expect(out).toMatch(/runtime:\s+opencode/);
  });

  it("honours the runtime argument (dry run)", () => {
    const out = execFileSync("bash", [MASTER, "claude"], {
      env: { ...process.env, FIL_MASTER_DRY_RUN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    expect(out).toMatch(/runtime:\s+claude/);
    expect(out).toContain("FIL_ALLOW_MAIN_WORKTREE: 1");
  });
});

describe("plugin env-scrub (buildGuardEnv)", () => {
  // Covers the CodeRabbit thread: a NON-master session must never satisfy
  // either trunk hatch via process.env inheritance — even when the opencode
  // process was launched via `pnpm master` (which leaves FIL_ALLOW_MAIN_WORKTREE
  // in process.env) and the user later switched to a non-master agent. The
  // decision lives in the pure helper the plugin calls; the script itself
  // can't tell master from non-master, so this unit test is the right layer.

  it("master session keeps ambient FIL_ALLOW_MAIN_WORKTREE and injects FIL_MASTER_SESSION", () => {
    const env = buildGuardEnv(
      { FIL_ALLOW_MAIN_WORKTREE: "1", PATH: "/bin" },
      true,
    );
    expect(env.FIL_ALLOW_MAIN_WORKTREE).toBe("1");
    expect(env.FIL_MASTER_SESSION).toBe("1");
    expect(env.PATH).toBe("/bin");
  });

  it("non-master session scrubs BOTH hatch vars even when ambient env carries them", () => {
    // The exact CodeRabbit scenario: launcher left FIL_ALLOW_MAIN_WORKTREE in
    // process.env; a non-master agent in the same process must not inherit it.
    const env = buildGuardEnv(
      { FIL_ALLOW_MAIN_WORKTREE: "1", FIL_MASTER_SESSION: "1", PATH: "/bin" },
      false,
    );
    expect(env.FIL_ALLOW_MAIN_WORKTREE).toBeUndefined();
    expect(env.FIL_MASTER_SESSION).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });

  it("non-master session is scrubbed when the ambient env has no hatch vars either", () => {
    const env = buildGuardEnv({ PATH: "/bin" }, false);
    expect(env.FIL_ALLOW_MAIN_WORKTREE).toBeUndefined();
    expect(env.FIL_MASTER_SESSION).toBeUndefined();
  });

  it("does not mutate the passed-in env object (process.env stays safe)", () => {
    const input = { FIL_ALLOW_MAIN_WORKTREE: "1", PATH: "/bin" };
    buildGuardEnv(input, false);
    expect(input.FIL_ALLOW_MAIN_WORKTREE).toBe("1");
  });
});
