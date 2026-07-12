// scripts/test/pr-review-status.test.ts
//
// Unit coverage for the pure logic exported from scripts/pr-review-status.mjs:
//   - parseReviewBody        (location #3 — folded nitpick + counters)
//   - classifySummaryVerdict (location #2 — latest summary comment)
//   - foldedOnlyCount        (folded-only = total nitpicks − promoted inline)
//   - summarize              (the CLEAR/BLOCKED roll-up + anti-overclaim)
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
