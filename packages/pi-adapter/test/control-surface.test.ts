import { describe, expect, it } from "vitest";
import {
  FIL_VERB_TOOLS,
  toArgv,
  findVerbTool,
  runFilVerb,
  formatVerbResult,
  type FilVerbTool,
  type VerbRunner,
} from "../src/control-surface.js";

/** Typed accessor — findVerbTool can return undefined; tests assert the fixture set. */
const t = (name: string): FilVerbTool => {
  const tool = findVerbTool(name);
  if (!tool) throw new Error(`unknown verb ${name}`);
  return tool;
};

describe("FIL_VERB_TOOLS", () => {
  it("exposes the five Fil control verbs mapped to the CLI", () => {
    const verbs = FIL_VERB_TOOLS.map((t) => `${t.toolName}→${t.verb}`).sort();
    expect(verbs).toEqual([
      "fil_approve→approve",
      "fil_next→next",
      "fil_propose→propose",
      "fil_start→start",
      "fil_status→status",
    ]);
  });

  it("every tool has a label and a model-facing description", () => {
    for (const t of FIL_VERB_TOOLS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});

describe("toArgv — arg↔CLI argv mapping (pure)", () => {
  it("start: change positional + --flow flag", () => {
    expect(toArgv(t("fil_start"), { change: "add-login", flow: "demo" })).toEqual([
      "add-login",
      "--flow",
      "demo",
    ]);
  });

  it("start omits an absent optional --flow", () => {
    expect(toArgv(t("fil_start"), { change: "add-login" })).toEqual(["add-login"]);
  });

  it("next/status take no arguments", () => {
    expect(toArgv(t("fil_next"), {})).toEqual([]);
    expect(toArgv(t("fil_status"), {})).toEqual([]);
  });

  it("propose: flow + file positionals in order", () => {
    expect(toArgv(t("fil_propose"), { flow: "default", file: "/p/proposed.js" })).toEqual([
      "default",
      "/p/proposed.js",
    ]);
  });

  it("approve: id positional + optional --flow flag", () => {
    expect(toArgv(t("fil_approve"), { id: "20260102-0000-aaaa", flow: "default" })).toEqual([
      "20260102-0000-aaaa",
      "--flow",
      "default",
    ]);
  });

  it("throws on a missing required positional", () => {
    expect(() => toArgv(t("fil_start"), {})).toThrow(/change/);
  });
});

describe("runFilVerb — thin caller over an injectable runner", () => {
  const recordingRunner =
    (log: string[][]): VerbRunner =>
    (argv) => {
      log.push(argv);
      return { exitCode: 0, stdout: `ran ${argv.join(" ")}`, stderr: "" };
    };

  it("invokes the runner with [verb, ...argv] and returns its output", () => {
    const calls: string[][] = [];
    const r = runFilVerb(t("fil_next"), {}, { cwd: "/p", runner: recordingRunner(calls) });
    expect(calls).toEqual([["next"]]);
    expect(r).toEqual({ exitCode: 0, stdout: "ran next", stderr: "" });
  });

  it("passes mapped argv for a parameterised verb", () => {
    const calls: string[][] = [];
    runFilVerb(t("fil_start"), { change: "x", flow: "demo" }, { cwd: "/p", runner: recordingRunner(calls) });
    expect(calls).toEqual([["start", "x", "--flow", "demo"]]);
  });

  it("returns exitCode 2 + stderr when a required arg is missing (no runner call)", () => {
    const calls: string[][] = [];
    const r = runFilVerb(t("fil_propose"), { flow: "default" }, { cwd: "/p", runner: recordingRunner(calls) });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/file/);
    expect(calls).toEqual([]);
  });
});

describe("findVerbTool + formatVerbResult", () => {
  it("finds a tool by name", () => {
    expect(findVerbTool("fil_next")?.verb).toBe("next");
    expect(findVerbTool("nope")).toBeUndefined();
  });

  it("formats combined stdout/stderr, falling back to an exit marker", () => {
    expect(formatVerbResult({ exitCode: 0, stdout: "ok\n", stderr: "" })).toBe("ok");
    expect(formatVerbResult({ exitCode: 1, stdout: "out", stderr: "err" })).toBe("out\nerr");
    expect(formatVerbResult({ exitCode: 1, stdout: "", stderr: "" })).toBe("(fil exited 1)");
  });
});
