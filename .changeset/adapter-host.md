---
"@color-sunset/fil-adapter-host": minor
"@color-sunset/fil-claude-adapter": patch
"@color-sunset/fil-pi-adapter": patch
---

Lift the shared host-fs plumbing into **`@color-sunset/fil-adapter-host`**, closing #91.

- New `@color-sunset/fil-adapter-host` (0.1.0) owns the six host-fs helpers
  that were byte-identical across the two Adapter installers: `InstallerFs`,
  `defaultFs`, `safeRead`, `writeAt`, `scopesOf`, and the `memFs` test helper
  (plus the `InstallScope` type that `scopesOf` consumes).
- `claude-adapter` and `pi-adapter` delete their duplicated copies and import
  from the host, re-exporting `defaultFs`/`InstallerFs`/`InstallScope` so their
  public surfaces are unchanged. Each Adapter now owns ONLY its
  target-specific knowledge: target subdirectory, PATH probe, and rendered
  artefact body (`.js` hook for Claude, `.ts` extension for Pi).
- The deepening (codebase-design: "two adapters means a real seam") lands the
  runtime-target seam behind a host module: a future third Adapter imports
  `@color-sunset/fil-adapter-host` and owns only its target.

The seam this draws is the host-fs surface; target-specific behaviour stays
in each Adapter. No installer BEHAVIOUR change — the lifted helpers are
identical to the duplicates they replace. The installer tests were updated
(they now import the shared `memFs` from the host and drop their local
copies) and pass, driving the full install path end-to-end.
