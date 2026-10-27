# Contributing to research-vault

This repo is the research-vault plugin: a zero-dependency Node CLI (`bin/`, `engines` >=22), Claude Code hooks (`hooks/`), skills (`skills/`), agents (`agents/`) and the vault template (`vault-template/`). The file you are reading is for working on the plugin; the instructions for a vault itself are written into each vault's `AGENTS.md` by `generateAgentsMd` at `init`.

## Before you commit

- `npm test` (`node --test`): every test passes.
- `npm run lint:self`: the vault template lints clean.
- `node scripts/check-agentsmd-drift.mjs`: the generated vault AGENTS.md matches `schema/AGENTS.golden.md`.
- `node scripts/check-encoding.mjs`: no BOM, CR byte or double-encoded mojibake sequence in tracked `.md`, `.mjs` and `.json` files.

## Rules

- `schema/AGENTS.golden.md` is generated from `schema/` by `bin/lib/agentsmd.mjs`. Never edit it by hand; change the schema or the generator and regenerate it (the drift script's failure message carries the regenerate command).
- Every change gets a line under `## [Unreleased]` in `CHANGELOG.md`.
- ESM only, no dependencies, no classes. Keep a change small and in the style of the code around it.
- Before renaming or removing a file, a CLI flag, a skill, an agent or an npm script, run `node scripts/deps.mjs <path>` (or `cli:<command>`, `npm:<script>`) and update every dependent it lists; `npm test` fails on a reference to something that no longer exists. When a change makes two files depend on each other through anything other than a path (a copied value, a printed string, a name, a format), add a `COUPLINGS` row in `scripts/deps.mjs`.
