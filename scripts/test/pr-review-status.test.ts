// scripts/test/pr-review-status.test.ts
//
// Unit coverage for the pure logic exported from scripts/pr-review-status.mjs:
//   - parseReviewBody          (location #3 — folded nitpick + counters)
//   - classifySummaryVerdict   (location #2 — latest summary comment)
//   - foldedOnlyCount          (folded-only = total nitpicks − promoted inline)
//   - aggregateFoldedFindings  (Fix 1/4 — bot-filter + headSHA-scope + aggregate)
//   - summarize                (the CLEAR/BLOCKED roll-up + anti-overclaim)
//
// Fixtures use the REAL shape of CodeRabbit output (snipped from observed
// review/summary bodies, with repo-specific prose trimmed). The folded
// nitpick case is the location the master missed on the first orchestration
// run — see issue #106 rationale.
//
// Network layer (gh api shelling) is NOT exercised here; it's covered by
// `pnpm review-status <pr>` against any open PR. Keeping this file pure
// means CI doesn't need gh credentials to prove the parser contract holds.

import { describe, it, expect } from "vitest";
import {
  parseReviewBody,
  classifySummaryVerdict,
  foldedOnlyCount,
  aggregateFoldedFindings,
  summarize,
} from "../pr-review-status.mjs";

// ---------------------------------------------------------------------------
// Fixtures — real-shape CodeRabbit bodies
// ---------------------------------------------------------------------------

// Location #3: a review body with a FOLDED nitpick section. This is the
// exact shape the master missed on #102 and #105 — `Actionable comments
// posted: 1` (promoted to an inline thread) + a folded `🧹 Nitpick comments
// (2)` section holding TWO additional findings that never became threads.
const FOLDED_NITPICK_REVIEW_BODY = [
  "<details>",
  "<summary>🧹 Nitpick comments (2)</summary>",
  "",
  "<blockquote>",
  "<h4><strong>action</strong>: <strong><code>src/cli/run.ts:42</code></strong></h4>",
  "<p>Consider extracting the argv parse into its own function.</p>",
  "</blockquote>",
  "",
  "<blockquote>",
  "<h4><strong>nitpick</strong>: <strong><code>src/cli/run.ts:88-91</code></strong></h4>",
  "<p>Variable name <code>x</code> is too short.</p>",
  "</blockquote>",
  "",
  "</details>",
  "",
  "Actionable comments posted: 1",
  "Nitpick comments posted: 3",
  "",
  "## 🧭 Walkthrough",
  "",
  "The change adds a new CLI verb.",
].join("\n");

// A review body with no folded section — only the inline counters. This is
// the case where every nitpick was promoted to an inline thread (covered
// by location #1), so the folded-only count MUST be 0.
const NO_FOLDED_REVIEW_BODY = [
  "Actionable comments posted: 2",
  "Nitpick comments posted: 2",
  "",
  "## 🧭 Walkthrough",
  "",
  "Minor refactor of the bootstrap script.",
].join("\n");

// Empty / non-CodeRabbit review body — defensive: a non-bot review body
// or a CodeRabbit review that has nothing to report. Must degrade to all
// zeroes, never throw.
const EMPTY_REVIEW_BODY = "";

// A review body whose folded header advertises 3 findings but whose inline
// entries only parse 2 (e.g. a severity label we don't recognize). The
// AUTHORITATIVE count is the header counter, not the parsed-entries list —
// the helper MUST report 3, not 2, so the master doesn't undercount.
const HEADER_MISMATCH_REVIEW_BODY = [
  "<details>",
  "<summary>🧹 Nitpick comments (3)</summary>",
  "",
  "<blockquote>",
  "<h4><strong>nitpick</strong>: <strong><code>a.ts:1</code></strong></h4>",
  "</blockquote>",
  "",
  "<blockquote>",
  "<h4><strong>nitpick</strong>: <strong><code>b.ts:2</code></strong></h4>",
  "</blockquote>",
  "",
  "<blockquote>",
  "<h4><strong>custom-severity</strong>: <strong><code>c.ts:3</code></strong></h4>",
  "</blockquote>",
  "",
  "</details>",
  "",
  "Actionable comments posted: 0",
  "Nitpick comments posted: 3",
].join("\n");

// Location #2: latest CodeRabbit summary-comment bodies, one per verdict.

// `walkthrough` — initial post, before analysis lands. No
// `Actionable comments posted:` line yet.
const WALKTHROUGH_BODY = [
  "## 🧭 Walkthrough",
  "",
  "This PR adds a new helper script under `scripts/`.",
  "",
  "I'll post analysis shortly.",
].join("\n");

// `no-actionable` — the 🎉 explicit-zero line.
const NO_ACTIONABLE_BODY = [
  "## ✅ No actionable comments",
  "",
  "Carefully reviewed the changes — no actionable comments posted. 🎉",
  "",
  "<details><summary>Pre-merge checks</summary>",
  "- ✅ pnpm ci</details>",
].join("\n");

// `has-findings` — analysis complete with a positive actionable counter.
const HAS_FINDINGS_BODY = [
  "## 🧭 Walkthrough",
  "",
  "The change adds a helper.",
  "",
  "Actionable comments posted: 2",
  "Nitpick comments posted: 1",
  "",
  "<details><summary>🛑 Potential issue</summary>",
  "Missing error handling.",
  "</details>",
].join("\n");

// `pre-merge-passed` — terminal summary, posted after `gh pr ready`.
const PRE_MERGE_PASSED_BODY = [
  "## ✅ Pre-merge checks passed",
  "",
  "Actionable comments posted: 0",
  "Nitpick comments posted: 0",
  "",
  "Pre-merge checks: ✅ all green.",
].join("\n");

// ---------------------------------------------------------------------------
// parseReviewBody
// ---------------------------------------------------------------------------

describe("parseReviewBody", () => {
  it("parses the folded nitpick header counter", () => {
    const parsed = parseReviewBody(FOLDED_NITPICK_REVIEW_BODY);
    expect(parsed.foldedNitpickHeader).toBe(2);
    expect(parsed.actionableCommented).toBe(1);
    expect(parsed.nitpickPosted).toBe(3);
  });

  it("extracts file/line/severity for each folded finding", () => {
    const parsed = parseReviewBody(FOLDED_NITPICK_REVIEW_BODY);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]).toEqual({
      severity: "action",
      file: "src/cli/run.ts",
      line: "42",
    });
    expect(parsed.findings[1]).toEqual({
      severity: "nitpick",
      file: "src/cli/run.ts",
      line: "88-91",
    });
  });

  it("returns zero counters and empty findings when there is no folded section", () => {
    const parsed = parseReviewBody(NO_FOLDED_REVIEW_BODY);
    expect(parsed.foldedNitpickHeader).toBeNull();
    expect(parsed.actionableCommented).toBe(2);
    expect(parsed.nitpickPosted).toBe(2);
    expect(parsed.findings).toEqual([]);
  });

  it("returns zero counters and empty findings for an empty / non-CR body", () => {
    const parsed = parseReviewBody(EMPTY_REVIEW_BODY);
    expect(parsed).toEqual({
      actionableCommented: 0,
      nitpickPosted: 0,
      foldedNitpickHeader: null,
      findings: [],
    });
  });

  it("treats non-string input defensively (no throw)", () => {
    // The classifier must never throw on bad input — a thrown error here
    // would abort the whole sweep, which is exactly what the master's
    // fragile one-liners did before issue #106.
    expect(() => parseReviewBody(/** @type {any} */ (null))).not.toThrow();
    expect(() => parseReviewBody(/** @type {any} */ (undefined))).not.toThrow();
    expect(parseReviewBody(/** @type {any} */ (null)).actionableCommented).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// foldedOnlyCount
// ---------------------------------------------------------------------------

describe("foldedOnlyCount", () => {
  it("prefers the authoritative folded-section header counter", () => {
    const parsed = parseReviewBody(FOLDED_NITPICK_REVIEW_BODY);
    // Header says 2 even though actionableCommented=1 was promoted inline.
    expect(foldedOnlyCount(parsed)).toBe(2);
  });

  it("falls back to nitpickPosted - actionableCommented when no header", () => {
    const parsed = parseReviewBody(NO_FOLDED_REVIEW_BODY);
    // 2 nitpickPosted − 2 actionableCommented = 0 folded-only.
    expect(foldedOnlyCount(parsed)).toBe(0);
  });

  it("clamps the fallback to zero (never negative)", () => {
    // Synthesize the case where actionableCommented > nitpickPosted, which
    // shouldn't happen in real CR output but MUST not produce a negative.
    expect(foldedOnlyCount({ foldedNitpickHeader: null, nitpickPosted: 1, actionableCommented: 3, findings: [] })).toBe(0);
  });

  it("reports the header count even when fewer inline entries parsed", () => {
    // The header says 3 but only 2 inline entries matched our severity
    // regex. The MASTER QUOTES 3, not 2 — the header is authoritative.
    const parsed = parseReviewBody(HEADER_MISMATCH_REVIEW_BODY);
    expect(parsed.foldedNitpickHeader).toBe(3);
    expect(parsed.findings).toHaveLength(2);
    expect(foldedOnlyCount(parsed)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// aggregateFoldedFindings — Fix 1 + Fix 4 (headSHA-scoping + bot-filter)
// ---------------------------------------------------------------------------
//
// Raw review objects in the shape `GET /repos/:owner/:repo/pulls/:pr/reviews`
// returns: `{ id, user: { login }, commit_id, body, submitted_at }`. The
// fix scopes folded-findings to the LATEST coderabbitai[bot] review on the
// PR's CURRENT head SHA, so stale reviews from prior pushes don't block
// the PR forever.

const HEAD_SHA = "aaa111aaa111aaa111aaa111aaa111aaa111aaa111";
const STALE_SHA = "bbb222bbb222bbb222bbb222bbb222bbb222bbb222";

// Helper: build a raw review object with the fields aggregateFoldedFindings
// actually inspects. The CODERABBIT_BOT_LOGIN in the implementation is
// "coderabbitai[bot]"; fixtures use that exact string.
function review(opts: {
  id: number;
  login?: string;
  commitId: string;
  body: string;
  submittedAt?: string;
}) {
  return {
    id: opts.id,
    user: { login: opts.login ?? "coderabbitai[bot]" },
    commit_id: opts.commitId,
    submitted_at: opts.submittedAt ?? `2026-01-${opts.id}T00:00:00Z`,
    body: opts.body,
  };
}

// A second folded-nitpick body used to prove STALE reviews are excluded.
// Two folded findings → foldedOnlyCount = 2.
const FOLDED_NITPICK_REVIEW_BODY_2 = [
  "<details>",
  "<summary>🧹 Nitpick comments (2)</summary>",
  "",
  "<blockquote>",
  "<h4><strong>nitpick</strong>: <strong><code>src/other.ts:5</code></strong></h4>",
  "</blockquote>",
  "",
  "<blockquote>",
  "<h4><strong>nitpick</strong>: <strong><code>src/other.ts:10</code></strong></h4>",
  "</blockquote>",
  "",
  "</details>",
  "",
  "Actionable comments posted: 0",
  "Nitpick comments posted: 2",
].join("\n");

describe("aggregateFoldedFindings", () => {
  it("returns open:0 when no reviews match the head SHA (stale-only input)", () => {
    // Every review is on STALE_SHA — none on HEAD_SHA. The PR's folded
    // state is "nothing open on the current head", so open MUST be 0.
    // This is the fix for CodeRabbit follow-up finding #1: aggregating
    // every historical body kept stale nitpicks and blocked forever.
    const reviews = [
      review({ id: 1, commitId: STALE_SHA, body: FOLDED_NITPICK_REVIEW_BODY }),
      review({ id: 2, commitId: STALE_SHA, body: FOLDED_NITPICK_REVIEW_BODY_2 }),
    ];
    expect(aggregateFoldedFindings(reviews, HEAD_SHA)).toEqual({
      open: 0,
      perReview: [],
    });
  });

  it("scopes to the latest coderabbitai review on the current head", () => {
    // Mix: a stale review on STALE_SHA with 2 findings, plus a HEAD review
    // with 2 DIFFERENT findings. Only the HEAD review counts.
    const reviews = [
      review({ id: 1, commitId: STALE_SHA, body: FOLDED_NITPICK_REVIEW_BODY_2 }),
      review({ id: 2, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY }),
    ];
    const result = aggregateFoldedFindings(reviews, HEAD_SHA);
    expect(result.open).toBe(2);
    expect(result.perReview).toHaveLength(1);
    expect(result.perReview[0]?.reviewId).toBe(2);
    expect(result.perReview[0]?.commitId).toBe(HEAD_SHA);
    // The HEAD review's findings, not the stale one's:
    expect(result.perReview[0]?.findings[0]?.file).toBe("src/cli/run.ts");
  });

  it("excludes non-coderabbitai reviews (bot-filter)", () => {
    // A human review on the SAME head with a body that would parse as
    // folded findings — but it's NOT from coderabbitai[bot], so it MUST
    // be excluded. Without this filter, human/other-bot reviews would
    // pollute the folded-findings count.
    const reviews = [
      review({
        id: 1,
        login: "human-reviewer",
        commitId: HEAD_SHA,
        body: FOLDED_NITPICK_REVIEW_BODY,
      }),
      review({ id: 2, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY_2 }),
    ];
    const result = aggregateFoldedFindings(reviews, HEAD_SHA);
    expect(result.open).toBe(2);
    expect(result.perReview).toHaveLength(1);
    expect(result.perReview[0]?.user).toBe("coderabbitai[bot]");
    expect(result.perReview[0]?.reviewId).toBe(2);
  });

  it("takes the LATEST coderabbitai review when multiple match the head", () => {
    // Two coderabbitai reviews on the same HEAD SHA. REST returns them in
    // chronological order (oldest first); the LAST match is the latest.
    // We take only the latest — a re-post supersedes the prior analysis.
    const reviews = [
      review({ id: 1, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY }),
      review({ id: 2, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY_2 }),
    ];
    const result = aggregateFoldedFindings(reviews, HEAD_SHA);
    expect(result.perReview).toHaveLength(1);
    expect(result.perReview[0]?.reviewId).toBe(2); // latest wins
    expect(result.perReview[0]?.findings[0]?.file).toBe("src/other.ts");
  });

  it("returns open:0 when the matching review has no folded section", () => {
    // The head review exists and is from coderabbitai, but its body has
    // no folded nitpicks (every finding was promoted to an inline thread
    // → covered by location #1). folded-only count is 0.
    const reviews = [
      review({ id: 1, commitId: HEAD_SHA, body: NO_FOLDED_REVIEW_BODY }),
    ];
    expect(aggregateFoldedFindings(reviews, HEAD_SHA)).toEqual({
      open: 0,
      perReview: [],
    });
  });

  it("returns open:0 when the matching review body is empty", () => {
    const reviews = [
      review({ id: 1, commitId: HEAD_SHA, body: EMPTY_REVIEW_BODY }),
    ];
    expect(aggregateFoldedFindings(reviews, HEAD_SHA)).toEqual({
      open: 0,
      perReview: [],
    });
  });

  it("is defensive: returns open:0 on non-array input or missing headSha", () => {
    // The pure helper must NEVER throw on bad input — a thrown error here
    // would abort the whole sweep. Same defensive contract as parseReviewBody.
    expect(() => aggregateFoldedFindings(/** @type {any} */ (null), HEAD_SHA)).not.toThrow();
    expect(() => aggregateFoldedFindings(/** @type {any} */ (undefined), HEAD_SHA)).not.toThrow();
    expect(aggregateFoldedFindings(/** @type {any} */ (null), HEAD_SHA)).toEqual({
      open: 0,
      perReview: [],
    });
    expect(
      aggregateFoldedFindings(
        [review({ id: 1, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY })],
        /** @type {any} */ (""),
      ),
    ).toEqual({ open: 0, perReview: [] });
    expect(
      aggregateFoldedFindings(
        [review({ id: 1, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY })],
        /** @type {any} */ (undefined),
      ),
    ).toEqual({ open: 0, perReview: [] });
  });

  it("each invocation is fresh (no shared state between calls)", () => {
    // Pure contract: calling twice with the same input must produce the
    // same result. A stale-closure bug would make the second call return
    // a mutated/different value.
    const reviews = [
      review({ id: 1, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY }),
    ];
    const a = aggregateFoldedFindings(reviews, HEAD_SHA);
    const b = aggregateFoldedFindings(reviews, HEAD_SHA);
    expect(a).toEqual(b);
    expect(a.open).toBe(2);
  });

  it("excludes reviews whose commit_id is null/undefined (defensive)", () => {
    // A malformed review object (missing commit_id) must NOT match even
    // if headSha somehow equals "null" or "undefined" as a string.
    const reviews = [
      { id: 1, user: { login: "coderabbitai[bot]" }, commit_id: undefined, body: FOLDED_NITPICK_REVIEW_BODY },
      { id: 2, user: { login: "coderabbitai[bot]" }, commit_id: null, body: FOLDED_NITPICK_REVIEW_BODY },
      review({ id: 3, commitId: HEAD_SHA, body: FOLDED_NITPICK_REVIEW_BODY_2 }),
    ];
    const result = aggregateFoldedFindings(/** @type {any} */ (reviews), HEAD_SHA);
    expect(result.perReview).toHaveLength(1);
    expect(result.perReview[0]?.reviewId).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// classifySummaryVerdict
// ---------------------------------------------------------------------------

describe("classifySummaryVerdict", () => {
  it("classifies a pre-merge summary as pre-merge-passed", () => {
    expect(classifySummaryVerdict(PRE_MERGE_PASSED_BODY)).toBe("pre-merge-passed");
  });

  it("classifies the explicit-zero line as no-actionable", () => {
    expect(classifySummaryVerdict(NO_ACTIONABLE_BODY)).toBe("no-actionable");
  });

  it("classifies a positive actionable counter as has-findings", () => {
    expect(classifySummaryVerdict(HAS_FINDINGS_BODY)).toBe("has-findings");
  });

  it("classifies a walkthrough-only body as walkthrough", () => {
    expect(classifySummaryVerdict(WALKTHROUGH_BODY)).toBe("walkthrough");
  });

  it("falls back to walkthrough for an unrecognized / empty body", () => {
    // Empty body = analysis not yet posted. The master must NOT declare
    // clear on a walkthrough verdict, so this is the safe fallback.
    expect(classifySummaryVerdict("")).toBe("walkthrough");
    expect(classifySummaryVerdict("random prose with no CR markers")).toBe("walkthrough");
  });

  it("prefers pre-merge over no-actionable when both markers are present", () => {
    // The terminal pre-merge summary ALSO carries the zero-actionable line;
    // the terminal state wins because it's what the master should act on.
    expect(classifySummaryVerdict(PRE_MERGE_PASSED_BODY)).toBe("pre-merge-passed");
  });

  it("treats an explicit `Actionable comments posted: 0` as no-actionable", () => {
    // Some CR bodies say "0" without the 🎉 wording — the counter alone
    // should still classify as no-actionable.
    const body = [
      "## 🧭 Walkthrough",
      "",
      "Actionable comments posted: 0",
    ].join("\n");
    expect(classifySummaryVerdict(body)).toBe("no-actionable");
  });

  it("does not throw on non-string input", () => {
    expect(() => classifySummaryVerdict(/** @type {any} */ (null))).not.toThrow();
    expect(() => classifySummaryVerdict(/** @type {any} */ (undefined))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// summarize — the anti-overclaim roll-up
// ---------------------------------------------------------------------------

describe("summarize", () => {
  const allClear = {
    threads: { queried: true, unresolved: 0 },
    folded: { queried: true, open: 0 },
    summary: { queried: true, verdict: "no-actionable" },
    sonar: { queried: true, state: "PASSED" },
    ci: { queried: true, nonSuccess: 0 },
  };

  it("returns CLEAR when every source is queried + clean", () => {
    expect(summarize(allClear)).toMatchObject({
      clear: true,
      blockers: [],
      missing: [],
    });
  });

  it("returns CLEAR with a pre-merge-passed summary verdict too", () => {
    expect(summarize({ ...allClear, summary: { queried: true, verdict: "pre-merge-passed" } }).clear).toBe(true);
  });

  it("blocks on unresolved threads (location #1)", () => {
    const v = summarize({
      ...allClear,
      threads: { queried: true, unresolved: 2 },
    });
    expect(v.clear).toBe(false);
    expect(v.blockers).toContain("unresolved-threads: 2");
  });

  it("blocks on folded-only findings (location #3 — the one the master missed)", () => {
    const v = summarize({
      ...allClear,
      folded: { queried: true, open: 2 },
    });
    expect(v.clear).toBe(false);
    expect(v.blockers).toContain("folded-findings: 2");
  });

  it("blocks on a has-findings summary verdict", () => {
    const v = summarize({
      ...allClear,
      summary: { queried: true, verdict: "has-findings" },
    });
    expect(v.clear).toBe(false);
    expect(v.blockers).toContain("summary-verdict: has-findings");
  });

  it("blocks on a walkthrough summary verdict (analysis pending)", () => {
    const v = summarize({
      ...allClear,
      summary: { queried: true, verdict: "walkthrough" },
    });
    expect(v.clear).toBe(false);
    expect(v.blockers).toContain("summary-verdict: walkthrough");
  });

  it("blocks on a FAILED Sonar QG", () => {
    const v = summarize({
      ...allClear,
      sonar: { queried: true, state: "FAILED" },
    });
    expect(v.clear).toBe(false);
    expect(v.blockers).toContain("sonar: FAILED");
  });

  it("blocks on a non-SUCCESS CI check (incl. PENDING)", () => {
    const v = summarize({
      ...allClear,
      ci: { queried: true, nonSuccess: 1 },
    });
    expect(v.clear).toBe(false);
    expect(v.blockers).toContain("ci-non-success: 1");
  });

  // Anti-overclaim: the headline rule from issue #106. A not-queried source
  // is itself a blocker — the helper refuses to declare CLEAR from a partial
  // sweep. "I checked 2 of 3 places" must never print CLEAR.
  it("blocks when ANY source was not queried (anti-overclaim)", () => {
    const v = summarize({
      ...allClear,
      sonar: { queried: false, state: "UNKNOWN" },
    });
    expect(v.clear).toBe(false);
    expect(v.missing).toContain("sonar");
    expect(v.blockers.some((b) => b.startsWith("not-queried"))).toBe(true);
  });

  it("blocks when ALL locations are not queried", () => {
    const v = summarize({
      threads: { queried: false, unresolved: 0 },
      folded: { queried: false, open: 0 },
      summary: { queried: false, verdict: "walkthrough" },
      sonar: { queried: false, state: "UNKNOWN" },
      ci: { queried: false, nonSuccess: 0 },
    });
    expect(v.clear).toBe(false);
    expect(v.missing).toHaveLength(5);
  });

  it("reports every blocker, not just the first", () => {
    const v = summarize({
      threads: { queried: true, unresolved: 1 },
      folded: { queried: true, open: 2 },
      summary: { queried: true, verdict: "has-findings" },
      sonar: { queried: false, state: "UNKNOWN" },
      ci: { queried: true, nonSuccess: 3 },
    });
    expect(v.clear).toBe(false);
    expect(v.blockers).toHaveLength(5);
    expect(v.missing).toEqual(["sonar"]);
  });
});
