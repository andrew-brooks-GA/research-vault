# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
