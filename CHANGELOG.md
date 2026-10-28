# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`obsidian` draws the code links.** When the vault lives inside a bound repo with a `code` block, the view gains one derived note per linked code file under `_obsidian/code/`, a heading per declaration and a `[[wikilink]]` per link with its pin as text, plus a `## code` section in the MOC; Obsidian then shows code → entry edges and each entry's code backlinks. Unbound vaults are unchanged.
- **`obsidian` seeds the graph settings.** A view with no `_obsidian/.obsidian/graph.json` gets one: the MOC filtered out (it links every note and collapsed the graph into one star), a colour group per type tag with stale on top, labels at a lower zoom and wider spacing. Written once; an existing file is never touched.

### Fixed
- **`check` no longer reads a markdown image URL as a citation.** A badge or figure (`![alt](url)`) was reported `uncovered` and failed `check --check`; an image is now dropped before extraction.

### Changed
- **README** describes binding a repo with `init --project` and code links: the bullet, a code vignette, the install line and a "Day to day" row.

## [0.7.0] - 2026-10-27

### Added
- **Code links** (spec 15 D0-D7). A vault entry id on a comment line above a column-0 declaration is a citation of that symbol in a repo bound with `init --project --vault <relative dir> --code-links '<glob>'`, which writes a `code` block (`globs`, `languages`, `versions`) that `parseProjectConfig` accepts only on a relative vault inside the repo. A language is data, `{ comment, decl }`: `bin/lib/codelinks.mjs` ships the Lua row in `LANGS`, a project supplies or overrides rows in `code.languages`, and `langFor` is the one lookup; every regex in the binding goes through `compilePattern`; `LINK_RE` is built from the exported `ID_RE`. `check` reports code rows (`ok`, `stale` with its reason, `uncovered`, `unattached`) with a `versions:` footer, always loads the binding, and keeps code files out of the prose extractor; a pin (`<id>@<key>=<version>`) re-checks on a change of the version `code.versions` reads from the project, not on elapsed time, and a superseded entry is stale for code. The gate hashes one `sym:<name>` unit per linked declaration (pin values stripped), `gate evidence --changed` prints a `unit` line per changed unit, linked code files are gated, the post-edit hook reports code rows and the links a versions-file edit unpins, and the Stop hook blocks on a pin that differs from the declared version. The `research-authoring` skill gains a "Code" section and `claims-reviewer` a `sym:` paragraph. Nothing is written into existing vaults; without a `code` block every surface runs today's path.
- Spec 15 (`docs/specs/15-code-links.md`): code links, a vault entry id in a comment above the declaration it justifies in a consumer project bound to a project-specific vault; Lua in wow_forever first; `check` rows per linked symbol, a pin (`<id>@<key>=<version>`) that re-checks on a change of the declared dependency version instead of on elapsed time, symbol-level gate units, an `init --project --code-links` opt-in, per-project language rows in `code.languages` on the `taxonomy_extensions` model so any language works without a plugin release, and nothing written into existing vaults. Spec only; the file is force-added, since `docs/specs/` is otherwise ignored.
- Spec 14 (`docs/specs/14-deps-graph.md`): a derived dependency graph for the repo, computed from the working tree on every run, with a hand-declared coupling table, a test that fails CI on a broken reference, an AGENTS.md rule and a project-scope PostToolUse hook; plus the drift fixes the 2026-10-27 inventory found. The file is force-added, since `docs/specs/` is otherwise ignored.
- **Dependency graph** (spec 14 D1-D4). `scripts/deps.mjs` derives the repo's import, read, test, documentation, invocation and declared-coupling edges from the working tree on every run; `node scripts/deps.mjs` prints every broken reference, `node scripts/deps.mjs <path>` (or `cli:<command>`, `npm:<script>`) the dependents of one thing, and `test/deps.test.mjs` fails `npm test` on a reference to something that no longer exists. A committed `.claude/settings.json` PostToolUse hook names the dependents of a file after an `Edit` or `Write`. `AGENTS.md` gains the rename rule and the `COUPLINGS` rule, and its other lines are narrowed to what the evidence shows after a claims gate; `.gitignore` gains `ci-vault/`.

### Changed
- **CI runs on Linux and macOS only.** The Windows jobs are removed from the matrix: `node --test` had failed there since 2026-10-26 and its failure cancelled the jobs still running.

### Fixed
- **`capture` refuses an id already used in another folder.** A title that slugged to the id of an existing entry of another type was written as a second entry with the same id; the id check now covers every entry folder and names the folder.
- **Inventory drift** (spec 14 D6). `skills/research-capture/SKILL.md` lists `tool-output` among the authority bases; step 1 of `vault-template/meta/prompt-templates/verify-entry.md` computes `last_verified` from `confirmed` and `changed-trivially` verifications only, as `freshness-policy.md` and the code do; `agents/claims-reviewer.md` keys on the lowercase `changed units:` line the gate prints and names `all` as the unit of a draft without data-blocks; `freshness-policy.md` §3 gives `stable` its 1095-day window instead of "trust unless cued", matching `refresh_after_days`, and verify-entry step 2 reads `stable >1095d`; `research-capture` calls `--batch` validate-then-write, not atomic, since a write failure mid-plan keeps the entries already written; `schema/project-config.schema.json`, which nothing read, is gone; CI runs `npm run lint:self`. Each fix has a test.

- **`verify --stale`** printed `Infinityd` (and `null` under `--json`) for an entry with no confirming verification; it now reports `never verified`.

### Upgrading an existing vault

**Spec 14 D6**
- `init --refresh-docs` rewrites `AGENTS.md` and `taxonomy.json` only, so hand-replace step 1 of `meta/prompt-templates/verify-entry.md` with: Compute `last_verified` := the latest `verifications[].date` whose `result` is `confirmed` or `changed-trivially`; check `volatility`.
- Likewise replace item 4 of `meta/freshness-policy.md` §3 with: `stable` and `last_verified` >1095 days, or a specific cue → re-check; otherwise trust.

## [0.6.0] - 2026-10-27

### Added
- **Teaching workspace.** The `research-teach` skill and the `teach` command (`lint [--fix]`, `next`, `serve`, `record add`, `attempt add`, `supersede`) run a multi-session course from a `MISSION.md`: a Floor of known tools and terms, a `PATH.md` plan, lessons as HTML pages with `model`, `fact`, `example` and `quiz` blocks (`LESSON-FORMAT.md`), at most three new terms and one new tool per lesson, parked lessons that keep their history, a progress view, numbered footnote citations, a quiz module and stylesheet copied into the workspace, and a learning-record store.
- **Claims gate.** `gate evidence <draft> [--extra <ids>]` derives a draft's evidence list from the vault; `gate record`, `gate status [--check]` and `gate changed` keep per-unit verdicts in `.research-vault-ledger.jsonl` at the repo root, keyed to content hashes so an edit reopens only what it touched. `gates.globs` in `.research-vault.json` names further gated files. The `research-claims-gate` skill drives it with the `claims-reviewer` agent (model pinned to opus); the `lesson-reader` agent reads a lesson as the learner would before the claims gate.
- **Hooks.** A Stop hook blocks the end of a turn that leaves a changed gated file without a `PASS` or `MERIT` row. A pre-web hook hands matching vault entries to the model before `WebFetch` or `WebSearch`. The post-edit hook reports uncovered or stale citations after an `Edit` or `Write` in a bound repo. The session-start hook prints one line per teach workspace that needs attention. Every handler sets a timeout.
- **Graph.** `.vault-manifest.json` gains typed `edges` and node metadata; `related` traversal is bounded (`--depth`, `--direction`, `--rel`, `--format mermaid`); `advise` gains a stale-evidence section; `search` hides superseded entries unless `--include-superseded`; Obsidian stubs carry `tags:`; the generated `AGENTS.md` gains the graph playbook (§5.2) and the supersession recipe.
- **`WARN_QUOTE_ARTIFACT`** lint warning for frontmatter scalars with a baked-in `\"`, repaired by `lint --fix`.

### Changed
- **Commands folded into skills.** `research-capture`, `research-claims-gate`, `research-teach` and `research-verify` are skills only; the `/research-vault:<name>` form still works. `research-init` is user-invoked only.
- **Plugin manifest.** `.claude-plugin/plugin.json` carries `version`, `homepage`, `repository`, `license` and `keywords`; marketplace installs follow that version. `bin/research-vault` is a shim so skills can call the bare command.
- **Vault instructions.** `vault-template/CLAUDE.md` is the single line `@AGENTS.md`. The repo root gains `AGENTS.md` for contributors.
- **Frontmatter fidelity.** `verify` re-emits unchanged keys byte-identical. `capture`, `verify` and `lint --fix` say where they wrote when the vault resolved through the config pointer or the OS default.
- **Code is not a citation.** `check`, `gate evidence` and the hooks ignore URLs and ids inside fenced blocks, inline spans and HTML `<pre>` or `<code>`; `check` lists them as `skipped (in code)`.
- **Comma lists are trimmed** in every list flag. One manifest writer and one block parser replace the inline copies.
- **In-draft claims-gate marker retired.** The verdict lives in the ledger; old `<!-- claims-gate -->` comments are ignored.

### Fixed
- **YAML parsing.** Single-quoted scalars, quotes inside flow sequences, inline comments and block scalars are read per YAML.
- **Scalar edge fields** (`source_id`, `prompt_id`, `superseded_by`) were iterated as strings. **`last_verified`** in the docs now matches the code. **Piped CLI output** was truncated at 64 KB. **`check`** takes an absolute path.
- **Docs.** `REFERENCE.md` counted three hooks (four). `AGENTS.md` and `REFERENCE.md` narrowed to what the code says after a claims gate.

### Removed
- **Maintainer-only files left the repo.** `docs/specs/` (the numbered design rounds, now gitignored), `docs/EVALUATION.md` with `evaluation-template.json`, the `docs/img/` placeholder, and the Codex manifest nothing documented installing.
- **Duplicates.** `commands/research-advise.md` restated the `research-librarian` skill. Five unreferenced vault-template files (`meta/obsidian-view.md`, `meta/refresh-queue.md`, the `promote-to-synthesis`, `summarize-source` and `verify-audit` prompt templates) restated the reference or the skills; the kubectl probe manifest is now the example inside `meta/probe-manifests/README.md`. Existing vaults keep their copies.

### Upgrading an existing vault

**Spec 13 (review round 5)**
- Replace the one-line `CLAUDE.md` in an existing vault with `@AGENTS.md`; `--refresh-docs` does not touch it.
- `/research-vault:research-capture`, `research-claims-gate`, `research-teach` and `research-verify` are now the skills of the same name; the slash form still works.
- Marketplace installs follow `version` in `.claude-plugin/plugin.json` from now on and update only when it is bumped.
- A topic, source or scope list with spaces after the commas is now trimmed. An entry captured before this keeps its leading-space value (a source reference shows as `DANGLING_REF` under `lint`); `lint --fix` is not changed to rewrite it.

**Spec 12 (lesson building)**
- No manifest, AGENTS.md or `meta/` change; `init --refresh-docs` is not needed.
- Run `teach lint --fix` once per teach workspace. A learning record with no frontmatter gets `title` from its first `# ` heading (else the file name's slug), `date` from the file's modification time, `kind: understanding` and `status: active`, or `status: superseded` with `superseded_by` when its body carries the old `Status: superseded by LR-NNNN` line (the line stays in the body). Frontmatter that holds only the old `Status:` line (no `type`) is migrated too: any `title` is kept and the rest is derived the same way. In both cases `superseded_by` is set only when the record numbered `LR-NNNN` exists; otherwise the record stays `active`. A record whose frontmatter carries `type` is untouched. A second run changes nothing.
- `attempts/` is not gitignored: it is learner data, committed or not at the owner's choice.
- `.teach-serve.json` is added to the workspace's `.gitignore` by the skill's first-lesson step. A workspace that already has lessons does not run that step; add the line by hand.

**Spec 11 (claims gate enforcement)**
- No manifest, AGENTS.md or `meta/` change; `init --refresh-docs` is not needed.
- Gate verdicts are written to `.research-vault-ledger.jsonl` at the bound repo's root. Add it to that repo's `.gitignore` if verdicts should stay local; commit it to share them.
- To gate documents beyond teach workspaces, add `"gates": { "globs": ["docs/**/*.md"] }` (your globs) to `.research-vault.json`.
- An old `<!-- claims-gate: ... -->` marker in a lesson can be deleted; the gate does not read it. After upgrading, the Stop hook flags every gated file edited in the session (or in the last twelve hours when the transcript has no birth time) until a PASS or MERIT verdict is recorded for its current content.

**Round 2 graph specs**
- Run `init --refresh-docs` (AGENTS.md gains §5.2 and the supersession recipe).
- Run `lint` once; until then `lint --check` reports `MANIFEST_STALE` because rows gained fields.

**Frontmatter YAML fidelity**
- Run `research-vault lint` and look for `WARN_QUOTE_ARTIFACT`; `lint --fix` repairs those values. Review the diff: `lint --fix` also normalizes formatting across the vault, as before.
- A plain value that contained ` #` (space then hash) is now read as ending at the `#`, per YAML. Search hand-written frontmatter for ` #` before upgrading if that matters to you.

**Specs 01 + 02 (scalar edge fix, typed edges)**
- Run `research-vault lint` once; until then `lint --check` reports `MANIFEST_STALE` (the manifest gained `edges`, and vaults with a populated `source_id`/`prompt_id` get corrected `backlinks`).
- Run `research-vault init --refresh-docs` to pick up the AGENTS.md §9 wording (`edges` list). No `meta/` file changed.
- Re-run `research-vault obsidian` to regenerate `_obsidian/` with the per-relation Links layout.
- Consumers of `related` output: `forward` membership grows and is now sorted rather than in field order; the default traversal additionally reaches entries that name the id in `superseded_by`.

**Specs 03 + 04 (traversal, stale evidence)**
- No manifest change. `advise` text output gains a `stale evidence (N)` section; `--json` output gains the `staleEvidence` key.
- Run `research-vault init --refresh-docs` to pick up the AGENTS.md §7 sentence on evidence freshness. `init --refresh-docs` never touches `meta/`, so hand-add the same sentence to `meta/freshness-policy.md` §3 (after item 5):

  > A note or synthesis is only as fresh as its evidence: before citing one, check that its `sources`/`contributing_ids` chain is within window (`advise` lists violations as `staleEvidence`).

**Spec 05 (Obsidian tags)**
- No manifest or AGENTS.md change. Re-run `research-vault obsidian` to get the `tags:` block.
- No command refreshes `meta/`, so hand-add this section to `meta/obsidian-view.md` (before "## Rules"):

  ```
  ## Graph groups

  Every stub carries frontmatter `tags:` (`type/<type>`, `status/<status>`, `domain/<d>`,
  `volatility/<v>`, `freshness/<fresh|stale|unassessed>`, `topic/<t>`), so the graph view
  can colour and filter by them.

  Open the graph view's settings (the cog) → Groups → New group. Suggested:
    tag:#freshness/stale        red
    tag:#type/synthesis         blue
    tag:#type/question          yellow
  Filter the whole graph with the same syntax, e.g. tag:#domain/security.
  Freshness tags are a snapshot from the last `research-vault obsidian` run.
  Obsidian can draw link arrows, but each stub also lists its backlinks as
  wikilinks, so every backlink-forming relation appears as a link in both
  directions (only `superseded_by` stays one-way). The arrows therefore do not
  reflect stored-reference direction or relation type. For that use
  `research-vault related --format mermaid`.
  ```

**Spec 06 (edge model docs, `last_verified` fix)**
- No manifest change. Run `research-vault init --refresh-docs` to pick up AGENTS.md §5.1 (reference-field table) and the corrected §4 `last_verified` definition. `init --refresh-docs` rewrites AGENTS.md and taxonomy.json only; it never touches `meta/`, so hand-replace the first sentence of `meta/freshness-policy.md` §3 with:

  > Before citing any entry, compute `last_verified` ← the latest `verifications[].date` whose `result` is `confirmed` or `changed-trivially`; `outdated`, `unreachable`, and `inconclusive` do not reset the clock, and an entry with no confirming verification has no `last_verified` (null). It is NOT stored.

## [0.5.0] - 2026-08-18

### Changed
- **BREAKING: Node ≥22 required** (was ≥18; Node 18 is end-of-life). `check` now uses the stdlib `fs.globSync` instead of a hand-rolled glob matcher; CI matrix is Node {22, 24}.
- **SSRF guard rewritten on `net.BlockList`.** Same allowlist posture (IPv4 RFC 6890 denylist; IPv6 global-unicast 2000::/3 minus 2001::/23, 2001:db8::/32, 2002::/16), ~100 fewer hand-rolled parsing lines; test suite unchanged.
- Internal dedup from a repo-wide over-engineering audit: canonical type↔folder map in `fsutil.mjs`, shared staleness/`allowedValues`/`normalizeUrlSafe` helpers, `basename(path, '.md')` for id extraction, session-start summary inlined into the hook. No behavior change.

## [0.4.0] - 2026-07-16

- feat: tool-probe cross-validation — treat a tool's own CLI/help/schema output as a re-derivable primary source. New taxonomy values `tool-probe` (verification_method, offline-valid, same-version-gated) and `tool-output` (authority_basis); probe-manifest convention (`meta/probe-manifests/<tool>.md`, read-only commands only) with shared procedure `meta/prompt-templates/probe-tool.md`; lint `TOOL_OUTPUT_VERSION` requires `subject.version` on tool-output sources; capture/verify/orchestrate skills and AGENTS.md updated.

## [0.3.0] - 2026-07-07

### Changed
- **Manifest rows now carry `summary`.** Existing on-disk manifests will report `MANIFEST_STALE` once after upgrading; run `research-vault lint` to rebuild.
- **README rewritten audience-first.** The `refresh` and `export` sections now lead with when and why you'd use the feature instead of its internal mechanics; the exhaustive threat model (double-gating, hash-only, SSRF hardening) moved to a new `SECURITY.md`, linked from a short `Security & privacy` summary.
- **`research-orchestrate` Plan phase requires bodies.** The batch plan prompt now demands per-entry body prose and a one-sentence `summary`.

### Added
- **Extensible taxonomy per vault (`taxonomy_extensions`).** A repo's `.research-vault.json` may additively extend the controlled vocabularies (`domain`, `confidence`, `outcome`, `question_state`, `verification_method`, `verification_result`) so a vault can carry its own terminology without forking the plugin. Extension is additive only: a vault adds values, never removes or redefines built-ins, so a built-in value means the same thing in every vault and entries stay portable. Discovery is keyed on the bound vault (not the working directory), so the vocabulary is the same wherever a command runs. Map-valued taxonomy (`volatility`, `stage_by_folder`, `topic_aliases`) and the open `topics:` tag space are not extensible. Honored by `lint`, `capture`, and `verify`.
- **Body prose for authored entries.** `capture --body-file <path>` and a `body` key on `--batch` specs write real bodies for note/synthesis/snippet/question/experiment entries; a `body` on a source is rejected (source text stays behind `--store-body` + `--ack-data-egress`). Closes the live dry-run defect where batched entries landed as empty scaffolds.
- **`advise` stub-bodies signal.** Authored entries whose body is scaffold-only or empty are surfaced for curation.
- **`summary` field on notes and synthesis.** Optional one-line load-bearing claim in frontmatter (`capture --summary`): indexed in the manifest, scanned by `search --text`, exported as `{input: title, output: summary}` without the body gate, and nudged by a new advisory `WARN_MISSING_SUMMARY` lint warning plus an `advise` signal (`missingSummaries`). Existing vaults stay `lint --check`-clean.
- **Verification tenet — fetch before you assert.** A `source` whose only provenance is `captured` (never an independent check) is not authoritative: it now trips a new `WARN_SOURCE_UNVERIFIED` lint warning and is surfaced by `advise` (`unverifiedSources`). The rule is documented in the generated `AGENTS.md` §7, the `research-review` and `research-authoring` skills, and `docs/ORCHESTRATOR-INTEGRATION.md`. Model recall is not verification — for version currency it is reliably wrong because training lags the present; what cannot be fetched is a `question`, never a `source` stated as fact.
- **`SECURITY.md`** — the full security contract for the two outward-facing features (`refresh`, `export`), plus a vulnerability-reporting contact.
- **`capture --batch <plan.json>`.** Atomic multi-entry capture: every entry is validated (enums, required note `sources` / synthesis `contributingIds`, unresolved references) before anything is written. Later entries may reference earlier ones by deterministic id; duplicates come back as `skipped`, the content-changed tripwire as an error; one manifest rebuild per batch; JSON result on stdout.
- **`research-orchestrate` skill + `/research` command.** The reference implementation of `docs/ORCHESTRATOR-INTEGRATION.md`: vault-first lookup, multi-agent workflow (Recon → Sweep → Fetch+Seed → Verify → Plan → Persist+Gate) with eager source capture, the §2.6 capture plan batched through `capture --batch`, and a lint-gated synthesis. Degrades to an inline sequential lifecycle without the Workflow tool. Supersedes generic deep-research skills in vault-bound contexts.
- **`capture --answer-summary`** (and a batch `answer-summary` key) writes the question `answer_summary` field, making the default `export` reachable via tooling; a new `WARN_ANSWERED_NO_SUMMARY` lint warning nudges answered questions that would export nothing.
- **`init --refresh-docs`** regenerates an existing vault's `AGENTS.md` + `taxonomy.json` after a plugin upgrade — never touching entries, `meta/`, or `.gitignore`.
- **`advise` quote-residue signal** flags frontmatter scalars carrying baked-in `\"` from the pre-0.3.0 serializer.
- **Golden `AGENTS.md` snapshot** (`schema/AGENTS.golden.md`) makes the drift CI check real (generator vs. committed golden, not generator vs. itself).
- **`.research-vault.json` `defaults` + `references.globs` are now consumed** by `capture`/`check` (previously validated but inert).

### Fixed
- **Docs narrowed after a claims gate.** `AGENTS.md` and `docs/REFERENCE.md` say what the code says: the config pointer is written on the first `init` or `--set-default`, the Linux default honours `$XDG_DATA_HOME`, `research-teach` names the reader gate, `advise` lists quote residue, and two slash-command forms that no longer exist are gone. The orchestrate skill calls `--batch` validate-then-write, not atomic.
- **Frontmatter serializer is now lossless.** `parseScalar` un-escapes `\"` (the emit side already escaped it), ending the compounding quote-corruption every parse→serialize cycle used to add — automated by the PostToolUse hook. `[`-leading and comma-containing scalars are now quoted on emit so titles no longer round-trip into arrays.
- **Body bytes are preserved.** Trailing-whitespace normalization now applies to frontmatter lines only, not the body — Markdown hard breaks and trailing-space-significant snippet code survive capture/verify/fix/hook writes.
- **Freshness derives from confirming verifications only.** `unreachable`/`inconclusive` no longer reset the freshness clock; `last_verified` is computed from `confirmed`/`changed-trivially` results in one shared helper.
- **Lint no longer crashes on a malformed `source_url`** — it reports `URL_INVALID` instead of dying (exit 2) and discarding all other diagnostics. Scalar `domain:` is shape-checked (`FIELD_SHAPE`) before enum iteration. `MISSING_REQUIRED` now rejects empty strings/arrays.
- **Intra-batch dedup normalizes the pending side**, so normalization-equivalent URLs in one batch no longer create duplicate entries.

### Upgrading an existing vault

A vault created under 0.2.x is validated by the **current** plugin's schema (the tool never reads a vault's own `taxonomy.json`), so this release's lint tightening applies retroactively. Expect the following on first use after upgrading:

- **New hard-fail lint codes.** `MISSING_REQUIRED` now rejects *empty* values (not just absent ones), and `required_by_type` demands `source_url` (source), `sources` (note), `contributing_ids` (synthesis). Entries the **old tooling itself wrote** — an empty `source_url` when `--url` was omitted, or empty-array note/synthesis — now fail `lint --check` (exit 2). `URL_INVALID` and `FIELD_SHAPE` (scalar `domain:`) are likewise new. None are `lint --fix`-able; each needs a human edit (supply the missing URL/sources/contributors, or supersede the entry). This breaks the team-vault CI gate until fixed — audit with `research-vault lint` before upgrading CI.
- **Widened dangling-ref sweep.** Question `contributing` links are now dangling-checked; previously-invisible broken refs may surface.
- **One-time `MANIFEST_STALE`.** `last_verified` is now derived from *confirming* verifications only, so the on-disk manifest recomputes once — run any `lint`/`capture`/`verify` to rebuild. Side effect: entries whose latest verification was `unreachable`/`inconclusive` correctly **reappear** in `verify --stale`.
- **Quote-residue sweep (run BEFORE any post-upgrade write).** The pre-0.3.0 serializer escaped `"` on emit but never un-escaped on read, so repeatedly-rewritten scalars accumulated `\"`. The 0.3.0 parser strips exactly one level per read; the new lossless serializer then preserves whatever remains as genuine content — permanently — on the first `lint --fix`, `capture`, `verify`, or PostToolUse-hook write. Detect residue first:

  ```bash
  grep -rnF '\"' sources notes synthesis snippets experiments questions
  ```

  `research-vault advise` also lists affected entries under **quote residue**. Fix by hand before the first write.
- **Refresh docs.** Run `research-vault init --refresh-docs` to regenerate this vault's `AGENTS.md` + `taxonomy.json` so agents see the new `--answer-summary` flag, corrected export semantics, and `WARN_ANSWERED_NO_SUMMARY`.
- **Body trailing whitespace already stripped by an older write is unrecoverable** — the 0.3.0 serializer preserves bodies going forward, but cannot restore hard breaks a prior write destroyed.

## [0.2.1] - 2026-06-01

A bug-fix release closing gaps an adversarial review surfaced: documented behavior
that did not hold, plus two paths that could mutate canonical vault data.

### Fixed
- **Docs narrowed after a claims gate.** `AGENTS.md` and `docs/REFERENCE.md` say what the code says: the config pointer is written on the first `init` or `--set-default`, the Linux default honours `$XDG_DATA_HOME`, `research-teach` names the reader gate, `advise` lists quote residue, and two slash-command forms that no longer exist are gone. The orchestrate skill calls `--batch` validate-then-write, not atomic.
- **`lint --fix` now normalizes via the CLI.** It was imported but never invoked, so `--fix` only rebuilt the manifest; it never stripped BOM/CRLF or re-serialized frontmatter.
- **`obsidian --out` can no longer overwrite canonical entries.** A `--out` that escapes the vault, is the vault root, or targets an entry folder (e.g. `--out sources`) is refused.
- **`export --out` can no longer write inside the vault**, preserving the read-only-on-the-vault guarantee.
- **`capture` refuses to overwrite an existing id** (same date + title) instead of silently clobbering; supersede via `verify` instead.
- **Integer `subject.version` now dedups correctly** (the URL + version comparison no longer fails on a string-vs-number mismatch).
- **`capture --content-file` hashes the file's raw bytes**, matching what `refresh` computes (previously it hashed a UTF-8 decode).
- **`init` refuses to overwrite a non-empty or customized vault**, not just one that already has entries.

### Changed
- **`capture` seeds a `captured` verification** at creation time instead of a fake `existence-check: confirmed`; `verify` rejects `captured` as a verification method.

### Added
- **`captured` verification method** in the taxonomy (capture-time provenance; not a verification).

## [0.2.0] - 2026-05-31

Completes the lint "detective floor", then adds five new commands plus richer
ingest and two derived-view exporters — all additive and preserving the
zero-dependency, hand-editable core. `lint --check` remains the only correctness
guarantee; every new artifact is a regenerable cache, never a source of truth.

### Added
- **`compile`** — regenerate a human-readable index into a git-ignored `_index/` directory (grouped by type); a derived cache, never authoritative.
- **`advise`** — read-only curation report (stale entries, orphans, sources lacking a distilling note, aliasable topics), plus a `research-librarian` skill. Never mutates the vault.
- **`obsidian`** — derived, non-mutating Obsidian view: one `[[wikilink]]` stub per entry (forward links + backlinks) plus a Map-of-Content, written to a git-ignored `_obsidian/` directory.
- **`refresh`** — opt-in web freshness re-check: fetch a source URL, recompute its `content_hash`, and report `confirmed` / `changed` / `unreachable` without mutating any entry. Off by default and double-gated (`RESEARCH_VAULT_ALLOW_NETWORK=1` **and** the subcommand).
- **`export`** — read-only JSONL export for external finetuning/eval; emits answered-question summaries + per-entry metadata by default.
- **`capture --scaffold`** — opt-in per-type body skeletons (`vault-template/meta/entry-skeletons/<type>.md`).
- **`capture --content-file` / `--captured-via` / `--store-body`** — hash content from a local file, record provenance, and (with `--ack-data-egress`) store source text in the body. No network.
- Non-blocking **`SessionStart`** Claude Code hook that prints a one-line vault summary (entries + stale count).
- **`search --body`** — opt-in substring scan of entry bodies.
- **`vault-template/.gitignore`** so initialized vaults ignore derived caches (`.vault-manifest.json`, `_index/`, `_obsidian/`).
- New slash commands: `/research-advise`, `/research-compile`, `/research-obsidian`.

### Changed
- **Detective floor completed.** `lint` now validates every controlled enum (`confidence`, `outcome`, `question_state`, verification `by_type`), and `lint --check` compares the **full** manifest — including `backlinks` — for staleness; the manifest is canonicalized (sorted entries + backlinks) for determinism.
- **Fail-fast mutators.** `capture` and `verify` reject unknown controlled values up front via a shared `bin/lib/validate.mjs`, writing nothing on a bad value.
- `verify` now validates `result` against the taxonomy and refuses `outdated` without `--superseded-by`.
- `listStale` moved to `bin/lib/stale.mjs` (removes a `lib → commands` import).
- Spec aligned with the implementation: retired `INDEX.md`, `taxonomy.yaml` → `taxonomy.json`, documented `search --body`, corrected the generated-`AGENTS.md` framing.
- README: command surface synced (all 12 commands), added "Two ways to use it" (prose vs. command) and "Team use" sections, renamed Security → "Security & privacy".

### Fixed
- **Docs narrowed after a claims gate.** `AGENTS.md` and `docs/REFERENCE.md` say what the code says: the config pointer is written on the first `init` or `--set-default`, the Linux default honours `$XDG_DATA_HOME`, `research-teach` names the reader gate, `advise` lists quote residue, and two slash-command forms that no longer exist are gone. The orchestrate skill calls `--batch` validate-then-write, not atomic.
- **Hook path containment.** Replaced the unsafe `startsWith` vault-containment check with a resolved-path, separator-aware `isInsideVault` (rejects siblings like `<vault>-evil` and cross-drive paths); switched the hook to exec-form invocation.

### Security
- **`refresh` SSRF guard (allowlist posture).** Only global-unicast addresses are accepted; all RFC 6890 private / loopback / link-local / CGNAT / ULA / documentation / multicast / reserved ranges are rejected — including IPv4-mapped/translated/compatible IPv6 forms, 6to4, NAT64, the cloud-metadata address `169.254.169.254`, and alternate numeric host encodings. The socket is pinned to the pre-validated IP (no re-resolution, no pooling), every redirect hop is re-validated, scheme downgrades are forbidden, and body-size + timeout caps bound each request; no cookies or auth headers are sent.
- **Data-egress gating.** `export` emits entry bodies only with **both** `--include-bodies` and `--ack-data-egress` (metadata-only by default); `capture --store-body` likewise requires `--ack-data-egress`.

## [0.1.0]

Initial release.

### Added
- Zero-dependency Node ≥18 ESM CLI: `init`, `lint`, `capture`, `verify`, `search`, `related`, `manifest`.
- Schema-driven taxonomy (`schema/taxonomy.json` + `schema/frontmatter.schema.json`) as the single source of truth for vocabulary and field rules.
- Six entry types (sources, notes, synthesis, snippets, experiments, questions) with a deliberate `sources → notes → synthesis` distillation flow.
- Freshness governance: per-entry `volatility` tiers + a verification log; URL + version dedup; a computed backlink manifest.
- `lint` / `lint --check` correctness floor; generated `AGENTS.md`; encoding/drift CI gates across {Linux, macOS, Windows} × Node {18, 20, 22}.
- Claude Code plugin: skills (`research-vault-usage`, `research-capture`, `research-verify`) and an optional `PostToolUse` lint-fix hook.
