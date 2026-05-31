# Research Vault Plugin — Design

**Date:** 2026-05-27
**Owner:** Andrew Brooks
**Status:** Draft (brainstorming output, pending user review)
**Supersedes scope of:** `2026-05-06-research-vault-design.md` (that spec defined the storage scaffold; this one defines the portable, distributable plugin that ships and operates the scaffold).

---

## 0. Goals & non-goals

### Goals
- Package the research-vault scaffold + tooling as a **plugin** installable in Claude Code **and** usable by any other LLM/agent system (Codex, Gemini, Cursor, bare file-access agents).
- Run on **Linux, macOS, and Windows**.
- Be **totally self-contained**: no references to any personal directory; nothing that breaks on another person's machine.
- Keep the **vault data separate from the plugin**: the plugin is read-only tooling; the vault is read-write data discovered at runtime.
- Preserve every governance guarantee of the `2026-05-06` design (cache-not-truth, volatility/freshness, mutate-vs-supersede, derived-not-stored fields, controlled vocabulary).
- Fix the defects found in the 2026-05-27 review (mojibake/BOM in `AGENTS.md`, stale hardcoded path, spec↔`AGENTS.md` duplication drift, offline-mode contradiction) — structurally, so they cannot recur.

### Non-goals
- No bundled personal content. The user's existing entries (`effective-go`, `cpp-core-guidelines`, `style-for-clion-programming`) are private data and migrate to the user's own vault, never into the plugin repo.
- No semantic/vector search in v1 (documented as a deferred optional stage).
- No graph database. No automatic web re-fetch pipeline. No embeddings.
- No npm runtime dependencies; no language runtime required for basic hand read/write.

---

## 1. Architecture (Approach A — plugin wrapping a portable core)

One git repo, named `research-vault`, with **two access paths over one shared core**:

1. **Claude Code** installs it as a plugin → native slash commands + auto-invoked skills + Node tools (richest tier).
2. **Other agents / humans** clone the repo, run `init`, then read the vault's generated `AGENTS.md` and invoke the Node tools directly, or operate the vault entirely by hand (no Node required for basic read/write).

The load-bearing invariant: **the vault is self-describing.** Drop any agent into the vault directory and `AGENTS.md` tells it everything. The plugin is an accelerator, never a prerequisite.

### 1.1 Repository layout

```
research-vault/                     # plugin repo (read-only once installed)
├── .claude-plugin/
│   └── plugin.json                 # Claude Code manifest (name, version, commands, skills); no hooks in v1
├── commands/                       # slash commands — thin wrappers over bin/
│   ├── research-init.md
│   ├── research-lint.md
│   ├── research-capture.md
│   ├── research-verify.md
│   ├── research-search.md
│   └── research-related.md
├── skills/                         # auto-invoked, prompt-driven, zero-dependency workflows
│   ├── research-vault-usage/       # navigation + freshness + citation rules (the portable "brain")
│   ├── research-capture/           # authoring an entry by hand
│   └── research-verify/            # freshness/verification decision tree
├── bin/
│   ├── research-vault.mjs          # single Node entrypoint: init|lint|capture|verify|search|related|manifest
│   └── lib/
│       ├── resolve.mjs             # vault discovery
│       ├── frontmatter.mjs         # parse/serialize the controlled YAML subset
│       ├── schema.mjs              # loads schema/* — the single source of truth
│       ├── manifest.mjs            # build/read .vault-manifest.json
│       └── agentsmd.mjs            # generate AGENTS.md from schema/
├── schema/
│   ├── taxonomy.yaml               # controlled vocabulary + topic-alias map — SINGLE SOURCE OF TRUTH
│   └── frontmatter.schema.json     # per-type field definitions — SINGLE SOURCE OF TRUTH
├── vault-template/                 # what `init` copies to the user's chosen location
│   ├── AGENTS.md                   # GENERATED from schema/ (checked in; CI verifies it matches)
│   ├── CLAUDE.md                   # stub → AGENTS.md
│   ├── GEMINI.md                   # stub → AGENTS.md
│   ├── README.md
│   ├── INDEX.md
│   ├── meta/
│   │   ├── freshness-policy.md
│   │   ├── refresh-queue.md
│   │   └── prompt-templates/{summarize-source,promote-to-synthesis,verify-entry,verify-audit}.md
│   └── {sources,notes,synthesis,snippets,experiments,questions}/INDEX.md
├── test/                           # node:test suites + fixtures/
├── docs/specs/                     # design spec(s)
├── .gitattributes                  # *.md text eol=lf
├── README.md                       # human-facing install + quickstart
└── LICENSE
```

### 1.2 Single source of truth

`schema/taxonomy.yaml` + `schema/frontmatter.schema.json` are the only definitions of the vocabulary and field rules. The linter, the `capture` command, and the `AGENTS.md` generator all read them. Adding a `domain` value or a verification method in one place propagates everywhere — eliminating the spec↔`AGENTS.md` drift class found in the review. `vault-template/AGENTS.md` is a generated artifact; CI regenerates and diffs it.

---

## 2. Vault discovery & runtime mechanics

### 2.1 Resolution order
1. `--vault <path>` CLI flag (explicit override).
2. `$RESEARCH_VAULT_PATH` environment variable.
3. Pointer file `config.json` at the OS config location (written by `init`).
4. OS-appropriate default data location.
5. None resolve and a vault is required → clear error instructing the user to run `research-init`.

The env var always wins over the pointer file, so a user can target a different vault per shell session without rewriting config. Two-layer discovery (ephemeral env override + durable pointer) is what keeps it portable without losing state across terminals.

### 2.2 OS-appropriate paths

Resolved at runtime via `os.homedir()`, `process.platform`, and `process.env` — never hardcoded, never string-concatenated.

| OS | Default vault data | Pointer/config file |
|---|---|---|
| Linux | `$XDG_DATA_HOME/research-vault` → `~/.local/share/research-vault` | `$XDG_CONFIG_HOME/research-vault/config.json` → `~/.config/research-vault/config.json` |
| macOS | `~/Library/Application Support/research-vault` | `~/Library/Application Support/research-vault/config.json` |
| Windows | `%LOCALAPPDATA%\research-vault` | `%APPDATA%\research-vault\config.json` |

`config.json` shape: `{ "vaultPath": "<absolute path>" }`.

### 2.3 `init` behavior (idempotent)
1. Resolve target (flag > env > default). Print the target. Refuse to clobber a non-empty existing vault unless `--force`.
2. Copy `vault-template/` → target; generate `AGENTS.md` from `schema/` into the target.
3. Write the `config.json` pointer.
4. **Print** (never silently edit) the per-OS shell-profile line to set `$RESEARCH_VAULT_PATH`.

### 2.4 How each consumer locates the vault
- **Claude Code**: slash command → `node ${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs <cmd>`. `CLAUDE_PLUGIN_ROOT` locates `bin/` only — never the vault.
- **Other agents / humans**: `node /path/to/research-vault/bin/research-vault.mjs <cmd>`, or read `$RESEARCH_VAULT_PATH/AGENTS.md` and operate by hand.

### 2.5 Node baseline
Node ≥18 (global `fetch`, stable ESM, `structuredClone`). No `package.json` dependencies — stdlib only. Node is required only for the convenience tools, never for hand read/write.

---

## 3. Frontmatter handling (zero-dependency YAML)

Node has no built-in YAML and we add no dependency. The frontmatter contract is a narrow, known shape (scalars, flat string lists, and one list-of-maps for `verifications[]`, plus the optional `subject`/`series` block). We implement a **dedicated parser/serializer for exactly that subset**, and the linter **rejects anything outside it**. This makes frontmatter canonically formatted, deterministic to diff, and impossible to drift into exotic YAML the tools can't read. Markdown bodies (after the closing `---`) pass through untouched.

---

## 4. Schema changes from the 2026-05-06 design

All prior common fields and per-type fields carry over unchanged except the additions below. Derived-not-stored fields (`id`, `last_verified`, `folder`) remain derived.

### 4.1 New optional fields for versioned resources (`source`, `note`)

```yaml
subject:
  name: vcluster          # the software/product the entry describes
  version: "0.19"         # the product version (NOT source publication date)
series: vcluster-docs-configuration   # version-independent grouping id (kebab-case)
```

- **Optional.** Most sources (books, papers, articles) are not version-bearing; the fields are omitted there.
- `subject.version` is the product/software version, distinct from `source_date` (publication date).
- `series` is a stable, version-independent identifier shared across all version entries of the same resource.
- `lint` validates them when present; warns when a `fast`-volatility `docs` source from a known-versioned domain lacks `subject.version`.

### 4.2 Composite identity / dedup key
The dedup key for sources is `(normalized_url, subject.version)`, not URL alone. Capturing a new product version from a stable "latest" URL produces a **distinct** entry rather than a false duplicate.

- `content_hash` is a tripwire: same URL + same hash → true duplicate (skip); same URL + **different** hash → ambiguous, surfaced to the agent/user as a three-way decision: (a) page edited → verify/update, (b) new version → capture as new sibling, (c) substantively wrong → supersede.

### 4.3 Version succession ≠ supersession (new rule)
When a newer product version ships, the older entry is **not** wrong — it still correctly describes its version, and users may still run it. Therefore:
- Version succession does **NOT** trigger supersession. Both entries stay `status: active`, linked by a shared `series:`.
- Supersession remains reserved for entries that are **incorrect or obsolete**, independent of versioning.
- Three distinct "this changed" axes, kept separate: **supersession** (entry was wrong) · **verification/update** (same source changed cosmetically) · **version succession** (world moved on; old entry still true for its version).

### 4.4 Volatility interaction
An entry pinned to a specific version (`subject.version` set) is more stable than one tracking "latest"; pinning can justify a lower volatility tier, reducing re-verification churn. The usage/freshness skill requires **citing the version** for version-bearing entries ("per vcluster 0.19 docs…").

### 4.5 Topic-alias map
`schema/taxonomy.yaml` gains an alias map (e.g., `tdd ⇆ test-driven-development`). `capture` normalizes `topics:` through it; `search` expands queries through it; `lint` warns on un-aliased near-duplicates. Cheap lexical-matching accelerant, ~80% of the "semantic" benefit at no dependency cost.

---

## 5. Retrieval layer (manifest + queries)

### 5.1 `.vault-manifest.json` (derived build artifact)
Lives at the vault root; rebuilt by `lint`, `capture`, and `research-vault manifest --rebuild`. One row per entry:

```
id, type, title, domain, topics, source_url (normalized), content_hash,
volatility, last_verified, status, subject, series,
related, contributing_ids, sources
```

Plus a computed `backlinks` map (reverse edges of `related`/`contributing_ids`/`sources`).

- It is a **cache** — regenerable from the markdown, which remains the source of truth. `.gitignore`'d by default.
- `lint --check` detects a stale manifest (manifest vs. on-disk reality) for CI.
- Agents read the manifest instead of walking files: solves "enumerate every file / read line by line."

### 5.2 Dedup before capture
`capture` normalizes the incoming `source_url` (strip tracking params, trailing slash, scheme-case) and checks the manifest (and `content_hash`) **before** fetching. On a hit it surfaces the existing entry + freshness state and routes to `verify` rather than re-fetching — the concrete fix for "re-pull even if local."

### 5.3 Read-only query commands
- `research-vault search` — facet/keyword query over the manifest: `--domain`, `--topic`, `--type`, `--text`, `--series`. No body reads. The skill describes the manual grep equivalent for no-Node agents.
- `research-vault related <id>` — forward edges + computed backlinks; `--format mermaid` optional. Sibling versions surface automatically via shared `series`.

### 5.4 Deferred (documented, not built)
Optional `sqlite-vec` semantic-search MCP, built from the same manifest — Stage 4 (>500 entries, fuzzy semantic overlap). It conflicts with self-contained/offline/portable goals (needs an embedding model, a second source of truth to keep in sync, a non-diffable binary index), so it is **never a core dependency** — an additive layer only.

---

## 6. Claude Code plugin surface

### 6.1 `.claude-plugin/plugin.json`
Declares name, version, description; points at `commands/`, `skills/`, and the **optional** hook (§9.6.3). Exposes `${CLAUDE_PLUGIN_ROOT}` to commands for locating `bin/`. The hook is opt-in and non-load-bearing — correctness never depends on it (§9.6).

### 6.2 Slash commands (thin wrappers)

| Command | Action |
|---|---|
| `/research-init` | Runs `init`; reports the profile line to set `$RESEARCH_VAULT_PATH` |
| `/research-lint` | Runs `lint --json`; summarizes violations; offers `--fix` for safe normalizations |
| `/research-capture` | Gathers type/title/url/version; runs `capture`; confirms path; surfaces dedup hits |
| `/research-verify` | Runs `verify --stale`; walks through verifying an entry |
| `/research-search` | Runs `search` with facet/text args |
| `/research-related` | Runs `related <id>`; optional mermaid graph |

### 6.3 Skills (auto-invoked, prompt-driven, zero-dependency)
- **`research-vault-usage`** — reading/navigating/citing the vault and applying freshness before citing. Triggers when answering an SE/LLM-dev question with a vault present. Lean SKILL.md that points to `meta/freshness-policy.md` for the long rules (progressive disclosure).
- **`research-capture`** — correct authoring by hand (frontmatter from schema, backlinks, INDEX update, supersede-don't-rename, version handling).
- **`research-verify`** — verification/freshness decision tree, offline mode, self-confirmation rule.

Skills reference the Node tools as the fast path but always describe the manual procedure, so they degrade gracefully when Node is absent.

---

## 7. Cross-agent story (three access tiers)

1. **Claude Code** — plugin install: slash commands + skills + Node tools. Richest.
2. **Other agentic CLIs (Codex, Gemini, Cursor, …)** — clone + `init`. They don't read Claude skills, but the **generated `AGENTS.md`** in the vault carries the same navigation/freshness/authoring rules (Codex reads `AGENTS.md` natively; Gemini via `GEMINI.md` stub; others via their own pointer). Invoke Node tools directly.
3. **No-Node / minimal environments** — read `AGENTS.md`, operate by hand. Everything the tools do is also specified as prose, so nothing is *only* expressible as code.

The split between **commands** (deterministic, shell out to Node) and **skills** (judgment, prose, runtime-free) is what lets one codebase serve a Node-rich Claude Code install and a bare file-access agent alike. Commands are the fast path; skills are the floor.

---

## 8. Migrating the user's existing content out of the plugin

1. The plugin repo ships with **no** entry content — only `vault-template/` with empty INDEX files.
2. The user runs `research-vault init` to scaffold a private vault at the resolved location, then moves their three existing entries (`effective-go`, `cpp-core-guidelines`, `style-for-clion-programming`) into it.
3. **Fix-on-migrate** (review findings): the `style-for-clion-programming` synthesis legitimately references the user's machine path — that stays in the user's *private* entry; nothing personal enters the plugin repo. The `AGENTS.md` BOM/mojibake and stale-path defects vanish because `AGENTS.md` is regenerated from `schema/`.
4. The current `Research/` directory effectively splits: portable bits → `schema/` + `vault-template/` in the plugin; the user's entries → the user's private vault.

---

## 9. Tooling internals (commands)

### 9.1 `init` — §2.3.

### 9.2 `lint` — the guardrail (non-zero exit on violations)
Walks every `*.md`; checks against `schema/`:
- **Encoding**: UTF-8, no BOM, no double-encoded mojibake, no CRLF in `.md` → hard fail. (Directly prevents the review's worst bug.)
- **Stored derived fields**: `id` or `last_verified` present → fail.
- **Stage↔folder**: stage legal for its folder → fail.
- **Enums**: controlled values exist in `taxonomy.yaml` → fail.
- **Referential integrity**: every `related`/`contributing_ids`/`sources`/`source_id`/`prompt_id`/`superseded_by` id resolves → fail on dangling ref.
- **Filename = id**, slug rules, required per-type fields present.
- **Supersession integrity**: `status: superseded` ⇒ `superseded_by:` set and resolves.
- **Version fields**: `subject`/`series` well-formed when present; warn on missing `subject.version` for `fast` `docs` from known-versioned domains.
- **Manifest integrity**: `.vault-manifest.json` matches on-disk reality (`--check`).
- Output: human table by default; `--json` for CI; `--fix` only for safe normalizations (BOM strip, frontmatter re-serialize, INDEX/manifest regen) — never touches claims.

### 9.3 `capture` — authoring helper
`capture --type <t> --title "..." [--url ... --subject-name ... --subject-version ... --series ... --related id,...]`. Computes filename/id, fills required frontmatter from `schema/` with an initial `verifications[]` line, writes only an `# <title>` heading as the body (no template scaffolding is implemented), validates `related` ids, runs **dedup** (§5.2), updates folder + root `INDEX.md` (≤50/≤20 caps), and rebuilds the manifest. Prints the path.

### 9.4 `verify` — freshness workflow
`verify [--stale] [--id <id>]`. `--stale` lists entries past their volatility window (`last_verified = max(verifications[].date)` vs. `taxonomy.yaml` windows). For a chosen entry: walk the method/result decision tree, append a `verifications[]` line, then **either** bump `updated:` **or** supersede (new id, mark old, backlink) per the mutate-vs-supersede invariant — and recognize the **version-succession** branch (§4.3) as a third outcome distinct from supersession. Enforces offline rules and the self-confirmation rule.

### 9.5 `search` / `related` — §5.3.

### 9.6 Control model — detective floor + preventive layers

Fields fall into 🟢 *preventive* (deterministic code can set them), 🟡 *detective* (judged value, but `lint` can validate it), and 🔴 *judgment-only* (no code can produce or validate the value). A preventive control only fires on writes that pass through the tooling; because the vault is hand-editable on the no-Node tier, **correctness must not depend on prevention.** Three layers, in strict priority:

#### 9.6.1 Detective floor (mandatory, universal) — the actual guarantee
`lint` / `lint --check` is the only mechanism that works on every OS, every agent, and hand-edits included. It runs in CI and as a pre-commit step (when the vault is a git repo), and is the authoritative correctness check. **No other control is relied upon for correctness.** Everything below is convenience.

#### 9.6.2 Self-healing commands (preventive, portable) — free prevention via the tool path
Every mutating command (`capture`, `verify`, `manifest`, and `lint --fix`) ends by internally running the safe-normalization + rebuild pass: bump `updated` on body change, recompute `content_hash` on refetch, recompute derived fields, rebuild `.vault-manifest.json` and affected `INDEX.md`. Consequence: whenever the tool path is used (on *any* platform with Node), the 🟢 preventive updates happen for free — without an unenforceable "you must use the tool" mandate, and without forbidding hand edits.

#### 9.6.3 Optional Claude Code hook (preventive, single-platform) — explicitly non-load-bearing
A `PostToolUse` hook (matching `Edit`/`Write` on vault paths) runs idempotent `lint --fix` after agent-mediated edits in Claude Code. It is:
- **Opt-in** — declared in the manifest but documented as optional; the plugin is fully functional without it.
- **Single-platform** — Claude Code only; does not port to other agents and does not fire on human IDE edits. Never relied on for correctness.
- **Loop-guarded** — the fix pass is idempotent and the hook no-ops when `lint --fix` produces no change, preventing write→hook→write cycles. A re-entrancy guard (skip if the triggering write originated from the tool) is required.

> Design rule: a preventive control you *depend on* is a liability — the first bypassing writer (non-Claude agent, human IDE edit, hook misfire) silently rots invariants. Correctness lives in §9.6.1; §9.6.2–9.6.3 are UX only.

---

## 10. Testing & CI

### 10.1 Tests (`node:test`, no framework dependency)
- `frontmatter` round-trip stable; rejects out-of-subset YAML.
- `resolve` matrix: flag > env > config > per-OS default, with `process.platform`/env mocked for linux/darwin/win32.
- `lint` fixtures: a `test/fixtures/` vault with known-bad entries (stored `id`, stage/folder mismatch, dangling ref, BOM, bad enum, malformed `subject`) each caught; a clean vault passes.
- `init` idempotence + `--force`.
- `capture` + dedup (composite key: same URL different version → distinct entry).
- `verify`: mutate-vs-supersede-vs-succession branch selection; self-confirmation refusal; offline method restriction.
- `manifest`: backlink computation; `series` grouping.
- AGENTS.md generation == checked-in `vault-template/AGENTS.md` (anti-drift gate).
- **Self-healing**: `capture`/`verify` leave the vault `lint`-clean (run lint after; assert zero violations).
- **Hook**: `lint --fix` is idempotent (second run is a no-op); the hook no-ops on no-change and does not re-enter on its own writes (loop guard).

### 10.2 CI (GitHub Actions)
- **Matrix: `{ubuntu, macos, windows} × {Node 18, 20, 22}`** — backs the cross-platform promise.
- Steps: `node --test`; `research-vault lint --check` on the template vault; AGENTS.md regenerate-and-diff; **encoding gate** (no BOM, no CRLF in `.md`, no mojibake).

### 10.3 Portability guardrails
- All paths via `path.join`/`os.homedir()`/`process.env`; never concatenated separators.
- Files written UTF-8, no BOM, LF endings; `.gitattributes` enforces `*.md text eol=lf`.
- No shell-out from Node; pure `node:fs`.

---

## 11. Acceptance criteria
1. Repo layout from §1.1 exists; installs as a Claude Code plugin (manifest valid) and runs standalone via `node bin/research-vault.mjs`.
2. No personal path or content anywhere in the plugin repo.
3. `init` scaffolds a spec-conformant vault on all three OSes; discovery resolves per §2.
4. `lint`, `capture`, `verify`, `search`, `related`, `manifest` work per §9/§5; `lint` catches every fixture violation in §10.1.
5. `AGENTS.md` is generated from `schema/` and the CI diff gate passes; encoding gate passes.
6. Versioned-resource support (§4) works end to end: distinct entries per `subject.version`, shared `series`, succession ≠ supersession.
7. OS×Node CI matrix green.
8. Control model (§9.6): `lint --check` is the CI/pre-commit floor; `capture`/`verify` leave the vault lint-clean; the optional Claude Code hook is idempotent and loop-guarded, and the plugin is fully functional with it disabled.

---

## 12. Deferred / future (out of scope for v1)
- `sqlite-vec` semantic-search MCP (§5.4).
- Opt-in `capture` body-template scaffold seeding entries from `meta/prompt-templates/*` (§9.3).
- Automatic web re-fetch / refresh-queue automation.
- `npm` publish of the standalone CLI.
- Additional hook events beyond the optional `PostToolUse` lint-fix hook shipped in v1 (§9.6.3).

---

## 13. Open questions
- Exact normalization rules for `source_url` dedup (which query params to strip) — decide during implementation with a small allow/deny list.
- Whether `subject` should allow multiple products per entry (v1: single product; revisit if a real multi-product source appears).
