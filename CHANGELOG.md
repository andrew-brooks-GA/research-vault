# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
