# Fil

An open-source harness for agentic software-development lifecycles. See [`CONTEXT.md`](./CONTEXT.md) for the glossary and [`docs/OVERVIEW.md`](./docs/OVERVIEW.md) for the design synthesis.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `RemyFevry/fil`, tracked on the **Fil MVP** GitHub Project board (PRD epic: #21). Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map 1:1 to GitHub labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Issue workflow

Execution status lives on the **Fil MVP** board's `Status` field (`Todo → In Progress → In Review → Done`; `Blocked` when stuck) — **not** labels. Triage labels track *readiness*; board Status tracks *execution*. **Any agent or human working an issue must keep its Status and comments current**, at every transition. See `docs/agents/issue-workflow.md`.

### Domain docs

Single-context: read `CONTEXT.md` at the repo root and `docs/adr/` before working in an area. See `docs/agents/domain.md`.
