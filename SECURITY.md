# Security policy

Fil takes the security of its users seriously. This document explains how to
report a vulnerability, what to expect, and which versions of Fil receive
security updates.

## Supported versions

Fil is pre-1.0 and under active development (see the
[Status section of the README](./README.md#status)). Until 1.0, the latest
release published to npm is the only version that receives security updates.
We may also backport critical fixes to the previous minor on a best-effort
basis.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Reporting a vulnerability

**Please do not file a public GitHub issue for security vulnerabilities.**

Report privately to the maintainers using GitHub's private vulnerability
reporting:

1. Go to <https://github.com/RemyFevry/fil/security/advisories/new>.
2. Fill in the advisory form with the affected package(s), a reproduction, and
   the impact.

If you can't use GitHub's advisory form, open a regular issue titled
`security: private contact requested` and a maintainer will reach out with an
encrypted channel. Do **not** include exploit details in that issue.

## What to expect

- **Acknowledgement** within 3 business days.
- **Triage** within 5 business days: we confirm reproduction, assess impact,
  and agree on a fix timeline.
- **Coordinated disclosure**: we aim to ship a fix and a public advisory
  within 90 days of confirmation. We may delay the disclosure at your request
  if a coordinated release is in flight, and we will tell you when we expect
  to publish.
- **Credit**: by default we'll credit you in the public advisory unless you
  ask to remain anonymous.

## Scope

In scope:

- Code under `packages/*/src` and the shipped `fil` CLI (the npm package
  `@color-sunset/fil` and any `@color-sunset/fil-*` package).
- The release workflow (`.github/workflows/release.yml`) and the publishing
  pipeline.
- The default Flows shipped under `@color-sunset/fil-engine/flows` (`default`, `hotfix`).

Out of scope:

- Adapters distributed through Agent Runtime native channels (Claude Code
  marketplace, Pi extensions). Report those to the upstream runtime.
- Issues in dependencies of Fil — please report them upstream to the
  dependency's maintainers.

## Preferred languages

English. We're a small team; we'll do our best with other languages, but
reports in English get the fastest response.

## Acknowledgements

This policy is loosely modeled on the [GitHub security policy template][gh]
and the [npm security best practices][npm].

[gh]: https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository
[npm]: https://docs.npmjs.com/policies/security
