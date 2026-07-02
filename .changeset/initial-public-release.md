---
"fil-cli": minor
"@fil/cli": minor
"@fil/contract": minor
"@fil/engine": minor
"@fil/evolution": minor
"@fil/flow-loader": minor
"@fil/gate-runner": minor
"@fil/inspect-view": minor
"@fil/orchestrator": minor
"@fil/store": minor
---

Initial public release.

- All `@fil/*` packages and the `fil-cli` meta-package are now publishable to npm under the MIT license.
- `fil-cli` ships a `bin: fil` entry, so `npm install -g fil-cli` and `npx fil-cli` work post-install. (The `fil` name itself was already taken on npm by an unrelated static-site generator, so the meta-package is `fil-cli` while the `fil` command is unchanged.)
- A release workflow (`.github/workflows/release.yml`) drives versioning via Changesets and publishes to npm with provenance on tag.
- OSS governance docs added: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.