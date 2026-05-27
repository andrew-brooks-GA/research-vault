# research-vault

A portable, self-contained plugin that scaffolds and operates a **research vault** — a cache of Markdown + YAML-frontmatter research artifacts with freshness governance, for research on **any technical topic** (software, systems/infrastructure like the Kubernetes ecosystem, data/ML, security, …). Works as a Claude Code plugin or standalone with any agent (Codex, Gemini, or by hand). Zero npm dependencies; Node ≥18; runs on Linux, macOS, and Windows.

## Install

**Claude Code plugin (persistent):**
```
/plugin marketplace add https://github.com/andrew-brooks-GA/research-vault.git
/plugin install research-vault@research-vault
/reload-plugins
```
Then use the namespaced slash commands: `/research-vault:research-init`, `/research-vault:research-capture`, `/research-vault:research-lint`, `/research-vault:research-verify`, `/research-vault:research-search`, `/research-vault:research-related`. The `research-vault-usage` skill auto-activates when you ask a technical-research question and a vault is available.

**Standalone (any agent or human):** clone this repo and run the CLI directly — no install, no dependencies:
```
node bin/research-vault.mjs init                 # scaffold a vault + print the env-var setup line
node bin/research-vault.mjs capture --type source --title "vcluster sleep mode" \
  --url https://docs.vcluster.com/... --domain systems-infrastructure \
  --topics kubernetes,vcluster,cost-optimization --subject-name vcluster --subject-version 0.20
node bin/research-vault.mjs lint                  # validate + rebuild manifest (self-healing)
node bin/research-vault.mjs verify --stale        # list entries past their freshness window
node bin/research-vault.mjs search --topic vcluster
node bin/research-vault.mjs related <id>          # forward edges + backlinks
```

## Where the vault lives (discovery order)

1. `--vault <path>` flag
2. `$RESEARCH_VAULT_PATH`
3. pointer file written by `init` (use `init --set-default` to repoint)
4. OS default:

| OS | Default vault path |
|---|---|
| Linux | `$XDG_DATA_HOME/research-vault` → `~/.local/share/research-vault` |
| macOS | `~/Library/Application Support/research-vault` |
| Windows | `%LOCALAPPDATA%\research-vault` |

The plugin is tooling only; your vault data lives separately and is never stored in this repo.

## How topics are organized

Two facet tiers keep retrieval clean as the vault grows:

- **`domain`** — a small controlled set of broad areas: `software-engineering`, `systems-infrastructure`, `data-ml`, `security`, `learning`, `llm-assisted-dev`, `meta`.
- **`topics:`** — freeform, lowercase-kebab; this is where specific tech lives (`kubernetes`, `vcluster`, `istio`, `helm`, …). No schema edits when you research a new tool.

To change the controlled vocabulary, edit **one file** — `schema/taxonomy.json`. The linter, `capture`, the generated `AGENTS.md`, and each vault's copied `taxonomy.json` all derive from it.

## Key ideas

- **Cache, not source of truth.** Every entry has a `volatility` tier (`stable`/`slow`/`fast`/`volatile`) and a `verifications` log; agents check freshness before citing, and prefer live data when an entry is stale.
- **Schema is the single source of truth.** `schema/taxonomy.json` + `schema/frontmatter.schema.json` drive the linter, `capture`, and the generated `AGENTS.md` — no hand-maintained duplicates, no drift (CI enforces it).
- **Lint is the guarantee.** `research-vault lint` (the detective floor) validates encoding (UTF-8, no BOM/CRLF/mojibake), forbidden derived fields, stage↔folder rules, controlled-vocabulary enums, reference integrity, and required fields — on any platform. `capture`/`verify` are self-healing; an optional Claude Code hook is a non-load-bearing convenience.
- **Versioned resources.** Optional `subject: {name, version}` + `series:` model multiple product versions (e.g. vcluster 0.19 vs 0.20). A new version is a **new sibling entry** sharing the `series` — *version succession*, distinct from *supersession* (which is reserved for entries that are wrong).
- **Agent-agnostic.** Every vault is self-describing via a generated `AGENTS.md`; the Node tools are an accelerator, never a requirement. A no-Node agent can read and author the vault by hand.

## Development

```
npm test        # node --test  (unit + integration; zero test-framework deps)
```

CI runs the suite plus `init` / `lint --check` / AGENTS.md-anti-drift / encoding gates across **{Linux, macOS, Windows} × Node {18, 20, 22}**.

## License

MIT — see [LICENSE](LICENSE).
