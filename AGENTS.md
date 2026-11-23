# Contributing to research-vault

This repo is the research-vault plugin: a zero-dependency Node CLI (`bin/`, `engines` >=22), Claude Code hooks (`hooks/`), skills (`skills/`), agents (`agents/`) and the vault template (`vault-template/`). The file you are reading is for working on the plugin; the instructions for a vault itself are written into each vault's `AGENTS.md` by `generateAgentsMd` at `init`.

## Before you commit

- `npm test` (isolated environment; a test or a test file may run 10 minutes and the whole run 20): every test passes.
- `npm run lint:self`: the vault template lints clean.
- `node scripts/check-agentsmd-drift.mjs`: the generated vault AGENTS.md matches `schema/AGENTS.golden.md`.
- `node scripts/check-encoding.mjs`: no BOM, CR byte or double-encoded mojibake sequence in any tracked file that is not binary.
- `node bin/research-vault.mjs gate staged --check`: every staged gated file (this machine's binding gates `docs/**/*.md`, `skills/**/*.md`, `agents/*.md`, `commands/*.md`, `README.md` and `AGENTS.md`) carries a `PASS` or `MERIT` claims verdict for its current content; run the `research-claims-gate` skill on it first. `git config core.hooksPath .githooks` makes git refuse the commit otherwise.

## New tests

- A test names one behaviour and is shown failing without it before it is kept: the commit message or the pull request records the run against the code without the change (or with the one check removed).
- A test of a refusal asserts what did not happen (no file changed by name or bytes, no process started, nothing sent), not only the message or status.
- A test of a path check builds the real layout (a link, a folder that is a link, a file that is a link) and compares the outside location before and after.
- A test does not compute its expected value with the function under test or a helper the code under test calls.
- A test does not read a code file as text, except a named source-scan guard whose comment says what it guards.
- A test that starts a process or a server has a time limit and compares only the output it is about.
- No test count is reported as evidence. A report says what would be caught.
- One new test per behaviour; a batch of tests for one change is split by the behaviours it claims.

## Rules

- `schema/AGENTS.golden.md` is generated from `schema/` by `bin/lib/agentsmd.mjs`. Never edit it by hand; change the schema or the generator and regenerate it (the drift script's failure message carries the regenerate command).
- Every change gets a line under `## [Unreleased]` in `CHANGELOG.md`.
- ESM only, no dependencies, no classes. `skills/research-teach/terminal/` holds, beside the plugin's `terminal.mjs` and `terminal.css`, five browser files copied from npm and pinned by SHA-256; they are not a Node dependency. Keep a change small and in the style of the code around it.
- Before renaming or removing a file, a CLI flag, a skill, an agent or an npm script, run `node scripts/deps.mjs <path>` (or `cli:<command>`, `npm:<script>`) and update every dependent it lists; `npm test` fails on a reference to something that no longer exists. When a change makes two files depend on each other through anything other than a path (a copied value, a printed string, a name, a format), add a `COUPLINGS` row in `scripts/deps.mjs`.
