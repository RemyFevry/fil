---
"fil": minor
"@fil/cli": minor
"@fil/contract": minor
"@fil/engine": minor
"@fil/evolution": minor
"@fil/flow-loader": minor
"@fil/gate-runner": minor
"@fil/inspect-view": minor
"@fil/orchestrator": minor
"@fil/pi-adapter": minor
"@fil/store": minor
---

Initial public release.

- All `@fil/*` packages and the `fil` meta-package are now publishable to npm under the MIT license.
- `fil` ships a `bin: fil` entry, so `npm install -g fil` and `npx fil` work post-install.
- A release workflow (`.github/workflows/release.yml`) drives versioning via Changesets and publishes to npm with provenance on tag.
- OSS governance docs added: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- The Pi Adapter (`@fil/pi-adapter`) constrains the Pi Agent Runtime to the active Fil Phase (allowedTools / instructions / context / skills) and installs through Pi's native extension channel; `fil init` installs it on detected machines (#14).
