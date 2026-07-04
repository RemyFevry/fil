import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artifactExists, runGate } from "../src/index.js";

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

afterAll(() => {
  // tmpdir contents are reaped by the OS; nothing to clean here.
});

describe("gate-runner", () => {
  it("a passing shell gate yields a pass Receipt with evidence", async () => {
    const receipt = await runGate(
      { name: "g", type: "shell", script: `sh ${passScript}` },
      { cwd: workdir, phase: "code" },
    );
    expect(receipt.outcome).toBe("pass");
    expect(receipt.gateType).toBe("shell");
    expect(receipt.gateName).toBe("g");
    expect(receipt.phase).toBe("code");
    expect(receipt.evidence.exitCode).toBe(0);
    expect(receipt.evidence.stdout).toBe("all good");
    expect(receipt.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("a failing shell gate yields a fail Receipt with captured output", async () => {
    const receipt = await runGate(
      { name: "g", type: "shell", script: `sh ${failScript}` },
      { cwd: workdir, phase: "code" },
    );
    expect(receipt.outcome).toBe("fail");
    expect(receipt.evidence.exitCode).toBe(3);
    expect(receipt.evidence.stderr).toBe("boom");
  });

  it("a testsPass gate runs the given command", async () => {
    const receipt = await runGate(
      { name: "g", type: "testsPass", command: "true" },
      { cwd: workdir },
    );
    expect(receipt.outcome).toBe("pass");
    expect(receipt.gateType).toBe("shell");
  });

  it("records an artifactPath when declared", async () => {
    const receipt = await runGate(
      {
        name: "g",
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
      { name: "approve", type: "human", prompt: "Ship it?" },
      { cwd: workdir, phase: "review", prompter: async () => true },
    );
    expect(receipt.outcome).toBe("pass");
    expect(receipt.evidence.confirmed).toBe(true);
    expect(receipt.gateType).toBe("human");
    expect(receipt.gateName).toBe("approve");
  });

  it("declining a human gate yields a fail Receipt", async () => {
    const receipt = await runGate(
      { name: "approve", type: "human" },
      { cwd: workdir, phase: "review", prompter: async () => false },
    );
    expect(receipt.outcome).toBe("fail");
    expect(receipt.evidence.confirmed).toBe(false);
  });

  it("Receipts are JSON-serializable", async () => {
    const receipt = await runGate(
      { name: "g", type: "shell", script: "true" },
      { cwd: workdir },
    );
    expect(() => JSON.stringify(receipt)).not.toThrow();
  });

  it("artifactExists resolves relative paths against cwd, not process.cwd()", async () => {
    // Place a file only inside `workdir`; the system cwd (whatever vitest uses)
    // must not be allowed to satisfy the lookup for the bare-relative name.
    const relativeName = "artifact-only-in-workdir.md";
    const workdirPath = join(workdir, relativeName);
    await writeFile(workdirPath, "x\n");

    const previousCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      // Absolute path resolves directly.
      expect(artifactExists(workdirPath, workdir)).toBe(true);
      // Relative path is joined to cwd, NOT to process.cwd().
      expect(artifactExists(relativeName, workdir)).toBe(true);
      // And looking from a different cwd returns false (no fallback to process.cwd()).
      expect(artifactExists(relativeName, tmpdir())).toBe(false);
      // undefined path is a no-op (the gate does not declare an artifact).
      expect(artifactExists(undefined, workdir)).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
