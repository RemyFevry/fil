---
"@color-sunset/fil": patch
---

Worktree guard: allow `wt switch` (and other read-only `wt` subcommands) as a bootstrap escape hatch from the primary worktree.

Previously, an agent running in the primary worktree got a hard block on every mutating tool, including the very `wt switch …` command needed to escape into a worktree. The only path was `FIL_ALLOW_MAIN_WORKTREE=1`, which is meant for trunk maintenance — not bootstrap.

The canonical guard (`scripts/require-worktree.sh`) now accepts the bash command as `$1` and whitelists a strict subset of `wt` subcommands (`switch`, `list`, `path`, `which`, `config`, `diff`, `log`, `step`). The match is anchored and uses a safe-alphabet regex — shell metacharacters like `;`, `&&`, `|`, `$()`, backticks are denied, so a compound command like `wt switch foo; rm -rf /` is not smuggled through. The block message now also shows what was attempted, so the failed agent can see *why* it was blocked.

The three call-sites were updated to forward the bash command:

- `.opencode/plugins/worktree-guard.ts` — passes `output.args.command`
- `.pi/extensions/worktree-guard.ts` — passes the best-effort `event.input.{command,args}` extraction (with stringification fallback)
- `.claude/settings.json` — now points `PreToolUse` at a new Node wrapper (`.claude/hooks/worktree-guard.mjs`) that reads the hook event JSON from stdin and forwards `tool_input.command` to the script

No behavior change inside a Worktrunk-linked worktree. `wt merge` and `wt remove` are intentionally not whitelisted — running them from the primary would mutate `main` directly.
