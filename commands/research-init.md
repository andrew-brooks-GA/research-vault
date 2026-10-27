---
description: Scaffold a research vault at the discovered location and print the env-var setup line.
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" init` and relay its output. Then tell the user the printed `RESEARCH_VAULT_PATH` profile line so future sessions resolve the vault.

## Bind a repo to a vault (`--project`)

To bind the current repo to a vault instead of scaffolding one, run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" init --project`. It writes a `.research-vault.json` at the current directory pointing at the resolved vault; it does not scaffold a vault.

- Optional flags seed the file's capture `defaults` and `references.globs`: `--domain <d>`, `--topics <a,b>`, `--globs <a,b>`, `--volatility <tier>` (volatility defaults to `fast`).
- `--code-links <glob,glob>` adds a `code` block (`globs`, `languages`, `versions`) so vault ids in comments above declarations in those files are checked and gated (see "Code links" in docs/REFERENCE.md). It needs a relative `--vault` inside the repo; with an absolute, `..` or absent vault it prints the reason and exits 1. A `versions` key and a `languages` row for a language the plugin does not ship are added to the file by hand.
- Non-clobber: it refuses if a `.research-vault.json` already exists at that directory.

## Other init modes

- `research-vault init --project [--domain … --topics … --globs …]` — bind the **current repo** to a vault by writing a `.research-vault.json` here. Does not scaffold a vault; the vault is resolved as usual. Required before the `research-authoring` skill activates.
- `research-vault init --refresh-docs` — regenerate an **existing** vault's `AGENTS.md` + `taxonomy.json` from the current plugin schema after an upgrade. Never touches entries, `meta/`, `.gitignore`, or the manifest; refuses a non-vault target.
