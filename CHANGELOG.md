# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`research-teach` skill and `/research-teach` command.** A multi-session teaching workspace (mission, lessons, reference docs, learning records; pedagogy adapted from Matt Pocock's MIT `teach` skill) wired to the vault: resources are `source` entries, gaps are `question` entries, reference facts are `note` entries, and every behaviour claim is probed with the run kept under `evidence/`.
- **Pre-web hook.** Before every `WebFetch` or `WebSearch`, `hooks/pre-web.mjs` searches the vault for the URL and the query terms and hands up to five matching entries (stale ones flagged) to the model as context, or says nothing matched and to capture before citing. It never blocks the call.
- **`claims-reviewer` agent.** A fresh, read-only reviewer that enumerates a draft's claims against the recorded evidence only and returns `PASS` or `FAIL-as-sent`. The vault is the only evidence: `source`/`note` entries for what a document says, `snippet` entries for code, `experiment` entries for the log of a local run. A cited URL or file counts only through its entry; the reviewer never fetches or runs anything.

### Fixed
- **Single-quoted scalars are parsed.** `title: 'Tool: X'` used to be read with its quotes as literal text, and the next rewrite (`verify`, `lint --fix`) stored it as `title: "'Tool: X'"`. Quotes are now stripped and `''` decodes to `'`. Frontmatter written by other YAML tools was the common trigger: yq 4.53.2, for example, writes a string containing `: ` single-quoted.
- **Flow sequences respect quotes.** `topics: ["a, b", c]` is two items, not three fragments.
- **Inline comments are dropped.** `status: active # note` is `active`, as in YAML. A `#` with no space before it (`https://host/a#frag`) is still content.
- **Block scalars parse.** Top-level `|` and `>` values, with `-`/`+` chomping and an indentation indicator, no longer fail the whole entry with `unparseable frontmatter line`. A top-level multi-line string is written back as a literal block. Block scalars inside `subject` or `verifications` items remain unsupported and now fail with a clear error instead of reading the next line as a sibling key.
- **Scalar edge fields were iterated as strings (spec 01).** `source_id` (snippet) and `prompt_id` (experiment) are scalars; the manifest's backlink builder spread them character by character, so the referenced source or prompt never received the backlink and `related`, the Obsidian stub, and `advise` orphan detection all missed it. Scalars are now wrapped before iteration; empty values are skipped.
- **`last_verified` definition now matches the code (spec 06).** AGENTS.md §4, `meta/freshness-policy.md` §3, and the `research-vault-usage` skill §2 said `max(verifications[].date)`; the tool counts only verifications whose `result` is `confirmed` or `changed-trivially`. The docs now say so.
- **Piped CLI output was truncated at 64 KB.** The entry point called `process.exit()` right after writing, which drops unflushed stdout on a pipe, so `advise --json | jq` or `manifest | jq` on a large vault failed with a JSON parse error. It now sets `process.exitCode`; exit codes are unchanged.

### Added
- **`WARN_QUOTE_ARTIFACT` lint warning, fixed by `lint --fix`.** Flags a string value that is itself a complete single-quoted scalar (the damage the parsing bug above left behind) and unwraps it. A value like `'a' and 'b'` is not a valid single-quoted body and is left alone.
- **Bounded traversal for `related` (spec 03).** `related <id> [--depth N] [--direction out|in|both] [--rel a,b]` walks the typed graph with a breadth-first search (shared helper `bin/lib/graph.mjs`): `--depth 2 --direction out <synthesis>` returns the evidence chain, `--direction in <source>` returns what depends on it, `--rel` restricts the relations followed. JSON output gains `depth`, `direction`, and `nodes` (`id`, `distance`, plus `type`/`title`/`status`/`volatility`/`last_verified` from the manifest row, or `missing: true` for a dangling id); `edges` is the induced subgraph over the reached nodes. `forward`/`backlinks` stay the depth-1 unfiltered compatibility arrays. Invalid `--depth`/`--direction`/`--rel` exit 2 with a usage message. Mermaid output labels every edge (`a -->|rel| b`) and renders an isolated root as a lone node.
- **Stale evidence in `advise` (spec 04).** New `staleEvidence` section: for every active note/synthesis, the `sources`/`contributing_ids` chain is walked transitively and each reached entry that is `superseded` or past its volatility window is reported with its shortest path (`{ id, via: [{ id, reason: "stale"|"superseded", path }] }`). The dependent's own `last_verified` is not rewritten; advisory only, no lint rule, `check --check` unchanged. `advise(vaultPath, repoRoot, { now })` and `listStale(vaultPath, { now, manifest })` share one clock and one manifest. The text renderer gains a `stale evidence (N)` section.
- **Tags on Obsidian stubs (spec 05).** Every `_obsidian/` stub now opens with a `tags:` frontmatter block: `type/<type>`, `status/<status>`, one `domain/<d>` per domain, `volatility/<v>` when set, `freshness/<fresh|stale|unassessed>` (a snapshot as of the run), and one `topic/<t>` per topic normalised to Obsidian-safe ASCII (`C++ Build Tools` → `topic/c-build-tools`, duplicates collapse, empty results skipped). The "_Derived Obsidian view_" header line states the freshness date. `obsidianView(vaultPath, outDir, { now })` accepts a `Date`. Obsidian graph groups and filters (`tag:#freshness/stale`) colour the graph by what matters; `meta/obsidian-view.md` gains a "Graph groups" section.
- **Edge model in the docs (spec 06).** `schema/frontmatter.schema.json` gains a documentation-only `edge_fields.intended_targets` map (lint and capture do not read it; enforcement remains an open question). The generated AGENTS.md gains §5.1 "Reference fields (the vault graph)", a table of every reference field with the type it is intended on, its intended target, and whether it forms a backlink, plus a note that stored references point from the declaring entry to the referenced one (the reverse of the lifecycle flow for `sources`/`contributing_ids`). The README gains the stored-reference diagram after the lifecycle diagram.

### Added (round 2 graph specs)
- **Graph playbook in AGENTS.md (spec 07).** Generated §5.2 "Asking the graph": a question-to-command table (evidence chain out, dependents in, conflict candidates, replacement, currency), the route-first and plan-then-run rules, what each node row carries, and one-line relation meanings. §8 gains the supersession recipe (`verify --result outdated --superseded-by`). The `research-vault-usage`, `research-orchestrate` and `research-capture` skills point at it; capture adds a pairwise conflict-review step before writing a note.
- **Node metadata (spec 08).** `schema/frontmatter.schema.json`: optional `summary` on `source`, optional `confidence` on `synthesis`; `capture` persists both (no default for synthesis confidence). Manifest rows gain `stage`, `state`, `confidence`, `outcome`, `authority_tier`, `authority_basis`, `superseded_by` (`null` when absent). `related` `nodes[]` gain those plus `summary`, `subject`, `series`. `search --json` inherits the row fields.
- **Superseded entries hidden from `search` (spec 09).** Rows with `status: superseded` are dropped unless `--include-superseded` (a boolean flag); with the flag the text line ends ` (superseded by <id>)`. `related`, `advise`, `check` unchanged.
- **Paired evaluation protocol (spec 10).** `docs/EVALUATION.md`: frozen inputs, 20-question pilot, two conditions, metrics, offline ranking and link-candidate checks. Results gate any further graph feature.

### Added (round 3 claims gate, spec 11)
- **`gate` command.** `research-vault gate evidence <draft> [--extra <ids>] [--json]` derives the evidence list from the vault ids and URLs the draft cites, one line per entry (`<id> [<type>, <status>, STALE?, no-body?]`) plus `uncovered:` lines for citations with no entry. `no-body` marks a `source` or `note` whose body after the title line is under 200 characters. `gate record <file> <PASS|FAIL-as-sent|MERIT> [note]` appends a verdict to the claims ledger keyed to the file's sha256; `gate status <file> [--check]` prints the verdict for the current content, and `--check` exits 1 when there is no `PASS` or `MERIT`. The ledger is `.research-vault-ledger.jsonl` at the root of the bound repo (the directory holding `.research-vault.json`). A vault entry outside any bound repo is gated too, with the ledger inside the vault and vault-relative keys; a file in neither exits 2.
- **Stop hook.** `hooks/stop-gate.mjs` blocks the end of a turn when a gated file changed since the session's transcript was created, or within the last twelve hours when the transcript has no birth time, and has no `PASS` or `MERIT` row for its current content; it steps aside when the hook input carries `stop_hook_active`. Gated files are `lessons/*.html` and `reference/*.html` in every teach workspace (a directory holding `MISSION.md`) found under the bound repo, skipping `.git`, `node_modules`, `.idea`, `_obsidian`, `_index`, `_attachments` (the same set `check` skips), the vault and unreadable directories, plus the project's `gates.globs`. Silent outside a bound repo; when it fails open on an error it writes one `research-vault: stop-gate skipped (<message>)` line to stderr and no decision. Vault syntheses are not hook-gated unless `gates.globs` names them (globs expand from the bound repo root, so this reaches a vault inside the repo); the orchestrate skill runs the gate as a step.
- **`research-claims-gate` skill and `/research-claims-gate` command.** Runs `check --check` on the draft, derives the evidence with `gate evidence`, dispatches one `research-vault:claims-reviewer` with only the draft path, vault path and that list, fixes and re-runs on `FAIL-as-sent`, decides surviving findings on merit in an append-only `GATE-LOG.md` after round two, and records the verdict with `gate record`. `research-teach` lessons and reference docs, `research-orchestrate` syntheses and `research-authoring` documents matching `gates.globs` all go through it.
- **Write-time citation warning.** After an `Edit` or `Write` in a bound repo, `hooks/post-tool-use.mjs` checks a file matching `references.globs` or a gated file and hands each `uncovered` or `stale` citation to the model as context, so capture happens before the gate. An edit inside the vault takes the lint branch instead, so the warning applies only to edits outside the vault. It never blocks.
- **Session brief per teach workspace.** When the vault resolves from a `.research-vault.json` at or above the cwd, `hooks/session-start.mjs` walks that repo from its root and prints one line per teach workspace with learning records older than 21 days or reference docs carrying a stale citation.
- **Probe reruns are recorded.** In `research-teach`, a failing `run.sh` gets a line in `evidence/NNNN/RERUNS.md` (`harness-infra` or `hypothesis-relevant`, plus the fix) before any rerun.
- **Claims gate fixtures.** `test/fixtures/gate/` holds a lesson expected to pass and one expected to fail for overclaiming (`gold.json` holds the expected verdicts); the fixture vault comes from `fixtureVault()` in `test/helpers.mjs`. `docs/EVALUATION.md` gains the protocol for running the reviewer on them. `test/agent.test.mjs` checks the agent file's tools, model, effort and rules.

### Changed
- **Rewrites keep unchanged frontmatter byte-identical.** `verify` re-emits the original lines of every key they did not change, in the original order; a new key (for example `updated`) is placed at its canonical position. Previously one `verify` reserialized every key: block lists became flow lists and keys were put into canonical order. `lint --fix` still normalizes everything, deliberately.
- **Writes outside a project binding say where they went.** When `capture`, `verify` or `lint --fix` resolves the vault through the user config pointer or the OS default, it prints a one-line notice with the vault path to stderr. Run from the wrong directory, these commands no longer write silently into another vault.
- **`AGENTS.md` header** now says it is generated from the plugin's `schema/`, not a `schema/` inside the vault.
- **Typed edges in the manifest (spec 02).** `.vault-manifest.json` gains a top-level `edges` array of `{from, rel, to}` triples, one per stored reference across all seven edge fields (`related`, `contributing_ids`, `sources`, `source_id`, `prompt_id`, `contributing`, `superseded_by`), sorted by `(from, rel, to)` and deduplicated. `backlinks` is now derived from the backlink-forming rels (policy unchanged: `superseded_by` forms no backlink). Rows are unchanged.
- `related`: `forward` now covers all seven rels (previously only `related`/`contributing_ids`/`sources`) and is sorted; JSON output gains `edges` (including an incoming `superseded_by`, which never appears in `backlinks`). At the defaults (`--depth 1 --direction both`) the reached set is `forward ∪ backlinks ∪ {entries naming this id in superseded_by}`; the last term and the root node at distance 0 are new.
- `obsidian`: the stub's Links section groups wikilinks under one `### <rel>` heading per relation.
- `advise`: orphan detection reads `edges` instead of re-walking the vault.

### Changed (round 3 claims gate, spec 11)
- **Reviewer model pinned.** `agents/claims-reviewer.md` sets `model: opus` and `effort: high`. The agent gains two rules: an entry flagged `no-body` supports only that the document exists and concerns the subject, so a behaviour claim resting on it is `exceeds-evidence`; and an entry the reviewer finds by searching the vault that is not on the evidence list and contradicts the draft is reported `contradicted (not on evidence list)`. It is instructed never to read `GATE-LOG.md`.
- **In-draft marker retired.** The `<!-- claims-gate: PASS <date> -->` comment is no longer written; the verdict lives in the ledger, keyed to the content, so an edit after the gate reopens it. Old markers are ignored.
- **`gates.globs` in `.research-vault.json`.** An optional array of repo-relative globs naming further files the claims gate covers; `parseProjectConfig` keeps it and rejects a value that is not an array.
- **`research-teach` §5** is now a pointer to the `research-claims-gate` skill.
- **URLs in code are not citations.** `check`, `gate evidence` and the citation hooks ignore URLs and vault ids inside fenced code blocks and inline code spans. `check` lists each value found only in code as `skipped (in code): <file>  <value>` (a `skipped` array in `--json`), and `check --check` does not count them. A stray closing backtick after a bare URL is trimmed.

### Upgrading an existing vault

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
