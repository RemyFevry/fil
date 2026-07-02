# @fil/cli

## 0.1.0

### Minor Changes

- 723d8a6: Initial public release.

  - All `@fil/*` packages and the `fil-cli` meta-package are now publishable to npm under the MIT license.
  - `fil-cli` ships a `bin: fil` entry, so `npm install -g fil-cli` and `npx fil-cli` work post-install. (The `fil` name itself was already taken on npm by an unrelated static-site generator, so the meta-package is `fil-cli` while the `fil` command is unchanged.)
  - A release workflow (`.github/workflows/release.yml`) drives versioning via Changesets and publishes to npm with provenance on tag.
  - OSS governance docs added: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
  - The Pi Adapter (`@fil/pi-adapter`) constrains the Pi Agent Runtime to the active Fil Phase (allowedTools / instructions / context / skills) and installs through Pi's native extension channel; `fil init` installs it on detected machines (#14).

### Patch Changes

- Updated dependencies [723d8a6]
- Updated dependencies [ef08e34]
  - @fil/contract@0.1.0
  - @fil/engine@0.1.0
  - @fil/evolution@0.1.0
  - @fil/flow-loader@0.1.0
  - @fil/gate-runner@0.1.0
  - @fil/inspect-view@0.1.0
  - @fil/orchestrator@0.1.0
  - @fil/pi-adapter@0.1.0
  - @fil/store@0.1.0
