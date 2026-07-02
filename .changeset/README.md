# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets). It drives the
semver of every `@fil/*` package and the `fil-cli` meta-package.

## What is a changeset?

A changeset records a single user-facing change. It names the affected packages, the
[SemVer](https://semver.org/) bump type (`patch`, `minor`, or `major`), and a short summary. Files live
as Markdown under `.changeset/` and are committed alongside the change.

## Pick the right bump

Pre-1.0 (where Fil lives today), the rules are:

| Bump | When |
|---|---|
| `patch` | Bug fix, internal refactor, docs — no API change |
| `minor` | Backwards-compatible addition (new verb, new exported type, new CLI flag) |
| `major` | Breaking change to a public API or CLI surface |

Note: under `0.x.y`, `minor` and `major` are both treated as breaking by some tooling (changesets bumps the
*minor* segment for both). Be deliberate: a `major` in `0.x` only signals "breaking", it does not change
the segment above zero. Once Fil hits 1.0, the standard rules apply.

## How do I add a changeset?

Run `pnpm changeset` from the repo root. Pick the affected packages, the bump type, and write a short summary
of the change. A new Markdown file is written to `.changeset/` — commit it alongside the change.

## Internal-dependency coherence

Fil sets `updateInternalDependencies: "patch"` in `.changeset/config.json`. When package **A** (say
`@fil/engine`) bumps, every package that depends on **A** (here `@fil/cli`, `@fil/flow-loader`,
`@fil/store`, `@fil/orchestrator`, and the root `fil`) gets a `patch` bump too. This keeps the published
versions coherent — no `@fil/cli@0.2.0` referencing a phantom `@fil/engine@0.1.0`.

## How do I release?

The release workflow on `main` (`.github/workflows/release.yml`) drives versioning and publishing
automatically:

1. A PR adds a changeset (or many).
2. Push to `main` opens (or updates) a **Version Packages** PR that bumps versions and writes CHANGELOGs.
3. Merging that PR runs `pnpm changeset publish --provenance`, which ships the bumped packages to npm
   with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (OIDC, no `NPM_TOKEN`).

To do a release by hand:

```sh
pnpm install
pnpm build
pnpm version-packages      # bump + CHANGELOG (writes to disk; review and commit)
pnpm release               # pnpm changeset publish --provenance
```

## Pre-releases (alpha / beta)

Fil uses changesets' pre-release mode for `0.x.y-alpha.N` / `0.x.y-beta.N` tags:

```sh
# Enter alpha pre-release mode (subsequent versions get the alpha tag)
pnpm pre-enter alpha
pnpm version-packages
pnpm build
pnpm changeset publish --tag alpha

# Leave pre-release mode when ready to publish a stable
pnpm pre-exit
```

The published tags (`alpha`, `beta`, `latest`) let users opt into pre-releases with
`npm install fil-cli@beta`.