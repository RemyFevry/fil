import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runGate } from "./index.js";

let workdir: string;
let passScript: string;
let failScript: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-gate-"));
  passScript = join(workdir, "pass.sh");
  failScript = join(workdir, "fail.sh");
  await writeFile(passScript, "#!/bin/sh\necho 'all good'\n");
  await writeFile(failScript, "#!/bin/sh\necho 'boom' 1>&2\nexit 3\n");
});

afterAll(async () => {
  // tmpdir contents are reaped by the OS; nothing to clean here.
});

describe("gate-runner", () => {
  it("a passing shell gate yields a pass Receipt with evidence", async () => {
    const receipt = await runGate(
      { type: "shell", script: `sh ${passScript}` },
      { cwd: workdir, phase: "code" },
    );
    expect(receipt.outcome).toBe("pass");
    expect(receipt.gateType).toBe("shell");
    expect(receipt.phase).toBe("code");
    expect(receipt.evidence.exitCode).toBe(0);
    expect(receipt.evidence.stdout).toBe("all good");
    expect(receipt.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("a failing shell gate yields a fail Receipt with captured output", async () => {
    const receipt = await runGate(
      { type: "shell", script: `sh ${failScript}` },
      { cwd: workdir, phase: "code" },
    );
    expect(receipt.outcome).toBe("fail");
    expect(receipt.evidence.exitCode).toBe(3);
    expect(receipt.evidence.stderr).toBe("boom");
  });

  it("a testsPass gate runs the given command", async () => {
    const receipt = await runGate(
      { type: "testsPass", command: "true" },
      { cwd: workdir },
    );
    expect(receipt.outcome).toBe("pass");
    expect(receipt.gateType).toBe("shell");
  });

  it("records an artifactPath when declared", async () => {
    const receipt = await runGate(
      {
        type: "shell",
        script: "true",
        artifactPath: join(workdir, "pass.sh"),
      },
      { cwd: workdir },
    );
    expect(receipt.evidence.artifactPath).toBe(join(workdir, "pass.sh"));
  });

  it("a human gate confirms via the injected prompter", async () => {
    const receipt = await runGate(
      { type: "human", prompt: "Ship it?" },
      { cwd: workdir, phase: "review", prompter: async () => true },
    );
    expect(receipt.outcome).toBe("pass");
    expect(receipt.evidence.confirmed).toBe(true);
    expect(receipt.gateType).toBe("human");
  });

  it("declining a human gate yields a fail Receipt", async () => {
    const receipt = await runGate(
      { type: "human" },
      { cwd: workdir, phase: "review", prompter: async () => false },
    );
    expect(receipt.outcome).toBe("fail");
    expect(receipt.evidence.confirmed).toBe(false);
  });

  it("Receipts are JSON-serializable", async () => {
    const receipt = await runGate(
      { type: "shell", script: "true" },
      { cwd: workdir },
    );
    expect(() => JSON.stringify(receipt)).not.toThrow();
  });
});
