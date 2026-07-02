import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  installClaudeAdapter,
  detectClaude,
  mergePreToolUseHandler,
  type InstallerFs,
} from "../src/installer.js";

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-claude-adapter-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function memFs(): InstallerFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    exists: (p) => files.has(p) || dirs.has(p),
    read: (p) => files.get(p),
    write: (p, body) => {
      files.set(p, body);
    },
    isDirectory: (p) => dirs.has(p),
    mkdir: (p) => {
      dirs.add(p);
    },
  };
}

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
    expect(result.paths.project.hook).toContain(".claude/fil/pretooluse-hook.js");
    expect(result.paths.project.settings).toContain(".claude/settings.json");
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
    const userHome = "/home/pilot";
    const result = installClaudeAdapter({
      projectRoot: workdir,
      fs,
      claudeDetected: true,
      userFilDir: join(userHome, ".fil"),
      scope: "both",
    });
    expect(result.installed).toBe(true);
    expect(result.paths.user.hook).toBe(join(userHome, ".claude/fil/pretooluse-hook.js"));
    expect(result.paths.user.settings).toBe(join(userHome, ".claude/settings.json"));
    // User-scope references the absolute path (no placeholder).
    const settings = fs.read(result.paths.user.settings) ?? "";
    expect(settings).toContain(userHome + "/.claude/fil/pretooluse-hook.js");
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

  it("treats malformed settings JSON as empty (output is always valid JSON)", () => {
    const { body, added } = mergePreToolUseHandler("{ not json", handler);
    expect(added).toBe(true);
    expect(() => JSON.parse(body)).not.toThrow();
  });
});

describe("detectClaude", () => {
  it("returns false when nothing looks like Claude (synthetic FS)", () => {
    expect(detectClaude(memFs(), "/home/empty")).toBe(false);
  });

  it("returns true when ~/.claude exists", () => {
    const fs = memFs();
    fs.mkdir("/home/pilot/.claude");
    expect(detectClaude(fs, "/home/pilot")).toBe(true);
  });

  it("returns true when ~/.claude.json exists", () => {
    const fs = memFs();
    fs.write("/home/pilot/.claude.json", "{}");
    expect(detectClaude(fs, "/home/pilot")).toBe(true);
  });
});
