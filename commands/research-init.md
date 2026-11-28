---
description: Scaffold a research vault at the discovered location and show setup guidance when needed.
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" init` and relay its output. `init` prints a `RESEARCH_VAULT_PATH` line only when the vault would not be found without it; when printed, tell the user that line.

## Bind a repo to a vault (`--project`)

To bind the current repo to a vault instead of scaffolding one, run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" init --project`. It writes a `.research-vault.json` at the current directory pointing at the resolved vault; it does not scaffold a vault. A binding can name a vault outside its folder when acknowledged with `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" trust` (`init --project` acknowledges the binding it writes), or when it matches the user's `RESEARCH_VAULT_PATH`, config pointer or OS default under the [binding rule](../SECURITY.md#repository-bindings). Relay the warning if the command writes a binding that discovery would refuse.

- Optional flags seed the file's capture `defaults` and `references.globs`: `--domain <d>`, `--topics <a,b>`, `--globs <a,b>`, `--volatility <tier>` (volatility defaults to `fast`).
- `--code-links <glob,glob>` adds a `code` block (`globs`, `languages`, `versions`) so vault ids in comments above declarations in those files are checked and gated (see "Code links" in `${CLAUDE_PLUGIN_ROOT}/docs/REFERENCE.md`). It needs a relative `--vault` inside the repo; with an absolute, `..` or absent vault it prints the reason and exits 1. A `versions` key and a `languages` row for a language the plugin does not ship are added to the file by hand. A versions file must be a non-empty path relative to the repo with no drive specifier or `..` segment and resolve inside it.
- It creates `.research-vault.json` exclusively and refuses an existing file or link at that name.

## Other init modes

- `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" init --project [--domain … --topics … --globs …]` — bind the **current repo** to a vault by writing a `.research-vault.json` here. Does not scaffold a vault; the vault is resolved as usual, subject to the binding rule above. Required before the `research-authoring` skill activates.
- `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" init --refresh-docs` — regenerate an **existing** vault's `AGENTS.md` + `taxonomy.json` from the current plugin schema after an upgrade. Never touches entries, `meta/`, `.gitignore`, or the manifest; refuses a non-vault target.
