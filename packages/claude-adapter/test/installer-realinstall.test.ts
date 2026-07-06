import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  installClaudeAdapter,
  defaultFs,
  renderPreToolUseHookSource,
  type InstallerFs,
} from "../src/installer.js";

/**
 * Real-install tests — drive the installer against the *real* filesystem so we
 * know the hook script and settings.json actually land where Claude Code loads
 * them from. Complements the in-memory tests in installer.test.ts.
 */

let workdir: string;
const realFs: InstallerFs = defaultFs();

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-claude-realinstall-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
});

const hookPath = (root: string) => join(root, ".claude", "fil", "pretooluse-hook.js");
const settingsPath = (root: string) => join(root, ".claude", "settings.json");

describe("installClaudeAdapter — real install", () => {
  it("writes the hook script and registers it in .claude/settings.json", async () => {
    const result = installClaudeAdapter({
      projectRoot: workdir,
      fs: realFs,
      claudeDetected: true,
    });
    expect(result.installed).toBe(true);
    expect(result.paths.project.hook).toBe(hookPath(workdir));
    expect(result.paths.project.settings).toBe(settingsPath(workdir));

    const hook = await readFile(hookPath(workdir), "utf8");
    expect(hook).toContain("CLAUDE_PROJECT_DIR");
    expect(hook).toContain("permissionDecision");
    expect(hook).toContain("permits no tools");

    const settings = JSON.parse(await readFile(settingsPath(workdir), "utf8"));
    const group = settings.hooks.PreToolUse[0];
    expect(group.matcher).toBe("");
    expect(group.hooks[0].command).toBe("node");
    expect(group.hooks[0].args[0]).toBe("${CLAUDE_PROJECT_DIR}/.claude/fil/pretooluse-hook.js");
  });

  it("is a no-op the second time the same source is installed", async () => {
    installClaudeAdapter({
      projectRoot: workdir,
      fs: realFs,
      claudeDetected: true,
      source: "// v1\n",
    });
    const second = installClaudeAdapter({
      projectRoot: workdir,
      fs: realFs,
      claudeDetected: true,
      source: "// v1\n",
    });
    expect(second.installed).toBe(false);
    expect(second.reason).toMatch(/idempotent/i);
    expect(await readFile(hookPath(workdir), "utf8")).toBe("// v1\n");
  });

  it("overwrites the hook when the rendered source has changed", async () => {
    installClaudeAdapter({
      projectRoot: workdir,
      fs: realFs,
      claudeDetected: true,
      source: "// old\n",
    });
    const second = installClaudeAdapter({
      projectRoot: workdir,
      fs: realFs,
      claudeDetected: true,
      source: renderPreToolUseHookSource(),
    });
    expect(second.installed).toBe(true);
    const body = await readFile(hookPath(workdir), "utf8");
    expect(body).toContain("CLAUDE_PROJECT_DIR");
    expect(body).not.toBe("// old\n");
  });

  it("writes to the user scope too when scope='both' (real FS)", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "fil-claude-userhome-"));
    try {
      const result = installClaudeAdapter({
        projectRoot: workdir,
        fs: realFs,
        claudeDetected: true,
        userFilDir: join(fakeHome, ".fil"),
        scope: "both",
      });
      expect(result.installed).toBe(true);
      const userHook = join(fakeHome, ".claude", "fil", "pretooluse-hook.js");
      const body = await readFile(userHook, "utf8");
      expect(body).toContain("CLAUDE_PROJECT_DIR");
      const settings = JSON.parse(await readFile(join(fakeHome, ".claude", "settings.json"), "utf8"));
      expect(settings.hooks.PreToolUse[0].hooks[0].args[0]).toBe(userHook);
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("skips writing entirely when Claude Code is not detected", async () => {
    const result = installClaudeAdapter({
      projectRoot: workdir,
      fs: realFs,
      claudeDetected: false,
    });
    expect(result.installed).toBe(false);
    expect(result.claudeDetected).toBe(false);
    const { stat } = await import("node:fs/promises");
    await expect(stat(hookPath(workdir))).rejects.toThrow();
    await expect(stat(settingsPath(workdir))).rejects.toThrow();
  });
});
