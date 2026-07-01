# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `RemyFevry/fil`, tracked on the **Fil MVP** GitHub Project board. Use the `gh` CLI for all operations.

- The Fil MVP PRD is published as the parent epic **#21** (its children are #1–#20).
- All issue tracking happens in GitHub Issues + the GitHub Project board — there is no local `docs/prd/` file.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
