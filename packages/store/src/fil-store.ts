import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { RunProjection } from "@fil/contract";
import {
  DEFAULT_CONFIG,
  type FilConfig,
  type RunState,
  type Store,
} from "./types.js";

/**
 * The real filesystem-backed `Store`. Operates on a `.fil/` directory.
 * All operations are synchronous — Fil is a sidecar CLI, not a hot path.
 */
export class FilStore implements Store {
  constructor(private readonly filDir: string) {}

  // -------------------------------------------------------------------------
  // paths
  // -------------------------------------------------------------------------
  get dir(): string {
    return this.filDir;
  }
  private configPath(): string {
    return join(this.filDir, "config.json");
  }
  private flowsDir(): string {
    return join(this.filDir, "flows");
  }
  private flowPath(name: string): string {
    return join(this.flowsDir(), `${name}.json`);
  }
  private projectionPath(): string {
    return join(this.filDir, "run.json");
  }
  private runsDir(): string {
    return join(this.filDir, "runs");
  }
  private runDir(runId: string): string {
    return join(this.runsDir(), runId);
  }
  private runStatePath(runId: string): string {
    return join(this.runDir(runId), "state.json");
  }
  private flowSnapshotPath(runId: string): string {
    return join(this.runDir(runId), "flow.snapshot.json");
  }
  private proposalsDir(): string {
    return join(this.filDir, "proposals");
  }
  private proposalPath(id: string): string {
    return join(this.proposalsDir(), `${id}.patch`);
  }

  // -------------------------------------------------------------------------
  // layout / config
  // -------------------------------------------------------------------------
  ensureLayout(): void {
    mkdirSync(this.flowsDir(), { recursive: true });
    mkdirSync(this.runsDir(), { recursive: true });
    mkdirSync(this.proposalsDir(), { recursive: true });
    if (!existsSync(this.configPath())) {
      this.writeConfig(DEFAULT_CONFIG);
    }
  }

  readConfig(): FilConfig | null {
    return this.readJson<FilConfig>(this.configPath());
  }

  writeConfig(config: FilConfig): void {
    this.writeJson(this.configPath(), config);
  }

  // -------------------------------------------------------------------------
  // flows
  // -------------------------------------------------------------------------
  listFlows(): string[] {
    return this.listJsonNames(this.flowsDir());
  }

  readFlow(name: string): Record<string, unknown> | undefined {
    return this.readJson<Record<string, unknown>>(this.flowPath(name)) ?? undefined;
  }

  writeFlow(name: string, definition: Record<string, unknown>): void {
    mkdirSync(this.flowsDir(), { recursive: true });
    this.writeJson(this.flowPath(name), definition);
  }

  flowExists(name: string): boolean {
    return existsSync(this.flowPath(name));
  }

  // -------------------------------------------------------------------------
  // projection
  // -------------------------------------------------------------------------
  readProjection(): RunProjection | null {
    return this.readJson<RunProjection>(this.projectionPath());
  }

  writeProjection(projection: RunProjection): void {
    this.writeJson(this.projectionPath(), projection);
  }

  clearProjection(): void {
    if (existsSync(this.projectionPath())) {
      rmSync(this.projectionPath());
    }
  }

  // -------------------------------------------------------------------------
  // runs
  // -------------------------------------------------------------------------
  listRuns(): string[] {
    if (!existsSync(this.runsDir())) return [];
    return readdirSync(this.runsDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  readRunState(runId: string): RunState | null {
    return this.readJson<RunState>(this.runStatePath(runId));
  }

  writeRunState(state: RunState): void {
    mkdirSync(this.runDir(state.runId), { recursive: true });
    this.writeJson(this.runStatePath(state.runId), state);
  }

  // -------------------------------------------------------------------------
  // flow snapshots
  // -------------------------------------------------------------------------
  readFlowSnapshot(runId: string): Record<string, unknown> | null {
    return this.readJson<Record<string, unknown>>(this.flowSnapshotPath(runId));
  }

  writeFlowSnapshot(runId: string, definition: Record<string, unknown>): void {
    mkdirSync(this.runDir(runId), { recursive: true });
    this.writeJson(this.flowSnapshotPath(runId), definition);
  }

  // -------------------------------------------------------------------------
  // proposals
  // -------------------------------------------------------------------------
  listProposals(): string[] {
    return readdirSync(this.proposalsDir())
      .filter((name) => name.endsWith(".patch"))
      .map((name) => name.slice(0, -6));
  }

  readProposal(id: string): string | null {
    const path = this.proposalPath(id);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  }

  writeProposal(id: string, patch: string): void {
    mkdirSync(this.proposalsDir(), { recursive: true });
    writeFileSync(this.proposalPath(id), patch, "utf8");
  }

  removeProposal(id: string): void {
    const path = this.proposalPath(id);
    if (existsSync(path)) rmSync(path);
  }

  // -------------------------------------------------------------------------
  // json helpers
  // -------------------------------------------------------------------------
  private readJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }

  private writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private listJsonNames(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5));
  }
}
