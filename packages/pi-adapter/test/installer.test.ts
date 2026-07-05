import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  installPiAdapter,
  detectPi,
  defaultFs,
  renderPiExtensionSource,
  type InstallerFs,
} from "../src/installer.js";

let workdir: string;

const realFs = (): InstallerFs => defaultFs();

function memFs(): InstallerFs {
  const map = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    exists: (p) => map.has(p) || dirs.has(p),
    read: (p) => map.get(p),
    write: (p, body) => {
      map.set(p, body);
    },
    isDirectory: (p) => dirs.has(p),
    mkdir: (p) => {
      dirs.add(p);
    },
  };
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-pi-adapter-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("installPiAdapter", () => {
  it("writes the extension file under .pi/extensions/fil.ts by default", () => {
    const result = installPiAdapter({
      projectRoot: workdir,
      fs: memFs(),
      piDetected: true,
    });
    expect(result.installed).toBe(true);
    // Path-segment check works on every OS; the literal `.pi/extensions/fil.ts`
    // mangles on Windows where `join` produces backslashes.
    expect(result.paths.project.split(sep).slice(-3)).toEqual([".pi", "extensions", "fil.ts"]);
    expect(result.piDetected).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("is idempotent — re-running with the same source is a no-op", () => {
    const fs = memFs();
    const first = installPiAdapter({
      projectRoot: workdir,
      fs,
      piDetected: true,
    });
    expect(first.installed).toBe(true);
    const second = installPiAdapter({
      projectRoot: workdir,
      fs,
      piDetected: true,
      source: first.paths.project ? undefined : renderPiExtensionSource(),
    });
    expect(second.installed).toBe(false);
    expect(second.reason).toMatch(/idempotent/i);
  });

  it("rewrites the file when the source has changed (e.g. new build)", () => {
    const fs = memFs();
    const first = installPiAdapter({
      projectRoot: workdir,
      fs,
      piDetected: true,
      source: "// old\n",
    });
    expect(first.installed).toBe(true);
    const second = installPiAdapter({
      projectRoot: workdir,
      fs,
      piDetected: true,
      source: "// new\n",
    });
    expect(second.installed).toBe(true);
  });

  it("skips installation entirely when Pi is not detected", () => {
    const result = installPiAdapter({
      projectRoot: workdir,
      fs: memFs(),
      piDetected: false,
    });
    expect(result.installed).toBe(false);
    expect(result.piDetected).toBe(false);
    expect(result.reason).toMatch(/not detected/i);
  });

  it("installs at user scope too when scope = 'both'", () => {
    const fs = memFs();
    // Use a synthetic Unix-style home. `path.join` of a single arg normalizes
    // separators so we get the platform-correct prefix on every OS:
    //   - macOS / Linux: "/home/pilot"
    //   - Windows:        "\home\pilot"
    // Production joins the user dir + ".." + USER_PI_EXT_DIR + filename;
    // mirroring the same joins with `sep` makes the expected tail match on
    // every OS without conditional logic.
    const userHome = "/home/pilot";
    const normalizedHome = join(userHome);
    const expectedTail = [normalizedHome, ".pi", "agent", "extensions", "fil.ts"].join(sep);
    const result = installPiAdapter({
      projectRoot: workdir,
      fs,
      piDetected: true,
      userFilDir: join(userHome, ".fil"),
      scope: "both",
    });
    expect(result.installed).toBe(true);
    expect(result.paths.user.endsWith(expectedTail)).toBe(true);
  });

  it("writes to the real filesystem under .pi/extensions/fil.ts (smoke)", async () => {
    const result = installPiAdapter({
      projectRoot: workdir,
      fs: realFs(),
      piDetected: true,
    });
    expect(result.installed).toBe(true);
    // Was it actually written?
    const contents = await readFileString(join(workdir, ".pi", "extensions", "fil.ts"));
    expect(contents).toContain("filPiExtension");
  });
});

describe("detectPi", () => {
  it("returns false when nothing looks like Pi (synthetic FS)", () => {
    expect(detectPi(memFs(), "/home/empty")).toBe(false);
  });

  it("returns true when ~/.pi/agent/extensions exists", () => {
    const fs = memFs();
    // Key the memFs with whatever `join` produces on the host — production
    // calls `join(home, USER_PI_EXT_DIR)` and we must match its exact form
    // for the synthetic lookup to find this directory.
    const userHome = "/home/pilot";
    fs.mkdir(join(userHome, ".pi", "agent", "extensions"));
    expect(detectPi(fs, userHome)).toBe(true);
  });

  it("returns true when ~/.pi exists (parent of extensions dir)", () => {
    const fs = memFs();
    const userHome = "/home/pilot";
    fs.mkdir(join(userHome, ".pi"));
    expect(detectPi(fs, userHome)).toBe(true);
  });
});

async function readFileString(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}
