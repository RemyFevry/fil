---
"@color-sunset/fil": patch
---

Add a canonical PR review-status helper + an enforceable anti-overclaim rule
for the master agent, so the "declared clear from a partial check" failure
mode observed on the first orchestration run cannot repeat. Closes #106.

- `scripts/pr-review-status.mjs` (runnable via `node`) — for a given PR,
  queries **all three** CodeRabbit finding locations plus Sonar + CI and
  emits a single `CLEAR` / `BLOCKED (<n> open: …)` line the master quotes
  instead of re-deriving ad-hoc checks. The three locations:
  1. inline review threads (any author) — GraphQL `reviewThreads.isResolved`
     (REST `/pulls/N/comments` is NOT enough — resolution is a
     review-thread property only).
  2. issue-style summary comment — latest `coderabbitai[bot]` comment by
     `updated_at` (CodeRabbit *edits it in place*, so `created_at` is
     stale), classified into `no-actionable` / `has-findings` /
     `walkthrough` / `pre-merge-passed`.
  3. folded sections inside PR review bodies — REST `/pulls/N/reviews`,
     parsed for `🧹 Nitpick comments (N)` + `Actionable comments posted: N`.
     **This is the location the master missed.**
  Plus Sonar Quality Gate state + CI non-SUCCESS count. Anti-overclaim is
  enforced by construction: any source that could not be queried degrades
  to `{ queried: false }` and `summarize()` turns every not-queried source
  into a blocker — `CLEAR` is only reachable when every source was queried
  AND clean.
- `pnpm review-status <pr>` — thin wrapper in `package.json`.
- `scripts/test/pr-review-status.test.ts` — vitest covering
  `parseReviewBody`, `classifySummaryVerdict`, `foldedOnlyCount`, and
  `summarize` with real-shape fixtures (including the folded-nitpick case
  the master overlooked on #102 / #105). Pure-logic only — the network
  layer (`gh api`) is exercised by `pnpm review-status <pr>` against any
  open PR, so CI needs no gh credentials to prove the parser contract.
- `docs/agents/master.md` + `.opencode/agent/master.md` — new
  "Verification hygiene (review sweep + anti-overclaim)" section: the
  master MUST run `pnpm review-status <pr>` and **quote its counts**
  before declaring any PR clear/mergeable/resolved; the anti-overclaim
  clause ("never report clear from a partial check; if a location wasn't
  queried, say so"); the CodeRabbit-is-incremental note; plus a
  pre-approved-temp-path rule (`$TMPDIR/opencode/` — the opencode
  `external_directory` allowlisted subdir) and an atomic-side-effect-safe
  command hygiene rule (no `… || true` on mutations; the redirect hides
  the exit code but not the side effect).
- `docs/agents/feature-loop.md` Step 4 (WAIT) table — correct the
  CodeRabbit row to list all THREE finding locations (it previously said
  only "walkthrough + per-line threads", which is what steered the master
  wrong) + the incremental-review note.