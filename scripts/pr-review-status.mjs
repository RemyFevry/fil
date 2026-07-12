// scripts/pr-review-status.mjs
//
// Canonical PR review-status helper. Reports the FULL set of CodeRabbit
// finding locations + Sonar + CI for a PR and prints a single
// `CLEAR` / `BLOCKED (<n> open: ...)` bottom line the master agent quotes
// verbatim instead of re-deriving ad-hoc checks.
//
// Why this exists (issue #106): the master agent declared PRs "all clear"
// twice from PARTIAL verification. CodeRabbit posts findings in THREE
// places, and ad-hoc checks only covered two:
//
//   1. inline review threads         — REST /pulls/N/comments + GraphQL
//      reviewThreads.isResolved
//   2. issue-style summary comment   — REST /issues/N/comments, latest
//      coderabbitai[bot] comment (NOTE: edited in place → use updated_at)
//   3. folded sections inside PR     — REST /pulls/N/reviews, each body
//      contains <details><summary>🧹 Nitpick comments (N)</summary> and
//      "Actionable comments posted: N" sections. Location #3 is what the
//      master missed.
//
// Usage:
//   pnpm review-status <pr>                 # repo auto-detected from git remote
//   node scripts/pr-review-status.mjs <pr>  # same, but explicit
//   REVIEW_STATUS_REPO=owner/name pnpm review-status <pr>
//
// Exit codes: 0 = CLEAR, 1 = BLOCKED, 2 = usage / lookup error.
//
// Network layer: shells out to `gh api` (the repo's existing convention).
// Pure logic (`parseReviewBody`, `classifySummaryVerdict`, `summarize`) is
// exported so the vitest in scripts/test/pr-review-status.test.ts can pin
// it down without hitting the network.

import { execFileSync } from "node:child_process";
import process, { exit } from "node:process";
import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// CodeRabbit EDITS its summary comment in place, so created_at is stale and
// updated_at + current body are what we classify against.
const CODERABBIT_BOT_LOGIN = "coderabbitai[bot]";
const SONAR_BOT_LOGIN = "sonarcloud[bot]";

// Substrings that appear in the latest CodeRabbit summary comment body,
// mapped to their verdict. Order matters only inside `classifySummaryVerdict`
// (see below); this table exists so the test fixtures and the implementation
// agree on what each verdict LOOKS like.
const VERDICT_PATTERNS = {
  // Terminal pre-merge summary: the heading-line "Pre-merge checks passed"
  // (with explicit completion marker). The looser "pre-merge checks" string
  // also appears INSIDE non-terminal analysis summaries as a folded
  // <details> section — requiring `passed | succeeded | green | ✅` next
  // to it rules those out.
  preMergePassed: /pre-merge checks?\s+(?:passed|succeeded|green|✅)/i,
  // Analysis complete with zero actionable findings.
  noActionable: /no actionable comments/i,
  // Walkthrough-only: posted before analysis lands. Has no
  // "Actionable comments posted:" line yet.
  walkthrough: /^## (Walkthrough|🧭)/m,
};

// `Actionable comments posted: N` and `Nitpick comments posted: N` are the
// two summary counters CodeRabbit prints at the top of review bodies.
const RE_ACTIONABLE_COUNT = /Actionable comments posted:\s*(\d+)/i;
const RE_NITPICK_COUNT_LINE = /Nitpick comments posted:\s*(\d+)/i;
// Folded nitpick header: <summary>🧹 Nitpick comments (3)</summary>.
const RE_FOLDED_NITPICK_HEADER = /Nitpick comments\s*\((\d+)\)/;

// ---------------------------------------------------------------------------
// Pure logic (exported, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Parse a single CodeRabbit review body for its folded findings section.
 *
 * A review body looks like:
 *
 * ```text
 * <details>
 * <summary>🧹 Nitpick comments (3)</summary>
 * ...
 * Actionable comments posted: 2
 * Nitpick comments posted: 3
 * ```
 *
 * Returns a record with:
 *   - `actionableCommented`: counter from "Actionable comments posted: N"
 *   - `nitpickPosted`: counter from "Nitpick comments posted: N"
 *   - `foldedNitpickHeader`: counter inside the `🧹 Nitpick comments (N)`
 *     summary line (null if no folded section is present)
 *   - `findings`: loose list of inline finding entries we could extract
 *     from the folded section (file / line / severity / snippet). Empty
 *     when no folded section is present.
 *
 * Both counters are returned because they answer different questions:
 * `actionableCommented` is what CodeRabbit promoted to inline threads;
 * `nitpickPosted` is the folded-only count. Location #3 (the one the master
 * missed) is the folded-only count — actionable threads ALSO show up under
 * `/pulls/N/comments` (location #1), but folded-only nitpicks do NOT.
 */
export function parseReviewBody(body) {
  if (typeof body !== "string" || body.length === 0) {
    return {
      actionableCommented: 0,
      nitpickPosted: 0,
      foldedNitpickHeader: null,
      findings: [],
    };
  }

  const actionableMatch = body.match(RE_ACTIONABLE_COUNT);
  const nitpickMatch = body.match(RE_NITPICK_COUNT_LINE);
  const foldedMatch = body.match(RE_FOLDED_NITPICK_HEADER);

  const findings = parseFindings(body);

  return {
    actionableCommented: actionableMatch ? Number(actionableMatch[1]) : 0,
    nitpickPosted: nitpickMatch ? Number(nitpickMatch[1]) : 0,
    foldedNitpickHeader: foldedMatch ? Number(foldedMatch[1]) : null,
    findings,
  };
}

/**
 * Extract individual folded nitpick entries from a review body.
 *
 * CodeRabbit renders each folded finding as a heading line followed by a
 * blockquote body. The heading looks like one of:
 *
 * ```text
 * <strong>action</strong>: <strong><code>path/to/file.ts:42</code></strong>
 * <strong>nitpick</strong>: <strong><code>src/foo.ts:10-12</code></strong>
 * ```
 *
 * We surface every finding we can locate (file / line range / severity /
 * surrounding text), but the COUNT is the contract the master quotes —
 * missing a single finding's prose does NOT undercount, because
 * `foldedNitpickHeader` is the authoritative counter. The findings list is
 * a human-readability bonus in the report.
 *
 * @param {string} body
 */
function parseFindings(body) {
  const findings = [];
  // Match either `action` / `nitpick` / `suggestion` severity labels.
  const findingRe =
    /<strong>(action|nitpick|suggestion|warning|critical)<\/strong>:\s*<strong><code>([^<]+?):(\d+(?:-\d+)?)<\/code><\/strong>/gi;
  let m;
  while ((m = findingRe.exec(body)) !== null) {
    findings.push({
      severity: m[1].toLowerCase(),
      file: m[2],
      line: m[3],
    });
  }
  return findings;
}

/**
 * Classify the LATEST CodeRabbit summary-comment body (issue-style comment,
 * fetched by `updated_at` not `created_at` because CodeRabbit edits it in
 * place). Returns one of:
 *
 *   - `pre-merge-passed` — final pre-merge summary, posted after ready.
 *   - `no-actionable` — analysis complete, zero actionable findings.
 *   - `has-findings` — analysis complete with actionable findings.
 *   - `walkthrough` — only the initial walkthrough is up (no analysis yet).
 *
 * Priority: pre-merge → no-actionable → has-findings → walkthrough. The
 * pre-merge state wins because it's the final edit and also carries the
 * actionable verdict inside it; surfacing it as `pre-merge-passed` lets the
 * master distinguish "ready to merge" from "still analyzing".
 *
 * @param {string} body
 * @returns {"pre-merge-passed" | "no-actionable" | "has-findings" | "walkthrough"}
 */
export function classifySummaryVerdict(body) {
  if (typeof body !== "string" || body.length === 0) {
    return "walkthrough";
  }

  // Pre-merge summary is the terminal state.
  if (VERDICT_PATTERNS.preMergePassed.test(body)) {
    return "pre-merge-passed";
  }

  // Explicit zero actionable — the 🎉 line.
  if (VERDICT_PATTERNS.noActionable.test(body)) {
    return "no-actionable";
  }

  // Actionable counter line is present — analysis has landed.
  const actionableMatch = body.match(RE_ACTIONABLE_COUNT);
  if (actionableMatch) {
    return Number(actionableMatch[1]) > 0 ? "has-findings" : "no-actionable";
  }

  // No actionable line yet — initial walkthrough only.
  if (VERDICT_PATTERNS.walkthrough.test(body)) {
    return "walkthrough";
  }

  // Fallback: no recognizable marker. Treat as walkthrough (analysis
  // pending) — the safe direction, since the master will not declare clear
  // on a walkthrough verdict.
  return "walkthrough";
}

/**
 * Reduce a parsed review body to the single number the master quotes for
 * location #3 (folded findings). This is the folded-only count: nitpicks
 * that did NOT get promoted to an inline thread. The authoritative source
 * is the folded-section header counter; if that's missing we fall back to
 * `nitpickPosted - actionableCommented` (clamped at 0), which matches the
 * CodeRabbit invariant "folded-only = total nitpicks − promoted to inline".
 *
 * @param {ReturnType<typeof parseReviewBody>} parsed
 */
export function foldedOnlyCount(parsed) {
  if (parsed.foldedNitpickHeader !== null) {
    return parsed.foldedNitpickHeader;
  }
  return Math.max(0, parsed.nitpickPosted - parsed.actionableCommented);
}

/**
 * Aggregate folded findings from the raw `/pulls/N/reviews` response,
 * scoped to the latest CodeRabbit review on the PR's CURRENT head SHA.
 *
 * Why head-scoping is mandatory: `/pulls/N/reviews` returns HISTORICAL
 * review bodies. CodeRabbit posts a fresh review on every push, so a
 * long-lived PR accumulates stale reviews from prior commits whose
 * nitpicks may already be fixed. Aggregating every body would keep those
 * stale nitpicks in `folded-findings` and BLOCK the PR forever — the
 * partial-sweep failure mode this tool exists to catch. We restrict to
 * reviews where BOTH:
 *   - `user.login === "coderabbitai[bot]"` (bot filter — humans + other
 *     bots post reviews too)
 *   - `commit_id === headSha` (head-scope — only the current push's
 *     reviews count)
 *
 * Among the matching reviews we take the LATEST (the REST endpoint
 * returns reviews in chronological order, so the last match wins). This
 * matches CodeRabbit's real-world invariant: one analysis review per
 * commit; a second match on the same commit would be a `@coderabbitai
 * review` re-post that supersedes the first.
 *
 * PURE: no network, no I/O, fresh state per call. Tested in
 * scripts/test/pr-review-status.test.ts.
 *
 * @param {Array<{ id?: number, user?: { login?: string }, commit_id?: string, body?: string }>} reviews
 *   Raw review objects from `GET /repos/:owner/:repo/pulls/:pr/reviews`.
 * @param {string} headSha The PR's current head commit SHA (`pr.head.sha`).
 * @returns {{ open: number, perReview: Array<{ reviewId: number|null, user: string, commitId: string, count: number, findings: Array<{severity:string,file:string,line:string}> }> }}
 */
export function aggregateFoldedFindings(reviews, headSha) {
  if (!Array.isArray(reviews) || typeof headSha !== "string" || headSha.length === 0) {
    return { open: 0, perReview: [] };
  }

  const matching = reviews.filter(
    (r) =>
      r?.user?.login === CODERABBIT_BOT_LOGIN &&
      typeof r?.commit_id === "string" &&
      r.commit_id === headSha &&
      typeof r?.body === "string" &&
      r.body.length > 0,
  );

  // REST returns reviews in chronological order (oldest first); the LAST
  // match is the latest CodeRabbit review on the current head.
  const latest = matching[matching.length - 1];
  if (!latest) {
    return { open: 0, perReview: [] };
  }

  const parsed = parseReviewBody(latest.body ?? "");
  const count = foldedOnlyCount(parsed);
  if (count === 0) {
    return { open: 0, perReview: [] };
  }
  return {
    open: count,
    perReview: [
      {
        reviewId: latest.id ?? null,
        user: latest.user?.login ?? "(unknown)",
        commitId: latest.commit_id ?? headSha,
        count,
        findings: parsed.findings,
      },
    ],
  };
}

/**
 * Roll up every source into the final verdict the master quotes.
 *
 * `CLEAR` requires: zero unresolved threads (any author), zero folded-only
 * findings, summary verdict in {no-actionable, pre-merge-passed}, Sonar QG
 * PASSED, and zero non-SUCCESS CI checks. ANY source that was not queried
 * (e.g. Sonar not configured on the repo) must force `BLOCKED` — that's the
 * anti-overclaim guarantee, and it's why the per-source `queried` flag is
 * surfaced in the report.
 *
 * @param {{
 *   threads: { queried: boolean, unresolved: number },
 *   folded: { queried: boolean, open: number },
 *   summary: { queried: boolean, verdict: string },
 *   sonar: { queried: boolean, state: "PASSED" | "FAILED" | "UNKNOWN" },
 *   ci: { queried: boolean, nonSuccess: number },
 * }} sources
 */
export function summarize(sources) {
  const blockers = [];
  const missing = [];

  const pushBlocker = (label, count) => {
    if (count > 0) blockers.push(`${label}: ${count}`);
  };
  const pushMissing = (label) => missing.push(label);

  if (!sources.threads.queried) pushMissing("unresolved-threads");
  else pushBlocker("unresolved-threads", sources.threads.unresolved);

  if (!sources.folded.queried) pushMissing("folded-findings");
  else pushBlocker("folded-findings", sources.folded.open);

  if (!sources.summary.queried) pushMissing("summary-verdict");
  else if (
    sources.summary.verdict !== "no-actionable" &&
    sources.summary.verdict !== "pre-merge-passed"
  ) {
    blockers.push(`summary-verdict: ${sources.summary.verdict}`);
  }

  if (!sources.sonar.queried) pushMissing("sonar");
  else if (sources.sonar.state !== "PASSED") {
    blockers.push(`sonar: ${sources.sonar.state}`);
  }

  if (!sources.ci.queried) pushMissing("ci");
  else pushBlocker("ci-non-success", sources.ci.nonSuccess);

  // Anti-overclaim: a not-queried source is itself a blocker — we refuse
  // to declare CLEAR from a partial sweep.
  if (missing.length > 0) {
    blockers.push(`not-queried: ${missing.join(", ")}`);
  }

  return {
    clear: blockers.length === 0,
    blockers,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Network layer (`gh api`)
// ---------------------------------------------------------------------------

/**
 * Run `gh api <path>` and return parsed JSON. Throws on non-zero exit so
 * the caller can catch + downgrade to a not-queried source rather than
 * crashing the whole sweep (anti-overclaim: a failed lookup is reported
 * as missing, never silently skipped).
 *
 * @param {string} path
 * @param {string[]} [extraArgs]
 * @returns {unknown}
 */
function ghApi(path, extraArgs = []) {
  const stdout = execFileSync(
    "gh",
    ["api", "-H", "Accept: application/vnd.github+json", path, ...extraArgs],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

/**
 * Paginate a REST collection to completion via `?page=N`. Without this,
 * any collection capped at 100 items silently drops the tail — the
 * exact partial-sweep failure mode this tool exists to prevent (e.g. a
 * PR with 100+ review threads would undercount unresolved threads).
 *
 * Uses page-number pagination (GitHub REST supports `?page=N` on every
 * collection) rather than Link-header traversal, because it's simpler to
 * reason about and test. Stops on the first short/empty page. Safety
 * valve at 50 pages (5000 items) guards against a misbehaving endpoint.
 *
 * @param {string} path REST collection path (with or without query string).
 * @returns {unknown[]} Combined array of every page's items.
 */
function ghApiPage(path) {
  const sep = path.includes("?") ? "&" : "?";
  const base = path.includes("per_page=") ? path : `${path}${sep}per_page=100`;
  const all = /** @type {unknown[]} */ ([]);
  for (let page = 1; page <= 50; page++) {
    /** @type {unknown} */
    let batch;
    try {
      batch = ghApi(`${base}&page=${page}`);
    } catch {
      // A failed page lookup is anti-overclaim'd by the caller's tryQuery
      // wrapper → `queried: false` → BLOCKED. We stop paginating here so
      // the sweep can degrade honestly rather than silently partial-fetch.
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break; // last page
  }
  return all;
}

/**
 * Run a GraphQL query against the GitHub API. Null/undefined variables are
 * OMITTED (not sent as `--field key=null`) so GraphQL nullable inputs
 * default server-side — required for cursor pagination where `$after` is
 * null on the first page and a cursor string thereafter.
 *
 * @param {string} query
 * @param {Record<string, unknown>} variables
 */
function ghGraphql(query, variables) {
  const fieldArgs = Object.entries(variables).flatMap(([k, v]) => {
    if (v === null || v === undefined) return [];
    return ["--field", `${k}=${String(v)}`];
  });
  const stdout = execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-H",
      "Accept: application/vnd.github+json",
      "--field",
      `query=${query}`,
      ...fieldArgs,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

/**
 * Detect `owner/repo` from the local git remote. Overridable via
 * REVIEW_STATUS_REPO so the master can sweep a fork's PR without checking
 * it out.
 *
 * @returns {string}
 */
function detectRepo() {
  const override = process.env.REVIEW_STATUS_REPO;
  if (override && override.includes("/")) return override;
  const url = execFileSync(
    "git",
    ["config", "--get", "remote.origin.url"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  // Accept both git@...:owner/repo.git and https://.../owner/repo.git.
  const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`could not parse owner/repo from remote: ${url}`);
  }
  return `${match[1]}/${match[2]}`;
}

/**
 * Count unresolved review threads via GraphQL `reviewThreads.isResolved`.
 * Uses GraphQL (not REST /pulls/comments) because REST has no resolved-flag
 * field — resolution is a review-thread property only.
 *
 * PAGINATION: `reviewThreads(first: 100)` is capped at 100 per page. A PR
 * with >100 threads would silently undercount without cursor traversal
 * (`pageInfo.hasNextPage` / `endCursor`). We loop until exhausted, then
 * decorate + filter the combined set.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} pr
 * @returns {{ queried: boolean, unresolved: number, threads: Array<{ author: string, isResolved: boolean, path: string|null }> }}
 */
function fetchUnresolvedThreads(owner, repo, pr) {
  // GraphQL is the ONLY surface that exposes `isResolved`. REST
  // `/pulls/N/comments` returns every inline comment regardless of
  // resolution state, so we cannot detect "still open" from REST alone.
  const query = `
    query ReviewStatus($owner: String!, $repo: String!, $pr: Int!, $after: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100, after: $after) {
            nodes {
              isResolved
              author { login }
              path
              comments(first: 1) { nodes { author { login } } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }`.replace(/\s+/g, " ");

  const allNodes = /** @type {any[]} */ ([]);
  let cursor = null;
  for (;;) {
    const data = /** @type {any} */ (ghGraphql(query, { owner, repo, pr, after: cursor }));
    const rt = data?.data?.repository?.pullRequest?.reviewThreads;
    if (!rt) break;
    allNodes.push(...(rt.nodes ?? []));
    if (!rt.pageInfo?.hasNextPage || !rt.pageInfo?.endCursor) break;
    cursor = rt.pageInfo.endCursor;
  }

  const decorated = allNodes.map((t) => ({
    isResolved: !!t.isResolved,
    author:
      t.comments?.nodes?.[0]?.author?.login ??
      t.author?.login ??
      "(unknown)",
    path: t.path ?? null,
  }));
  const unresolved = decorated.filter((t) => !t.isResolved);
  return { queried: true, unresolved: unresolved.length, threads: unresolved };
}

/**
 * Fetch all PR review bodies and aggregate the folded-finding count for
 * the LATEST CodeRabbit review on the PR's CURRENT head SHA.
 *
 * Location #3 — the one the master missed. `/pulls/N/reviews` returns
 * HISTORICAL reviews; without head-SHA scoping, stale nitpicks from prior
 * pushes would block the PR forever. We fetch the PR's head SHA, paginate
 * the reviews collection to completion (>100 possible on long-lived PRs),
 * and delegate to `aggregateFoldedFindings` for the bot-filter +
 * head-scope + parse.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} pr
 */
function fetchFoldedFindings(owner, repo, pr) {
  // Get the PR's current head SHA from the PR object (REST pulls endpoint).
  // Without this we cannot head-scope — every historical review body would
  // be aggregated and stale nitpicks from prior pushes would block forever.
  const prData = /** @type {any} */ (ghApi(`/repos/${owner}/${repo}/pulls/${pr}`));
  const headSha = prData?.head?.sha;
  if (typeof headSha !== "string" || headSha.length === 0) {
    // No head SHA → can't head-scope → refuse to report (anti-overclaim).
    return { queried: false, open: 0, perReview: [] };
  }

  const reviews = /** @type {any[]} */ (ghApiPage(
    `/repos/${owner}/${repo}/pulls/${pr}/reviews`,
  ));
  const { open, perReview } = aggregateFoldedFindings(reviews, headSha);
  return { queried: true, open, perReview };
}

/**
 * Fetch the LATEST CodeRabbit issue-style summary comment (by `updated_at`,
 * not `created_at` — CodeRabbit edits the same comment in place as analysis
 * progresses). Classify its current body.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} pr
 */
function fetchLatestSummary(owner, repo, pr) {
  const comments = /** @type {any[]} */ (ghApiPage(
    `/repos/${owner}/${repo}/issues/${pr}/comments`,
  ));
  const cr = comments
    .filter((c) => c.user?.login === CODERABBIT_BOT_LOGIN)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const latest = cr[0];
  if (!latest) {
    return { queried: true, verdict: "walkthrough", body: null, updatedAt: null };
  }
  return {
    queried: true,
    verdict: classifySummaryVerdict(latest.body ?? ""),
    body: latest.body,
    updatedAt: latest.updated_at,
  };
}

/**
 * Sonar Quality Gate state from the latest `sonarcloud[bot]` comment on the
 * PR. Sonar's bot comment body contains a line like
 * `Quality Gate status: PASSED` (or `FAILED`). When Sonar has not yet
 * posted, `state` is `UNKNOWN` and `queried` is `false` — that becomes a
 * blocker in `summarize()` (anti-overclaim: no Sonar signal ≠ clear).
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} pr
 */
function fetchSonarQG(owner, repo, pr) {
  const comments = /** @type {any[]} */ (ghApiPage(
    `/repos/${owner}/${repo}/issues/${pr}/comments`,
  ));
  const sonar = comments
    .filter((c) => c.user?.login === SONAR_BOT_LOGIN)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const latest = sonar[0];
  if (!latest) {
    return { queried: false, state: "UNKNOWN", body: null };
  }
  const body = latest.body ?? "";
  const match = body.match(/Quality Gate status:\s*(PASSED|FAILED)/i);
  if (!match) {
    return { queried: false, state: "UNKNOWN", body };
  }
  return {
    queried: true,
    state: /** @type {"PASSED" | "FAILED"} */ (match[1].toUpperCase()),
    body,
  };
}

/**
 * CI non-SUCCESS count via `gh pr checks`. Every check whose state is not
 * `SUCCESS` counts (incl. PENDING, FAILURE, ERROR, etc.). PENDING is
 * intentionally a blocker — merging on PENDING is the canonical
 * "merge-before-reply" failure mode called out in feature-loop.md.
 *
 * `gh pr checks --required --json` exits NONZERO when any required check
 * is non-SUCCESS — but it still writes the full JSON payload to stdout
 * before exiting. We capture `err.stdout` from the thrown error and parse
 * it; the previous re-run-without-`--required` fallback discarded that
 * payload for the exact cases we need to report (PENDING/FAILURE).
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} pr
 */
function fetchCIStatus(owner, repo, pr) {
  let stdout = "";
  try {
    stdout = execFileSync(
      "gh",
      [
        "pr",
        "checks",
        String(pr),
        "--repo",
        `${owner}/${repo}`,
        "--json",
        "name,state,bucket",
        "--required",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // gh pr checks --required exits NONZERO when any required check is
    // non-SUCCESS (PENDING / FAILURE / ERROR) — exactly the case we care
    // about. The JSON payload is still on err.stdout; capture it instead
    // of dropping it. execFileSync errors carry `stdout` (string|Buffer)
    // when stdio pipes are configured.
    stdout =
      typeof err?.stdout === "string"
        ? err.stdout
        : Buffer.isBuffer(err?.stdout)
          ? err.stdout.toString("utf8")
          : "";
  }

  // No usable stdout → can't report (anti-overclaim: queried=false → BLOCKED).
  if (!stdout || !stdout.trim()) {
    return { queried: false, nonSuccess: 0, checks: [] };
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Malformed JSON → don't guess. Degrade to queried=false.
    return { queried: false, nonSuccess: 0, checks: [] };
  }
  const checks = Array.isArray(parsed) ? parsed : [];
  const nonSuccess = checks.filter(
    (/** @type {{ state: string }} */ c) =>
      String(c.state).toUpperCase() !== "SUCCESS",
  );
  return { queried: true, nonSuccess: nonSuccess.length, checks: nonSuccess };
}

// ---------------------------------------------------------------------------
// Orchestration + report
// ---------------------------------------------------------------------------

/**
 * Gather every source and return the structured verdict. Each source is
 * wrapped in a try/catch so a single failed lookup degrades to
 * `{ queried: false, ... }` rather than aborting the whole sweep — the
 * anti-overclaim rule in `summarize()` then turns that into a BLOCKED.
 *
 * @param {number} pr
 * @param {string} [repoSlugs]
 */
export async function reviewStatus(pr, repoSlugs) {
  const repo = repoSlugs ?? detectRepo();
  const [owner, name] = repo.split("/");

  const tryQuery = (/** @type {() => any} */ fn, fallback) => {
    try {
      return fn(owner, name, pr);
    } catch {
      return fallback;
    }
  };

  const threads = tryQuery(fetchUnresolvedThreads, {
    queried: false,
    unresolved: 0,
    threads: [],
  });
  const folded = tryQuery(fetchFoldedFindings, {
    queried: false,
    open: 0,
    perReview: [],
  });
  const summary = tryQuery(fetchLatestSummary, {
    queried: false,
    verdict: "walkthrough",
    body: null,
    updatedAt: null,
  });
  const sonar = tryQuery(fetchSonarQG, {
    queried: false,
    state: "UNKNOWN",
    body: null,
  });
  const ci = tryQuery(fetchCIStatus, { queried: false, nonSuccess: 0, checks: [] });

  const verdict = summarize({ threads, folded, summary, sonar, ci });

  return {
    repo: `${owner}/${name}`,
    pr,
    sources: { threads, folded, summary, sonar, ci },
    verdict,
  };
}

/**
 * Format the structured verdict as a human-readable report. The first line
 * is always the single CLEAR/BLOCKED bottom line the master quotes.
 *
 * @param {Awaited<ReturnType<typeof reviewStatus>>} status
 */
export function formatReport(status) {
  const { repo, pr, sources, verdict } = status;
  const lines = [];
  if (verdict.clear) {
    lines.push(`CLEAR — ${repo}#${pr}`);
  } else {
    lines.push(`BLOCKED (${verdict.blockers.length}) — ${repo}#${pr}:`);
    for (const b of verdict.blockers) lines.push(`  - ${b}`);
  }
  lines.push("");
  lines.push("Breakdown:");
  lines.push(
    `  - unresolved threads (any author): ${sources.threads.unresolved}` +
      (sources.threads.queried ? "" : " [not queried]"),
  );
  lines.push(
    `  - folded review-body findings:    ${sources.folded.open}` +
      (sources.folded.queried ? "" : " [not queried]"),
  );
  lines.push(
    `  - CodeRabbit summary verdict:     ${sources.summary.verdict}` +
      (sources.summary.queried ? "" : " [not queried]"),
  );
  lines.push(
    `  - Sonar Quality Gate:             ${sources.sonar.state}` +
      (sources.sonar.queried ? "" : " [not queried]"),
  );
  lines.push(
    `  - CI non-SUCCESS checks:          ${sources.ci.nonSuccess}` +
      (sources.ci.queried ? "" : " [not queried]"),
  );
  if (sources.folded.perReview.length > 0) {
    lines.push("");
    lines.push("Folded findings by review:");
    for (const r of sources.folded.perReview) {
      lines.push(
        `  - review ${r.reviewId} (${r.user}): ${r.count} folded finding(s)`,
      );
      for (const f of r.findings) {
        lines.push(`      · ${f.severity} ${f.file}:${f.line}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * CLI entrypoint.
 *
 * @param {string[]} argv
 */
export async function main(argv = process.argv.slice(2)) {
  const prArg = argv[0];
  if (!prArg || !/^\d+$/.test(prArg)) {
    process.stderr.write(
      "usage: pnpm review-status <pr-number>\n" +
        "       node scripts/pr-review-status.mjs <pr-number>\n" +
        "env:  REVIEW_STATUS_REPO=owner/name  (override auto-detect)\n",
    );
    exit(2);
  }
  const status = await reviewStatus(Number(prArg));
  process.stdout.write(formatReport(status) + "\n");
  exit(status.verdict.clear ? 0 : 1);
}

// Run only when invoked directly, not when imported by the test.
const invokedDirect =
  process.argv[1] &&
  process.argv[1].endsWith("pr-review-status.mjs");
if (invokedDirect) {
  main().catch((err) => {
    process.stderr.write(`review-status: ${err?.message ?? err}\n`);
    exit(2);
  });
}
