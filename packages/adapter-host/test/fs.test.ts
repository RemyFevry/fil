import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultFs,
  memFs,
  safeRead,
  scopesOf,
  writeAt,
  type InstallScope,
} from "../src/index.js";

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-adapter-host-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("scopesOf", () => {
  it("expands each InstallScope to the concrete scopes", () => {
    const cases: Array<[InstallScope, Array<"project" | "user">]> = [
      ["project", ["project"]],
      ["user", ["user"]],
      ["both", ["project", "user"]],
    ];
    for (const [scope, expected] of cases) {
      expect(scopesOf(scope)).toEqual(expected);
    }
  });
});

describe("memFs", () => {
  it("starts empty", () => {
    const fs = memFs();
    expect(fs.exists("/anything")).toBe(false);
    expect(fs.isDirectory("/anywhere")).toBe(false);
    expect(fs.read("/anything")).toBeUndefined();
  });

  it("records writes and mkdirs without touching disk", () => {
    const fs = memFs();
    fs.mkdir("/a/b");
    fs.write("/a/b/file.txt", "hello");
    expect(fs.isDirectory("/a/b")).toBe(true);
    expect(fs.exists("/a/b/file.txt")).toBe(true);
    expect(fs.read("/a/b/file.txt")).toBe("hello");
  });
});

describe("safeRead + writeAt (over memFs)", () => {
  it("safeRead returns undefined when the file is absent", () => {
    const fs = memFs();
    expect(safeRead(fs, "/missing.txt")).toBeUndefined();
  });

  it("writeAt creates the parent dir and writes the body, then safeRead returns it", () => {
    const fs = memFs();
    writeAt(fs, "/nested/dir/file.txt", "body");
    expect(fs.isDirectory("/nested/dir")).toBe(true);
    expect(safeRead(fs, "/nested/dir/file.txt")).toBe("body");
  });
});

describe("defaultFs (real node:fs)", () => {
  it("round-trips a file under a temp dir, creating parents as needed", () => {
    const fs = defaultFs();
    const target = join(workdir, "sub", "real.txt");
    expect(fs.exists(target)).toBe(false);
    writeAt(fs, target, "on-disk");
    expect(fs.exists(target)).toBe(true);
    expect(safeRead(fs, target)).toBe("on-disk");
    expect(fs.isDirectory(join(workdir, "sub"))).toBe(true);
  });

  it("isDirectory is false for a missing path rather than throwing", () => {
    const fs = defaultFs();
    expect(fs.isDirectory(join(workdir, "definitely-not-here"))).toBe(false);
  });
});
