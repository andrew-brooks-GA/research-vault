# research-vault

A portable, self-contained plugin that scaffolds and operates a **research vault** — a cache of Markdown + YAML-frontmatter research artifacts with freshness governance. Works as a Claude Code plugin or standalone with any agent (Codex, Gemini, or by hand). Zero npm dependencies; Node ≥18.

## Two ways to use it

**Claude Code plugin:** install the plugin, then use the slash commands (`/research-init`, `/research-capture`, `/research-lint`, `/research-verify`, `/research-search`, `/research-related`). Skills auto-activate when you research software-engineering / LLM topics.

**Standalone (any agent or human):** clone this repo and run the CLI:
```
node bin/research-vault.mjs init        # scaffold a vault
node bin/research-vault.mjs capture --type source --title "..." --url https://...
node bin/research-vault.mjs lint        # validate + rebuild manifest
node bin/research-vault.mjs verify --stale
node bin/research-vault.mjs search --topic go
node bin/research-vault.mjs related <id>
```

## Where the vault lives (discovery order)

1. `--vault <path>` flag
2. `$RESEARCH_VAULT_PATH`
3. pointer file written by `init`
4. OS default:

| OS | Default vault path |
|---|---|
| Linux | `$XDG_DATA_HOME/research-vault` → `~/.local/share/research-vault` |
| macOS | `~/Library/Application Support/research-vault` |
| Windows | `%LOCALAPPDATA%\research-vault` |

The plugin is tooling only; your vault data lives separately and is never stored in this repo.

## Key ideas

- **Cache, not source of truth.** Every entry has a `volatility` tier and a `verifications` log; agents check freshness before citing.
- **Schema is the single source of truth.** `schema/*.json` drives the linter, capture, and the generated `AGENTS.md` — no hand-duplication, no drift.
- **Lint is the guarantee.** `research-vault lint` (detective floor) validates encoding, derived-field, stage/folder, enum, reference-integrity, and required-field rules on any platform. `capture`/`verify` are self-healing; an optional Claude Code hook is a non-load-bearing convenience.
- **Versioned resources.** Optional `subject: {name, version}` + `series:` model multiple product versions; a new version is a new entry (not a supersession).

## Development

```
npm test        # node --test
```

CI runs the suite plus init/lint/anti-drift/encoding gates across {Linux, macOS, Windows} × Node {18, 20, 22}.
