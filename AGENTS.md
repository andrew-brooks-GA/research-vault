# Contributing to research-vault

This repo is the research-vault plugin: a zero-dependency Node 22+ CLI (`bin/`), Claude Code hooks (`hooks/`), skills (`skills/`), agents (`agents/`) and the vault template (`vault-template/`). The file you are reading is for working on the plugin; the instructions for a vault itself are generated into each vault's `AGENTS.md`.

## Before you commit

- `npm test` (`node --test`): every test passes.
- `npm run lint:self`: the vault template lints clean.
- `node scripts/check-agentsmd-drift.mjs`: the generated vault AGENTS.md matches `schema/AGENTS.golden.md`.
- `node scripts/check-encoding.mjs`: no BOM, CRLF or mojibake in tracked `.md`, `.mjs` and `.json` files.

## Rules

- `schema/AGENTS.golden.md` is generated from `schema/` by `bin/lib/agentsmd.mjs`. Never edit it by hand; change the schema or the generator and regenerate it (the drift script prints the command).
- Every change gets a line under `## [Unreleased]` in `CHANGELOG.md`.
- Specs live in `docs/specs/`, numbered, one per round of work; `docs/specs/README.md` indexes them.
- ESM only, no dependencies, no classes. Keep a change small and in the style of the code around it.
