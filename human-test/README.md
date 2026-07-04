# Human-test — manual visual testing

A throwaway harness for manually exercising the Stately inspector integration
(`fil inspect`). **Nothing here is shipped** — it's a dev aid for eyeballing the
visualizer.

## Prerequisites

```sh
pnpm install
pnpm build          # builds the engine + CLI (once is enough)
```

The Stately inspector **UI is hosted** at `https://stately.ai/inspect`; the relay
server is local. The actor and its events never leave your machine, but the
browser needs internet to load the UI. If it doesn't auto-open, go to
<https://stately.ai/inspect> — it connects to the local relay automatically.

## Two ways to run

### 1. Standalone demo (fastest — drives the engine directly)

```sh
node human-test/inspect-demo.mjs            # default Flow
node human-test/inspect-demo.mjs hotfix     # incident Flow
```

Starts an XState actor for the Flow wired to the inspector, then advances one
Phase each time you press **Enter**. The lifecycle is printed up front:

```
Lifecycle: requirements → design → code → review → done
Starting Phase: requirements
  ▶ current: design
  ▶ current: code
  …
```

### 2. Real CLI end-to-end (what users actually run)

```sh
sh human-test/run-cli.sh
```

Scaffolds a throwaway project in a temp dir, runs `fil init`, then `fil inspect`
— the exact production code path. Temp dir is cleaned up on exit.

### With an active Run (resume at the current Phase)

```sh
sh human-test/run-cli.sh &                  # just to scaffold, then Ctrl-C
cd <temp-dir>                               # or use your own .fil/ project
node <repo>/packages/cli/dist/index.js start "add-login" --flow default
node <repo>/packages/cli/dist/index.js next   # advance a phase (runs the Gate)
node <repo>/packages/cli/dist/index.js inspect # inspector resumes at the current Phase
```

### Offline (no browser)

```sh
node packages/cli/dist/index.js inspect --text
```

Prints the text diagram with the active Phase highlighted — no relay, no
browser, no internet. Useful when you only want to sanity-check the Flow graph.

## What to look for

- The browser shows the **default Flow** as an interactive statechart:
  `requirements → design → code → review → done`.
- The **active state is highlighted**; pressing Enter moves the highlight.
- For the default Flow: 4 Enters walk it `requirements → design → code → review
  → done`, after which the session says "Flow reached its terminal Phase" and
  exits.
- Each Phase carries its gate (`shell` / `human-confirm` / `tests`) and actor
  mode in the `--text` view.
