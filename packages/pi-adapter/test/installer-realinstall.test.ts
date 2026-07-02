import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  installPiAdapter,
  defaultFs,
  renderPiExtensionSource,
  type InstallerFs,
} from "../src/installer.js";

/**
 * Real-install tests — drive the installer against the *real* filesystem so
 * we know the .pi/extensions/fil.ts file is actually written where Pi loads
 * extensions from. These complement the in-memory tests in installer.test.ts
 * (which exercise idempotency with synthetic FS).
 */

let workdir: string;
const realFs: InstallerFs = defaultFs();

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-pi-realinstall-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
});

const extensionPath = (root: string) => join(root, ".pi", "extensions", "fil.ts");

describe("installPiAdapter — real install", () => {
  it("writes a valid Pi extension to .pi/extensions/fil.ts", async () => {
    const result = installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: true,
    });
    expect(result.installed).toBe(true);
    expect(result.piDetected).toBe(true);
    expect(result.paths.project).toBe(extensionPath(workdir));

    const written = await readFile(extensionPath(workdir), "utf8");
    expect(written).toContain("filPiExtension");
    expect(written).toContain('import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"');
    expect(written).toContain("setActiveTools");
    expect(written).toContain("before_agent_start");
    expect(written).toContain("resources_discover");
    expect(written).toContain("tool_call");
  });

  it("is a no-op the second time the same source is installed", async () => {
    installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: true,
      source: "// v1\n",
    });
    const second = installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: true,
      source: "// v1\n",
    });
    expect(second.installed).toBe(false);
    expect(second.reason).toMatch(/idempotent/i);
    const body = await readFile(extensionPath(workdir), "utf8");
    expect(body).toBe("// v1\n");
  });

  it("overwrites the file when the rendered source has changed (e.g. new build)", async () => {
    installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: true,
      source: "// old\n",
    });
    const second = installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: true,
      source: renderPiExtensionSource(),
    });
    expect(second.installed).toBe(true);
    const body = await readFile(extensionPath(workdir), "utf8");
    expect(body).toContain("filPiExtension");
    expect(body).not.toBe("// old\n");
  });

  it("writes to the user scope too when scope='both' (real FS)", async () => {
    // We can't touch the real $HOME, so use a fake userFilDir and a tmp
    // "home" we control — proves the path math, then asserts the user-level
    // file actually lands on disk under the right relative layout.
    const fakeHome = await mkdtemp(join(tmpdir(), "fil-pi-userhome-"));
    try {
      const result = installPiAdapter({
        projectRoot: workdir,
        fs: realFs,
        piDetected: true,
        userFilDir: join(fakeHome, ".fil"),
        scope: "both",
      });
      expect(result.installed).toBe(true);
      const userExt = join(fakeHome, ".pi", "agent", "extensions", "fil.ts");
      const body = await readFile(userExt, "utf8");
      expect(body).toContain("filPiExtension");
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("skips writing entirely when Pi is not detected", async () => {
    const result = installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: false,
    });
    expect(result.installed).toBe(false);
    expect(result.piDetected).toBe(false);
    // No file should exist (regression guard).
    const { stat } = await import("node:fs/promises");
    await expect(stat(extensionPath(workdir))).rejects.toThrow();
  });

  it("rewrites the file when the on-disk copy has a human edit appended (source no longer matches)", async () => {
    // Install once, then a human appends a line, then re-install. The trailing
    // edit means the on-disk content no longer matches the rendered source, so
    // the install must rewrite (this is the *expected* overwrite behaviour; the
    // install is not designed to preserve human edits — see renderPiExtensionSource
    // for the contract: humans should extend via Pi's own hook system, not by
    // editing the generated file).
    installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: true,
      source: renderPiExtensionSource(),
    });
    const target = extensionPath(workdir);
    const original = await readFile(target, "utf8");
    const edited = `${original}\n// local hook: human edit\n`;
    await writeFile(target, edited, "utf8");

    const first = installPiAdapter({
      projectRoot: workdir,
      fs: realFs,
      piDetected: true,
      source: renderPiExtensionSource(),
    });
    // On-disk content no longer matches the rendered source → the install rewrites.
    expect(first.installed).toBe(true);
    const rewritten = await readFile(target, "utf8");
    expect(rewritten).toBe(renderPiExtensionSource());
  });
});
