# 🗃️ research-vault

**Stop re-researching the same things — and stop letting agents cite docs that went stale three versions ago.**

`research-vault` turns the scattered, throwaway research you do with an LLM into a durable, **freshness-governed** knowledge base that any agent can search, navigate, and cite with confidence. Plain Markdown, zero dependencies, works in Claude Code or any other agent.

![CI](https://github.com/andrew-brooks-GA/research-vault/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)
![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
![platforms](https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20windows-lightgrey.svg)

---

## Why

LLM-assisted research has two failure modes:

- **You lose it.** The answer you dug up last month is gone, so you ask again — and pay for the same research twice.
- **You trust it too long.** An agent confidently cites a tool's docs that changed three releases ago, because nothing told it the page had moved on.

A plain notes folder fixes neither: it has no idea *how fast a fact goes stale* or *when you last checked it*. `research-vault` does — it's a cache **with an expiry policy**. A 2009 algorithm is still true; a "current best model" claim from last quarter probably isn't. The vault knows the difference and makes your agent act on it.

## The magic moment

```text
You:    I'm digging into vcluster sleep mode — capture https://docs.vcluster.com/sleep-mode
Claude: Captured as a source · vcluster 0.20 · topics: kubernetes, vcluster, cost-optimization

  …three weeks later, a brand-new session…

You:    how does vcluster sleep mode work again?
Claude: From your vault (vcluster 0.20 docs · volatility: fast · last verified 21 days ago):
        sleep mode scales a virtual cluster's workloads to zero when idle and wakes them on demand…
        ⚠ This entry is fast-moving and 21 days old — want me to re-verify against the live docs before you rely on it?
```

You captured once. Weeks later, in a fresh session, the knowledge is there — **with a built-in staleness warning**. That's the whole point.

## What you get

| | |
|---|---|
| 🧠 **Freshness-governed** | Every entry has a `volatility` tier and a verification log. Agents check both before citing and prefer live data when something's aged — no more silently-stale answers. |
| 🗂️ **Version-aware** | Track `vcluster 0.19` and `0.20` as sibling entries that both stay valid. A new release is *new knowledge*, not a correction of the old. |
| 🔌 **Agent-agnostic** | A Claude Code plugin *and* a standalone CLI. Codex, Gemini, or a bare file-reading agent all work — every vault is self-describing via a generated `AGENTS.md`. |
| 🔍 **Instantly searchable** | A derived manifest gives one-read facet search and a backlink graph across the whole vault — no re-reading files. |
| 🛡️ **Self-consistent** | One JSON schema drives the linter, capture, and the generated docs. A lint guardrail enforces encoding, structure, and reference integrity on every platform. |
| 🪶 **Zero-dependency** | Node ≥18, stdlib only. Nothing to `npm install`. Runs on Linux, macOS, and Windows. |

## Install

**As a Claude Code plugin** — then just *talk to it*; no commands required (the usage skill auto-activates on technical-research questions):

```text
/plugin marketplace add https://github.com/andrew-brooks-GA/research-vault.git
/plugin install research-vault@research-vault
/reload-plugins
```

Explicit slash commands are available too: `/research-vault:research-capture`, `…:research-search`, `…:research-verify`, `…:research-lint`, `…:research-related`, `…:research-init`.

**Standalone** — clone and run; no install, no dependencies:

```bash
node bin/research-vault.mjs init        # scaffold a vault (prints the env-var setup line)
node bin/research-vault.mjs capture --type source --title "vcluster sleep mode" \
  --url https://docs.vcluster.com/... --domain systems-infrastructure \
  --topics kubernetes,vcluster,cost-optimization --subject-name vcluster --subject-version 0.20
node bin/research-vault.mjs search --topic vcluster
```

## How it's organized

Two facet tiers keep retrieval clean as the vault grows to hundreds of entries:

- **`domain`** — a small, controlled set of broad areas: `software-engineering` · `systems-infrastructure` · `data-ml` · `security` · `learning` · `llm-assisted-dev` · `meta`.
- **`topics`** — freeform; where specific tech lives (`kubernetes`, `vcluster`, `istio`, `helm`, …). Research a hundred tools without ever editing the schema.

### What goes where

| Folder | What it holds | You create one when… |
|---|---|---|
| `sources/` | Raw captures of external material — articles, papers, docs, talks (what it says, as-is) | you clip something worth keeping |
| `notes/` | Your **distilled** take on one or more sources — the load-bearing claims + how you'd use them | you read a source and want a durable, skimmable version *(deliberate — capturing a source does not auto-create a note)* |
| `synthesis/` | **Cross-source themes** combining several notes/sources into a conclusion | you see a pattern across multiple entries worth stating once |
| `snippets/` | Reusable, ideally tested code or prompt fragments | you have a fragment you'll reuse |
| `experiments/` | Logged trial runs (an LLM/tool run) with task, parameters, and outcome | you run a trial worth recording |
| `questions/` | Open questions driving research (`open → investigating → answered`) | you hit a question to track and answer over time |

The spine is a deliberate distillation flow — **`sources/` → `notes/` → `synthesis/`** — that you (or the agent, on request) walk explicitly; nothing auto-promotes. `snippets/`, `experiments/`, and `questions/` stand alone.

To change the controlled vocabulary, you edit exactly **one file**: `schema/taxonomy.json`. The linter, `capture`, the generated `AGENTS.md`, and each vault's copied `taxonomy.json` all derive from it — nothing to keep in sync by hand.

## Where the vault lives

Tooling and data are separate — your notes never live in this repo. The vault is discovered in order: `--vault` flag → `$RESEARCH_VAULT_PATH` → a pointer written by `init` → OS default (`~/.local/share/research-vault` on Linux, `~/Library/Application Support/research-vault` on macOS, `%LOCALAPPDATA%\research-vault` on Windows).

## Commands

| Command | Does |
|---|---|
| `init` | Scaffold a spec-conformant vault; generate its `AGENTS.md`. |
| `capture` | Add an entry with correct frontmatter; dedupe by URL + version. |
| `lint` | Validate the vault (the correctness floor) and rebuild the manifest. `--fix` normalizes safely. |
| `verify` | List stale entries; record a verification; supersede or note version succession. |
| `search` | Facet/text query over the manifest (`--domain`, `--topic`, `--series`, `--text`). |
| `related` | Forward links + computed backlinks for an entry (`--format mermaid`). |
| `manifest` | Rebuild/print the derived index. |

## Design notes

- **Cache, not source of truth.** Staleness is the dominant failure mode of agent research; this vault makes it visible and actionable.
- **Lint is the guarantee, not the hook.** Correctness lives in `lint` (runs anywhere, on any writer). `capture`/`verify` self-heal; the optional Claude Code hook is convenience only.
- **Everything human-facing is generated.** `AGENTS.md` and the per-vault `taxonomy.json` are derived from the schema, so they can't drift — CI enforces it.

## Development

```bash
npm test     # node --test — unit + integration, zero test-framework deps
```

CI runs the suite plus `init` / `lint --check` / AGENTS.md-anti-drift / encoding gates across **{Linux, macOS, Windows} × Node {18, 20, 22}**.

## License

[MIT](LICENSE) © Andrew Brooks
