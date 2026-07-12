import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memFs } from "@color-sunset/fil-adapter-host";
import {
  installClaudeAdapter,
  detectClaude,
  mergePreToolUseHandler,
} from "../src/installer.js";

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-claude-adapter-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("installClaudeAdapter", () => {
  it("writes the hook script and registers it in settings.json by default", () => {
    const fs = memFs();
    const result = installClaudeAdapter({
      projectRoot: workdir,
      fs,
      claudeDetected: true,
    });
    expect(result.installed).toBe(true);
    expect(result.claudeDetected).toBe(true);
    // Path-segment check works on every OS; the literal `.claude/...`
    // mangles on Windows where `join` produces backslashes.
    expect(result.paths.project.hook.split(sep).slice(-3)).toEqual([
      ".claude",
      "fil",
      "pretooluse-hook.js",
    ]);
    expect(result.paths.project.settings.split(sep).slice(-2)).toEqual([
      ".claude",
      "settings.json",
    ]);
    expect(result.reason).toBeUndefined();

    const settings = fs.read(result.paths.project.settings) ?? "";
    expect(settings).toContain("PreToolUse");
    expect(settings).toContain("${CLAUDE_PROJECT_DIR}/.claude/fil/pretooluse-hook.js");
    expect(fs.read(result.paths.project.hook)).toContain("CLAUDE_PROJECT_DIR");
  });

  it("is idempotent — re-running is a no-op", () => {
    const fs = memFs();
    installClaudeAdapter({ projectRoot: workdir, fs, claudeDetected: true });
    const second = installClaudeAdapter({ projectRoot: workdir, fs, claudeDetected: true });
    expect(second.installed).toBe(false);
    expect(second.reason).toMatch(/idempotent/i);
  });

  it("rewrites the hook script when the source has changed", () => {
    const fs = memFs();
    const first = installClaudeAdapter({
      projectRoot: workdir,
      fs,
      claudeDetected: true,
      source: "// old\n",
    });
    expect(fs.read(first.paths.project.hook)).toBe("// old\n");
    const second = installClaudeAdapter({
      projectRoot: workdir,
      fs,
      claudeDetected: true,
      source: "// new\n",
    });
    expect(second.installed).toBe(true);
    expect(fs.read(first.paths.project.hook)).toBe("// new\n");
  });

  it("skips installation entirely when Claude Code is not detected", () => {
    const result = installClaudeAdapter({
      projectRoot: workdir,
      fs: memFs(),
      claudeDetected: false,
    });
    expect(result.installed).toBe(false);
    expect(result.claudeDetected).toBe(false);
    expect(result.reason).toMatch(/not detected/i);
  });

  it("installs at user scope too when scope = 'both'", () => {
    const fs = memFs();
    // Synthetic POSIX-style home; `path.join` of a single arg normalizes
    // separators so the prefix is platform-correct (macOS/Linux: "/home/pilot";
    // Windows: "\home\pilot"). Mirrors the installer's `join` calls so the
    // assertions match on every OS.
    const userHome = "/home/pilot";
    const normalizedHome = join(userHome);
    const result = installClaudeAdapter({
      projectRoot: workdir,
      fs,
      claudeDetected: true,
      userFilDir: join(userHome, ".fil"),
      scope: "both",
    });
    expect(result.installed).toBe(true);
    expect(result.paths.user.hook).toBe(
      join(userHome, ".claude/fil/pretooluse-hook.js"),
    );
    expect(result.paths.user.settings).toBe(
      join(userHome, ".claude/settings.json"),
    );
    // User-scope references the absolute path (no placeholder).
    const settings = fs.read(result.paths.user.settings) ?? "";
    expect(settings).toContain(
      // settings.json is a JSON string, so backslashes are JSON-escaped
      // (Windows separator `\` is emitted as `\\` in the source string).
      // Wrap the expected value in JSON.stringify and slice off the
      // surrounding quotes so the substring matches the in-document
      // escape form on every OS.
      JSON.stringify(
        [normalizedHome, ".claude", "fil", "pretooluse-hook.js"].join(sep),
      ).slice(1, -1),
    );
    expect(settings).not.toContain("${CLAUDE_PROJECT_DIR}");
  });
});

describe("mergePreToolUseHandler", () => {
  const handler = { type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/.claude/fil/pretooluse-hook.js"] };

  it("creates the hooks structure when settings are absent", () => {
    const { body, added } = mergePreToolUseHandler(undefined, handler);
    expect(added).toBe(true);
    const doc = JSON.parse(body);
    expect(doc.hooks.PreToolUse[0].matcher).toBe("");
    expect(doc.hooks.PreToolUse[0].hooks[0].command).toBe("node");
  });

  it("preserves existing hooks and appends Fil's handler to the all-tools group", () => {
    const existing = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "/usr/bin/other.sh" }],
          },
        ],
      },
      permissions: { allow: ["Read"] },
    });
    const { body, added } = mergePreToolUseHandler(existing, handler);
    expect(added).toBe(true);
    const doc = JSON.parse(body);
    // Existing Bash group untouched.
    expect(doc.hooks.PreToolUse[0].matcher).toBe("Bash");
    // Fil's all-tools group added.
    expect(doc.hooks.PreToolUse[1].matcher).toBe("");
    expect(doc.hooks.PreToolUse[1].hooks[0].command).toBe("node");
    // Unrelated settings preserved.
    expect(doc.permissions.allow).toEqual(["Read"]);
  });

  it("does not add a duplicate handler on re-run", () => {
    const first = mergePreToolUseHandler(undefined, handler);
    const second = mergePreToolUseHandler(first.body, handler);
    expect(second.added).toBe(false);
    // Body unchanged.
    expect(JSON.parse(second.body).hooks.PreToolUse[0].hooks).toHaveLength(1);
  });

  it("reuses an existing all-tools group instead of creating a second one", () => {
    const existing = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "", hooks: [] }] },
    });
    const { body, added } = mergePreToolUseHandler(existing, handler);
    expect(added).toBe(true);
    const doc = JSON.parse(body);
    expect(doc.hooks.PreToolUse).toHaveLength(1);
    expect(doc.hooks.PreToolUse[0].hooks).toHaveLength(1);
  });

  it("throws on malformed settings JSON rather than silently clobbering it", () => {
    // A broken settings.json must NOT be swallowed into {} (which would make
    // the merge write a fresh doc and discard the user's settings).
    expect(() => mergePreToolUseHandler("{ not json", handler)).toThrow(/not valid JSON/i);
  });

  it("throws on a non-object root or unexpected hook shape", () => {
    expect(() => mergePreToolUseHandler("[1,2,3]", handler)).toThrow(/not a JSON object/i);
    expect(() => mergePreToolUseHandler(JSON.stringify({ hooks: "nope" }), handler)).toThrow(/hooks.*not an object/i);
    expect(() => mergePreToolUseHandler(JSON.stringify({ hooks: { PreToolUse: "nope" } }), handler)).toThrow(
      /PreToolUse.*not an array/i,
    );
    expect(() =>
      mergePreToolUseHandler(JSON.stringify({ hooks: { PreToolUse: [{ matcher: "", hooks: "nope" }] } }), handler),
    ).toThrow(/hooks.*not an array/i);
  });
});

describe("installClaudeAdapter — settings.json safety", () => {
  it("leaves a malformed settings.json untouched and reports the error (no clobber)", () => {
    const fs = memFs();
    fs.write(join(workdir, ".claude/settings.json"), "{ broken");
    const result = installClaudeAdapter({ projectRoot: workdir, fs, claudeDetected: true });
    // Hook script still installed…
    expect(result.installed).toBe(true);
    expect(fs.read(join(workdir, ".claude/fil/pretooluse-hook.js"))).toBeTruthy();
    // …but settings.json is preserved verbatim and the reason explains it.
    expect(fs.read(join(workdir, ".claude/settings.json"))).toBe("{ broken");
    expect(result.reason).toMatch(/settings.json was left untouched/);
    expect(result.reason).toMatch(/not valid JSON/i);
  });
});

describe("detectClaude", () => {
  it("returns false when nothing looks like Claude (synthetic FS)", () => {
    expect(detectClaude(memFs(), "/home/empty")).toBe(false);
  });

  it("returns true when ~/.claude exists", () => {
    const fs = memFs();
    // Mirror the installer's `join(home, ".claude")` so the memFs key
    // matches the production lookup on every OS.
    fs.mkdir(join("/home/pilot", ".claude"));
    expect(detectClaude(fs, "/home/pilot")).toBe(true);
  });

  it("returns true when ~/.claude.json exists", () => {
    const fs = memFs();
    fs.write(join("/home/pilot", ".claude.json"), "{}");
    expect(detectClaude(fs, "/home/pilot")).toBe(true);
  });

  it("detects claude.exe on PATH (Windows-style filename, cross-platform probe)", () => {
    const fs = memFs();
    fs.mkdir("/custom-bin"); // isDirectory reads the literal dir — no join needed
    // The production probe does `fs.exists(join(dir, "claude.exe"))`;
    // join-emit-on-Windows means we have to key the memFs the same way.
    fs.write(join("/custom-bin", "claude.exe"), "");
    const oldPath = process.env.PATH;
    process.env.PATH = "/custom-bin";
    try {
      expect(detectClaude(fs, "/home/empty")).toBe(true);
    } finally {
      process.env.PATH = oldPath;
    }
  });
});
