---
"@color-sunset/fil": patch
---

Widen `pnpm lint:md` from `README.md`-only to **all repo markdown**, and fix
the violations the wider scope surfaces. Closes #97. Closes #98.

- `.markdownlint-cli2.jsonc`: globs `["README.md"]` → `["**/*.md"]`.
- Excludes generated/transient markdown so the gate doesn't fight tooling:
  `**/CHANGELOG.md` (changeset-generated) and `.changeset/**/*.md` (throwaway
  entries).
- Excludes `CODE_OF_CONDUCT.md` to keep the upstream Contributor Covenant
  **verbatim** — chosen over in-place edits so future Covenant updates merge
  cleanly. Flagged per the #98 acceptance criterion.
- `lefthook.yml:5`: stale comment "markdownlint-cli2 on README.md" →
  "markdownlint-cli2 on all repo markdown (project-wide globs)".
- Fixes all 58 surfaced violations (re-measured live; #98's baseline was 57 —
  the 3 `master.md` files under `.claude/`, `.opencode/`, `.pi/` were added in
  the `master-agent definition` commit after the baseline). Rules fixed:
  MD049 emphasis style (asterisk), MD034 bare URLs (`<…>`), MD047 trailing
  newline, MD022/MD032/MD031 blanks around headings/lists/fences, MD004
  list-marker (`-`), MD040 fenced-code-language. No `markdownlint-disable*`
  directives were added.
