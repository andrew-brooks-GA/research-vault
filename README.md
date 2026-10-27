# 🗃️ research-vault

A notes folder your coding agent keeps for you, with a review date on every entry.

![CI](https://github.com/andrew-brooks-GA/research-vault/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node ≥22](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)
![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

## The problem

Your coding agent learned about your tools from a training snapshot that is months or years old. What you teach it in one session rarely reaches the next with its source and a freshness date attached. So it guesses, and you end up re-checking what it tells you.

## What this does

research-vault gives the agent a folder of Markdown notes that it searches, cites and maintains.

- **Capture once, keep for good.** Ask the agent to capture a doc page, a paper or a decision. It writes an entry with the right metadata. Months later, in a fresh session, the note is still there.
- **Every entry has a review interval.** Fundamentals get three years, mature practices one year, tool-specific facts ninety days, and prices or "current best model" claims are always re-checked. Before the agent cites an entry it compares the last check against the interval and tells you when it might have aged.
- **Answers come from your notes first.** Each vault carries an instructions file that tells the agent to search it before guessing, and to say how fresh what it found is.
- **Your code can cite it too.** In a repo bound to a vault inside it, a comment above a function names the entry the function was written against, optionally pinned to the dependency version your project declares. When that version changes, `check` reports exactly those functions as stale and `check --check` exits 1; the review gate re-checks only the functions that changed.
- **Works with any agent.** A Claude Code plugin and a plain command-line tool. Codex, Gemini or any agent that reads files can follow the same instructions file.

Plain Markdown. Nothing to install beyond Node. The tool itself never reaches the network unless you turn that on.

## What it looks like

```text
You:    digging into vcluster sleep mode — capture https://docs.vcluster.com/sleep-mode
Claude: Captured · vcluster 0.20 · topics: kubernetes, vcluster, cost-optimization

  …four months later, a brand-new session…

You:    how does vcluster sleep mode work again?
Claude: From your vault (vcluster 0.20 · last verified 4 months ago):
        sleep mode scales idle workloads to zero and wakes them on demand…
        ⚠ fast-moving and past its 90-day window — want me to re-verify against the live docs first?
```

And from code, in a repo whose vault lives inside it:

```text
-- sleep call order per 2026-03-03-sleep-mode-api@sdk=0.20.4
local function sleep(client)
  ...

$ research-vault check          # after package-lock.json moves the sdk to 0.21.0
STALE     src/sleep.lua:1 sleep  2026-03-03-sleep-mode-api  (sdk 0.20.4 -> 0.21.0)
check: 4 file(s); 2 ok, 1 stale, 0 uncovered, 0 unattached, 3 code link(s)
versions: sdk=0.21.0
```

## Install

In Claude Code:

```text
/plugin marketplace add https://github.com/andrew-brooks-GA/research-vault.git
/plugin install research-vault@research-vault
/reload-plugins
/research-vault:research-init
```

Without Claude Code:

```text
git clone https://github.com/andrew-brooks-GA/research-vault.git
node research-vault/bin/research-vault.mjs init
```

In a repo you work in, `research-vault init --project` writes a `.research-vault.json` that points the repo at a vault, so commands run inside it resolve there unless `--vault` is passed. To keep the vault inside the repo and let its code cite entries, run `research-vault init --vault research` first, then `research-vault init --project --vault research --code-links 'src/**/*.lua'`; the plugin ships the Lua comment and declaration patterns, and a project adds another language as two regexes in that file (a Python row was tested that way).

## Day to day

In Claude Code you mostly just talk. The plugin's skills load when a request matches their job: looking something up, capturing, verifying, curating, or running a research task.

| You say | What happens |
|---|---|
| "capture this page" | A source entry is written with the URL, version and topics. Duplicates are caught. |
| "what do I know about X?" | The vault is searched first. You're told how fresh the answer is and offered a re-check if it's past its interval. |
| "research X" | Answered from the vault if possible. Otherwise the agent searches the web and files every source, note and open question as entries, not a one-off report. |
| "what needs attention?" | A report of entries past their interval, conclusions resting on aged evidence, entries nothing links to, and sources nobody has written up yet. |
| "teach me X" | A teaching workspace: mission, short lessons with quizzes, reference sheets. Every fact comes from the vault or a kept probe run, and a fresh reviewer agent fails any lesson that claims more than the evidence shows. |
| "gate this draft" | A fresh reviewer agent checks every claim against the vault entries on its evidence list, plus any contradicting entry it finds in the vault; the verdict is stored per unit of the file, so an edit reopens only the units it touches (the whole file for a draft with no units). |
| "verify this" | The entry is checked by a suitable method (re-fetching, cross-referencing, a local probe, or your say-so) and the result recorded. A wrong entry is marked as replaced by a corrected one. |
| "this function follows that entry" | A comment line above the declaration cites the entry, pinned to the version your project declares when the call is to a versioned dependency. The link is checked with the rest of the repo, and the gate reviews that one symbol, by its own line range, when its body changes. |

Each of these is also a slash command. All but the research workflow are plain CLI calls too.

## How a vault is organized

Captured pages go in `sources/`, your take on them in `notes/`, and conclusions drawn across several notes in `synthesis/`. Code fragments, trial runs and open questions have folders of their own.

Notes point at their sources and syntheses at their notes, so the agent can trace what a conclusion rests on and what breaks when a source turns out to be wrong. In Obsidian the vault renders as a graph.

## Learn more

- [Reference](docs/REFERENCE.md): commands and flags, where the vault lives, binding a repo, code links, extending the vocabulary, safety rules, design notes.
- [Migrating existing notes](docs/MIGRATION.md) · [Building your own orchestrator](docs/ORCHESTRATOR-INTEGRATION.md) · [Exporting for fine-tuning](docs/FINETUNING.md)
- [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © Andrew Brooks
