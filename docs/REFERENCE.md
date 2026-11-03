# Reference

The README explains what research-vault is and how to start. This page is for looking things up. It is a command overview with the flags you'll actually reach for. Running `research-vault` with no arguments prints the command list.

## Scope

research-vault is for *external* facts: documentation, API behaviour, tool-version claims and the decisions you made because of them. It is not a code indexer beyond the comments that cite the vault, and does not replace the agent's view of your repo. Without Node, an agent can still read a vault by globbing and grepping the folders; the CLI is the faster, checked path.

## Where the vault lives

Tooling and vault data are separate by default. The vault is discovered in order:

1. `--vault <path>` flag
2. a repo's `.research-vault.json` (project binding, below)
3. `$RESEARCH_VAULT_PATH`
4. the config pointer `init` writes when it sets the default vault (first `init`, or `--set-default`)
5. the OS default: `$XDG_DATA_HOME/research-vault` (else `~/.local/share/research-vault`) on Linux, `~/Library/Application Support/research-vault` on macOS, `%LOCALAPPDATA%\research-vault` on Windows

## Skills and slash commands (Claude Code)

Skills load when a request matches their job; none of them fires for every technical question.

| Skill | Job |
|---|---|
| `research-vault-usage` | Searching, citing with a freshness check, planning the entries a synthesis needs |
| `research-capture` | Writing a new entry by hand, with the dedup and conflict-review steps |
| `research-verify` | Walking through re-checking a stale entry |
| `research-librarian` | Read-only curation guidance |
| `research-orchestrate` (`/research`) | A fresh research task end to end: vault first, then the web, every finding filed as entries |
| `research-authoring` | Fires when a citation is about to land in prose you're writing in a vault-bound repo |
| `research-review` | Auditing an existing document or corpus against the vault |
| `research-teach` | Teaching a topic over sessions: resources and facts in the vault, evidence probed or read from stored sources, lessons in one of four shapes (`concept`, `tool`, `diagnose`, `project`), plus review lessons, checked by `teach lint`, read by a fresh `lesson-reader` agent, then gated by a fresh `claims-reviewer` agent, quiz attempts recorded by a local quiz server (`teach serve`) |
| `research-claims-gate` | Gating a draft that cites the vault: derives the evidence list, dispatches one fresh `research-vault:claims-reviewer`, records the verdict in the claims ledger |

Slash commands, all under `/research-vault:`: `research-init`, `research-search`, `research-related`, `research-lint`, `research-compile`, `research-obsidian`, `research`. Every skill is also `/research-vault:<name>` (for example `/research-vault:research-capture`).

## Binding a repo to a vault

Run `init --project` at the root of a repo to write `.research-vault.json` there, and commit it. From then on:

- **Discovery.** A CLI command run from inside the repo resolves to that vault with no flag or env var (the binding is found by walking up from the working directory). For discovery the binding selects the vault; what an agent does with it comes from the vault's `AGENTS.md`.
- **`research-authoring`.** When a citation is about to land in prose you're writing in the repo, the skill consults the vault, captures what's missing and checks freshness first.
- **`check`.** Audits the repo's docs against the vault; each citation is `ok`, `stale` or `uncovered`. `check --check` exits non-zero so CI can fail on stale or uncovered citations.
- **Gate.** Lessons and reference docs in every teach workspace (a directory holding `MISSION.md`) found under the repo are gated, plus any file matching the optional `gates.globs` array in `.research-vault.json`, for example `"gates": { "globs": ["docs/**/*.md"] }`. The `research-claims-gate` skill records each `PASS` or `MERIT` verdict with `gate record` in `.research-vault-ledger.jsonl` at the repo root, keyed to the file's content hash and to a hash per unit, so an edit that changes a unit needs a new verdict for that unit, while an edit that leaves every unit's hash unchanged keeps the earlier verdict (`(by unit)`). The row also carries `reviewer`, the sha256 of the plugin's `agents/claims-reviewer.md`, and counts only while that hash is absent (a row written before the field existed) or equal to the installed reviewer's; after a change to the agent file, `gate status` prints `none (reviewer changed)` for a file whose passing rows all came from the earlier one. A lesson's units are its `data-block` elements (the fact block per paragraph, the quiz per item); a Markdown file's are its ATX (`#`) heading sections (`sec:<slug>`, `sec:preamble` before the first heading) and each table row of one (`sec:<slug>/<first-cell slug>`, so a one-row edit reopens only that row), and `gate evidence --changed` prints `unit sec:<slug> <file>:<start>-<end> prose` for each changed one so the reviewer reads only those; a file with neither is one unit, `all`. The Stop hook blocks a turn that leaves a changed gated file without a `PASS` or `MERIT` verdict for its current content (a row for those exact bytes, or every unit covered by some row). After an edit to a gated file or one matching `references.globs`, a hook reports its uncovered or stale citations without blocking; an edit inside the vault runs `lint --fix` instead, so this applies to files outside the vault. `gate status <file> --check` exits 1 when the current content has no passing verdict; `gate staged --check` does the same over every gated file staged in git, one line per file, for a pre-commit hook (the plugin repo ships one in `.githooks/`). A vault entry outside any bound repo can be gated too; its ledger lives in the vault.
- **Embedding endpoint.** `"embedding": { "url", "model"?, "chunk"?, "overlap"? }` (defaults 800 and 100) turns on `embed`, which writes the disposable index `_index/embeddings.jsonl` from every non-superseded entry's windows, and `search --semantic`; both need `RESEARCH_VAULT_ALLOW_NETWORK=1` and `--ack-data-egress`, since the text goes to that URL. Without the block, both refuse (`no embedding endpoint in .research-vault.json`) and no index is written.
- **Usage log.** `_index/usage.jsonl` in the vault, one JSON object per line: a `queried` event from the pre-web hook (the tool, the outcome `url-hit`, `hits` or `no-match`, the ids surfaced) and from `search` (the `--type` and `--topic` facets, the outcome, the ids returned), and a `cited` event per id a watched file newly cites, from the post-edit hook (the file's repo-relative path and the id; the log itself is the record of what was already logged). Ids, facets and the outcome are always written; free text (the pre-web terms, the `--text` value) only when the binding sets `"usage": { "text": true }`. The template's `.gitignore` already ignores `_index/`; if a vault's `.gitignore` lacks the line, add it. `advise` reads the log for its usage section and skips a line that is not JSON.

### Code links

A vault id on a comment line of its own, above a column-0 declaration, cites that entry for the symbol below it. The id may carry a pin, `<id>@<key>=<version>`, naming a key of `code.versions` and the version the code was checked against:

```lua
-- Sleep-mode call order per 2026-03-03-sleep-mode-api@sdk=0.20
function ns.Sleep(frame)
```

Blank and comment lines may sit between the comment and the declaration; several ids on one line, or several comment lines above one declaration, are several links to the same symbol. A link whose next non-blank, non-comment line is not a column-0 declaration is `unattached`: reported, never dropped.

**Opt-in.** `init --project --vault <relative dir> --code-links '<glob>[,<glob>]'` writes the standard binding plus a `code` block, and a `code` block written by hand into an existing binding is the same opt-in. The block is accepted only on a relative `vault` inside the repo: an absolute, empty, `..` or absent vault is rejected with `code links need a project-specific vault inside the repo (a relative vault path); this binding points at <vault>` (`(none)` when the vault is empty or absent). Without the block, `check`, the gate and the hooks take today's code path and the comments are ordinary comments.

```json
"code": {
  "globs": ["src/**/*.lua"],
  "languages": {},
  "versions": {
    "sdk": { "file": "package-lock.json", "pattern": "\"node_modules/sdk\": \\{\\s*\"version\": \"([^\"]+)\"" }
  }
}
```

- **`versions`.** Each key names a `{ file, pattern }`. The pattern is a JavaScript regex applied with the `m` flag to the whole file; the first capture group of the first match is the declared version. A file that is missing or that the pattern does not match is a configuration error (`check` exits 2 with `versions.<key>: cannot read <file>` or `versions.<key>: pattern matched nothing in <file>`), not a row per link. `package-lock.json` nests the installed version under `packages[<path>].version`. One-line forms: the `## Interface:` line of an addon `.toc`; a `go.mod` `require` line, which declares a minimum version while the selected version may be higher; a `.minimum_zig_version` line in `build.zig.zon`. `check` prints the values it read as a footer, `versions: sdk=0.20`.
- **`languages`.** A language is `{ comment, decl }`, two regex sources: `comment` matches one whole comment line and captures its text in group 1; `decl` matches one column-0 declaration line and captures the symbol name in its first non-empty group. Each must compile and hold a capture group, else the error names the field (`code.languages[".py"].decl: pattern has no capture group`). The plugin ships rows for `.lua`, the JavaScript and TypeScript family (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`), `.py`, `.go`, `.rs`, `.zig`, `.rb`, `.sh`/`.bash` and C/C++ (`.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`); each sees only column-0 declarations, so a method inside a class body, or a decorator or attribute line between the comment and its declaration, is not seen. The Lua row:

  ```js
  comment: /^\s*--(?!\[=*\[)(.*)$/,
  decl: /^(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(|^(?:local\s+)?([A-Za-z_][\w.]*)\s*=(?!=)/,
  ```

  A project adds any other language as a row keyed by extension in `code.languages`, and may override a shipped row; a `code.globs` file whose extension has a row from neither is a configuration error, `no language for .kt in code.globs; add code.languages[".kt"] = { comment, decl }`. `comment` is matched line by line, so a block-only comment syntax needs a line prefix inside the block.
- **Statuses.** A code row is `ok`, `uncovered` (no entry for the id), `unattached`, or `stale` with its reason: `(time)` for an unpinned link whose entry is past its volatility window, or a pinned link to a `volatile` entry; `(superseded by <id>)` for an entry with `status: superseded`; `(<key> <pinned> -> <declared>)` for a pin that differs from the declared version; `(no key <key> in code.versions)`. A pin selects the version rule over the time rule; an unpinned link follows the entry's window as prose does. `check --check` exits 1 on any `stale`, `uncovered` or `unattached` row.
- **Gate.** Each linked declaration is a unit, `sym:<name>`, hashed from its leading comment block to the line before the next column-0 declaration's comment block, with pin values stripped, so moving the block, editing a neighbour or moving a pin reopens nothing and editing the body does. Code files with an attached link are gated like `gates.globs` files; `gate evidence <file> --changed` adds one line per changed unit, `unit sym:<name> <file>:<start>-<end> <status>`, which the `claims-reviewer` reads as its line range. The post-edit hook reports a code file's non-`ok` rows and, after an edit to a `versions` file, every link whose pin differs from the version now declared. The Stop hook also blocks a turn in which a `versions` file changed and a link is still pinned to another value, naming the link and the two versions.

## Extending the controlled vocabulary

The schema enums are small on purpose. A vault that needs its own terms (a lab recording `lab-run` as a verification method, a team with an extra `domain`) adds them in `.research-vault.json`:

```json
{
  "vault": "research",
  "taxonomy_extensions": {
    "verification_method": ["experiment", "lab-run"],
    "verification_result": ["partial"],
    "topic_aliases": { "k8s": "kubernetes" }
  }
}
```

- **Additive only.** You can add values, never remove or redefine a built-in, so entries stay portable between vaults.
- **Extensible fields:** `domain`, `confidence`, `outcome`, `question_state`, `verification_method`, `verification_result`. `volatility` and `stage_by_folder` are not extensible, and `topics:` already accepts any tag.
- **`topic_aliases`** is a map of vault pairs, alias to canonical topic, merged after the built-in pairs; a pair whose key is a built-in alias is refused. `capture`, `lint`, `advise`, `search` and `teach path candidates` all read the merged map, and `lint --fix --topics` rewrites existing entries.
- **Keyed on the vault**, not your shell's working directory, so the vocabulary is the same wherever a command runs.

To change the built-in vocabulary itself, edit `schema/taxonomy.json`. The linter, `capture`, the generated `AGENTS.md` and each vault's copied `taxonomy.json` all derive from it.

## Freshness

Each entry has a `volatility` tier with a review interval. An entry is stale when its last confirming verification is older than the interval.

| tier | covers | interval |
|---|---|---|
| `stable` | fundamentals, algorithms, classics | 3 years |
| `slow` | established practices, mature frameworks | 1 year |
| `fast` | specific tool APIs, framework versions, LLM capabilities | 90 days |
| `volatile` | pricing, rate limits, current best model, availability | always re-check |

A note or synthesis is only as fresh as its evidence; `advise` reports conclusions whose source chain reaches a stale or replaced entry.

## Versions and replacements

These are different things:

- **A new version of a tool is new knowledge, not a correction.** `vcluster 0.19` and `0.20` are two active entries sharing a `series`. Record this with `verify --succession` on the older entry, then capture the newer version as its own source with `--subject-name`, `--subject-version` and `--series`.
- **A replacement is for an entry that is wrong or obsolete.** Capture the corrected entry first, then `verify --id OLD --method <method> --result outdated --superseded-by NEW`. The old entry stays on disk with `status: superseded`; `search` hides it unless `--include-superseded`, and `related` still shows it so the evidence trail stays visible.

## Entry types and the graph

| Folder | Holds | Create one when |
|---|---|---|
| `sources/` | Raw captures of external material, as-is | you clip something worth keeping |
| `notes/` | Your distilled take on one or more sources: the load-bearing claims and how you'd use them | you read a source and want a durable, skimmable version |
| `synthesis/` | Conclusions drawn across several entries | you see a pattern worth stating once |
| `snippets/` | Reusable code or prompt fragments | you have a fragment you'll reuse |
| `experiments/` | Logged trial runs with task, parameters and outcome | you run a trial worth recording |
| `questions/` | Open questions (`open → investigating → answered`) | you hit something to track and answer over time |

Distillation (source → note → synthesis) is a deliberate step; nothing auto-promotes. A synthesis usually cites notes, and may also cite sources, experiments, questions and snippets directly; a factual rollup (a release-note matrix, a version diff) may skip notes if it declares `synthesis_basis: primary-rollup`.

Stored references point from the declaring entry to what it references:

```mermaid
flowchart LR
  note -->|"sources"| source
  synthesis -->|"contributing_ids"| note
  snippet -->|"source_id"| source
  experiment -->|"prompt_id"| snippet
  question -->|"contributing"| any
  any -->|"related"| any
  any -->|"superseded_by"| any
```

`.vault-manifest.json` lists every reference as a typed edge and inverts the backlink-forming ones. Each vault's generated `AGENTS.md` §5 documents the fields and §5.2 maps graph questions to commands.

### Reading the graph from outside

A project that keeps its own graph (a code dependency map, a Neo4j load, a Graphviz script) does not need the plugin's view of it. Two outputs carry everything, both plain JSON, neither stored in git, so run the command first:

- **The vault graph**: `lint` writes `<vault>/.vault-manifest.json` with `generated`, `entries`, `edges` and `backlinks`. An entry row has `id`, `type`, `title`, `summary`, `domain`, `topics`, `source_url`, `content_hash`, `volatility`, `last_verified`, `status`, `subject`, `series`, `stage`, `state`, `confidence`, `outcome`, `authority_tier`, `authority_basis`, `superseded_by`, `related`, `contributing_ids` and `sources`; an absent field is `null` or `[]`, never missing. An edge is `{ from, rel, to }` with `rel` one of the reference fields above, sorted by `from`, `rel`, `to`. `backlinks` maps an id to the sorted ids that reference it. Bodies are not included: the id is the filename under the type's folder.
- **The code edges**: `check --json` from the repo root prints `generated`, `summary`, `rows`, `skipped` and, with a `code` block, `versions`. A code row has `file`, `type`, `value`, `symbol`, `line`, `key`, `version`, `status` and, when covered, `id` and `volatility`, plus `reason` when stale; a prose row has `file`, `type`, `value`, `status` and, when covered, `id` and `volatility`. Join a row's `id` to an entry's `id` and the code side of the graph is complete.

These keys are the integration contract: `test/contract.test.mjs` pins them, and a change is a breaking one in the CHANGELOG. `examples/graph-dot.mjs` is the join written out as Graphviz DOT, and `examples/blast-radius.mjs` is the other direction: given the manifest, one entry id and one or more `check --json` outputs, it walks the `sources` and `contributing_ids` edges inward and prints the entries that rest on the id and every row that cites one of them, which is what to re-check when the entry is superseded; [ADOPTING.md](ADOPTING.md) is the ordered walkthrough for a new project.

Two facet tiers keep retrieval clean as a vault grows: **`domain`** is a small controlled set of broad areas (`software-engineering`, `systems-infrastructure`, `data-ml`, `security`, `learning`, `llm-assisted-dev`, `meta`); **`topics`** is freeform and is where specific tech lives.

## Commands

Run as `node bin/research-vault.mjs <command>` from a clone, or `research-vault <command>` if you've put it on your PATH. Every command takes `--vault <path>`. For example:

```text
research-vault capture --type source --title "vcluster sleep mode" \
  --url https://docs.vcluster.com/sleep-mode --domain systems-infrastructure \
  --topics kubernetes,vcluster --subject-name vcluster --subject-version 0.20
research-vault search --topic vcluster
research-vault verify --id <id> --method refetched-source --result confirmed
```

Ids are `<date>-<slug>`; use the one `capture` or `search` prints rather than guessing it.

| Command | Does |
|---|---|
| `init` | Scaffold a vault and generate its `AGENTS.md`. `--project` binds the current repo; with `--code-links '<glob>[,<glob>]'` it also writes the `code` block, which needs a relative `--vault` inside the repo. `--refresh-docs` regenerates `AGENTS.md` and `taxonomy.json` in an existing vault and touches nothing else (entries and `meta/` are preserved). |
| `capture` | Add an entry. Required: `--type`, `--title`; sources also `--url`. Common: `--domain`, `--topics a,b`, `--subject-name`/`--subject-version`/`--series`, `--summary`, `--sources` (notes), `--contributing-ids` (syntheses), `--confidence`. Dedupes by URL and version. `--scaffold` writes a per-type body skeleton; `--body-file` supplies prose for non-source types; `--content-file` and `--captured-via` record local provenance; `--store-body` keeps the text you pass with `--content` or `--content-file` in a source entry and needs `--ack-data-egress`; a single capture never fetches the URL itself. `--batch <path>` takes a JSON plan (an array of specs), a URL list (one per line, `#` comments; needs `RESEARCH_VAULT_ALLOW_NETWORK=1` and fetches each through the `refresh` fetcher) or a directory of Markdown files (`source_url` or `url`, `title` and `author` from frontmatter, else the first link and the first heading); it validates every entry before writing any, reports duplicates as skipped and failures with a reason per item, writes nothing on a validation failure unless `--continue`, which writes the rest (a filesystem failure can leave partial output either way), and `--store-body --ack-data-egress` keeps the fetched or read text. A source whose URL matches `meta/source-blocklist.json` in the vault (rows `{ pattern, scope: url | domain, reason, added }`; a `domain` row covers its subdomains, a `url` row is a prefix after normalisation) is refused with the reason; `--force` captures it and records the override in the `captured` verification's notes; in `--batch` a match is the item's error. |
| `lint` | Validate the vault and rebuild the manifest. `--check` for CI (exits non-zero on violations or a stale manifest); `--fix` applies safe normalizations; `--fix --topics` also rewrites each aliased topic to its canonical value (built-in and vault pairs) and deduplicates the list. A source matching `meta/source-blocklist.json` warns `WARN_SOURCE_BLOCKED`; a list that does not parse is the violation `BLOCKLIST_INVALID`. |
| `verify` | `--stale` lists entries past their interval. `--id <id> --method <m> --result <r> [--notes]` records a check. `--result outdated --superseded-by <id>` replaces; `--succession` records the check and keeps the entry active for its version, printing the `capture` line for the newer version's sibling entry. `--id <question> --answered-by <id> [--answer-summary <text>]` closes a question: `state: answered`, the summary (the answering entry's `summary` when the flag is omitted) and the id appended to `contributing`, with no verification row. |
| `search` | `--type`, `--domain`, `--topic`, `--series`, `--text` (title, topics, summary), `--body`, `--json`. Superseded entries are hidden unless `--include-superseded`. `--sort authority` orders by the taxonomy's tier array with untiered rows last; `--sort fresh` orders fresh, then stale, then not assessable; ties keep manifest order, the default. Each text line ends with `(<tier or no tier>, fresh|stale)`, followed by `(superseded by <id>)` on a superseded row shown with `--include-superseded`; the freshness part is absent when freshness cannot be assessed (`staleness()` returns null). `--semantic <text>` ranks the facet-filtered, non-superseded rows by the best cosine between the query's embedding and their indexed windows, a stale row's score multiplied by 0.8, cut to `--limit` (default 10); each line ends with `score <n.nn> #<window>`, `--json` adds `score` and `chunk`; it refuses without the binding's `embedding` block, the network variable, `--ack-data-egress` or an index (`run embed first`), and cannot be combined with `--sort`, `--text` or `--body`. |
| `related` | Typed links for an entry. `--depth N`, `--direction` (`out`, `in` or `both`), `--rel a,b`, `--format mermaid`. |
| `advise` | Read-only report: stale entries, stale evidence chains, orphans, sources without notes, unverified sources, missing summaries, aliasable topics, stub bodies, quote residue, open questions past 60 days, supersede suspects (two live entries of one type at one subject version with one `source_url` or one subject name), near duplicates (two live sources at different normalised URLs, either on one host sharing more than half of the longer path's segments, or whose titles share at least two terms, more than half of the longer title's terms), usage (per entry the surfaced and cited counts, per queried topic the query and no-match counts, and the live sources never cited, split by whether one of their topics was queried; read from the usage log). `--json`. |
| `manifest` | Rebuild (`--rebuild`) or print the derived index. `--topics` (no value) lists the topic vocabulary in place of the JSON, one `<topic> <count>` line per topic on a non-superseded entry, sorted by topic; with `--rebuild` it follows the rebuild's count line. `--rebuild` reports each edge to a missing entry on stderr before writing, and refuses to write when an entry the current manifest lists would be dropped while its type folder is missing or its file is still there (`manifest not written: ...`; delete `.vault-manifest.json` to accept the shrink). |
| `compile` | Regenerate the human-readable `_index/` (git-ignored, derived). |
| `obsidian` | Regenerate `_obsidian/` (git-ignored, derived). Open that folder, not the vault root, as an Obsidian vault; stubs carry `type/`, `status/`, `domain/`, `volatility/`, `freshness/` and `topic/` tags, so a graph filter like `tag:#freshness/stale` colours what matters. In a repo bound with a `code` block, `_obsidian/code/` holds one note per linked code file (tag `type/code`) with a wikilink per code link, so the graph shows which code cites which entry. The first run seeds `_obsidian/.obsidian/graph.json` (MOC hidden, colours by type, stale red); edit it in Obsidian as you like, later runs keep it. |
| `check` | Audit a document or glob outside the vault. `--report` or `--json` emit a coverage matrix; `--check` exits non-zero on a stale or uncovered citation. URLs and ids inside code spans and fenced blocks are not citations; a value found only in code is reported as skipped. A fence left unclosed makes the rest of the file code, and `check` lists a URL found only there as skipped. With a `code` block in the binding, files matching `code.globs` are read for code links instead (one row per link, printed as `file:line symbol`), the summary gains the `unattached` and code-link counts, and a `versions:` footer lists the declared versions; with no positional glob, `references.globs` and `code.globs` are both checked. Read-only, no network. |
| `gate` | `gate evidence\|changed\|record\|status\|staged`: derive a draft's evidence list from the vault (`evidence <draft> [--extra <ids>] [--changed] [--json]`), list the units no `PASS` or `MERIT` row covers (`changed <draft>`, exit 1 when there are any), record a claims verdict keyed to the file's content hash (`record <file> <PASS\|FAIL-as-sent\|MERIT> [note]`), report the verdict for the current content (`status <file> [--check]`, exit 1 with `--check` when there is no `PASS` or `MERIT`), or report every gated file staged in git with its verdict (`staged [--check]`, exit 1 with `--check` while any has none; for a pre-commit hook). |
| `teach` | Teaching workspace verbs: `teach record add --title <t> --kind <k> [--lesson <id>] [--body-file <path>] [workspace]`, `teach record supersede <id> --by <id> [--reason <text>] [workspace]`, `teach attempt add --lesson <id> --answers <comma list> [workspace]`, `teach attempt add --lesson <id> --result pass|fail [workspace]` (a project run), `teach lint [--fix] [--prose] [workspace]` (prints `lint: clean` followed by any warnings, or the findings, exit 1 on any non-warning finding; `--prose` adds one line per prose block (`mission`, `model`, `fact`, `example`, a reference doc's `note`) of every page, `prose <file> <block>: <p> paragraphs, <s> sentences, avg <n> words, longest <m>`, a sentence ending at `.`, `!` or `?` before a space or the paragraph's end, a word a whitespace-separated token holding a letter or a digit, with no threshold; a lesson's required blocks come from its `data-shape`, with `LESSON_SHAPE_UNKNOWN`, `LESSON_SHAPE_BLOCK_MISSING`, `LESSON_SHAPE_MISMATCH`, `LESSON_COMPLETE_NOT_WORKED`, `LESSON_PREDICT_INVALID`, `LESSON_PLAN_NO_ELEMENTS` and `PATH_PROJECT_AFTER` among its codes), `teach next [workspace]`, `teach path candidates [--topic a,b] [workspace]` (pools the vault's non-superseded entries on the given topics, default the binding's `defaults.topics`, and on every mission or path term or tool whose slug, or its plural, is a vocabulary topic, and prints each pool entry no lesson or reference doc cites, plus each note or synthesis within two `related` hops of a cited entry, under the `PATH.md` line it would follow or under `no line`, with the `search` or `related` query behind it, then every New to me term no line covers and each Known term no line covers that has a pool entry; it writes nothing; exit 2 with no topic), `teach path edges [workspace]` (prints, under each `PATH.md` line, one `after:` proposal per term or tool the line's lesson uses in its prose or runs in its commands, or its title names when it is untaken, that an earlier line introduces or teaches and the line's `after:` does not reach, naming the lesson, the term and the introducing line; it skips `Project:` lines and writes nothing), `teach progress [workspace]` and `teach serve [workspace]`. The workspace is the positional path, which must hold `MISSION.md`, else the cwd when it holds `MISSION.md`; otherwise usage and exit 2. `serve` binds `127.0.0.1` only; its limits are in [SECURITY.md](../SECURITY.md). |
| `refresh` | Re-fetch sources to see whether they changed; reports `confirmed`, `changed` or `unreachable` per source and never edits entries. Run `verify` on anything `changed`. `--json` prints one object per result, `{ id, result, detail?, storedBody? }`; `storedBody`, on a `changed` result, says whether the entry's body holds a line other than blanks, a lone `-`, lines starting with `#` or a bare ``` line (stored prose is such a line) to diff against. Needs `RESEARCH_VAULT_ALLOW_NETWORK=1`. |
| `embed` | Build `_index/embeddings.jsonl` for `search --semantic`: every non-superseded entry's windows (the binding's `chunk` and `overlap`) embedded through the binding's `embedding.url` in batches of 64; needs `RESEARCH_VAULT_ALLOW_NETWORK=1` and `--ack-data-egress`; refuses without the block. |
| `export` | JSONL for fine-tuning or eval, to stdout or `--out <path>` (outside the vault). Default: answered-question pairs. `--scope <types>` chooses which types to export instead (include `question` to keep the pairs); other types emit title and summary, and bodies need `--include-bodies --ack-data-egress`. Every record's `meta` carries `id`, `type`, `last_verified`, `topics`, `authority_tier`, `volatility` and `source_url`. `--chunk <chars> [--overlap <chars>]` emits one record per window of the output, counted in UTF-16 code units (the JavaScript string length, so a window can split a surrogate pair), with `meta.chunk` `{ index, start, end, total }` (reassemble by appending each later window from offset `overlap`); `--fresh-only` drops superseded and stale entries; `--min-authority <tier>` drops sources below the tier and keeps untiered rows. See [FINETUNING.md](FINETUNING.md). |

Four operations require a command rather than prose, by design: `lint` (correctness is checked, not asserted), `init`, `refresh` (network opt-in) and `export` (leaves the vault).

## Safety: network and egress

These guarantees are about the CLI. The agent hosting it may search or fetch the web on its own; that is governed by the agent, not by this tool.

- Ordinary commands (`capture`, `verify`, `lint`, `init`, `compile`, `obsidian`) write to the vault. `search`, `related`, `advise`, `check` only read (`search` also appends a line to the usage log under `_index/`, and `search --semantic` sends the query to the binding's embedding endpoint), and `manifest` only writes with `--rebuild`.
- Five features send data or open a listener outside the vault (`embed` and `search --semantic` share the embedding endpoint; `init --project` and `gate record` write a binding and a ledger at the repo root, nothing more). **`embed`** and **`search --semantic`** send window texts and the query to the binding's embedding endpoint, which may be local, behind the network variable and `--ack-data-egress`. **`refresh`** and **`capture --batch`** over a URL list are the ones that fetch pages from outside the machine; both are off until you set `RESEARCH_VAULT_ALLOW_NETWORK=1` for that run, and only the ingest writes entries: `refresh` fetches a source URL, compares content hashes and never stores the page. **`export`** writes JSONL to stdout or to `--out`; titles and summaries export freely, full bodies need `--include-bodies --ack-data-egress`. Neither `refresh` nor `export` modifies entries. **`teach serve`** listens on `127.0.0.1` only and writes nothing but attempt files and `.teach-serve.json` in the teaching workspace it serves.

The full contract, including SSRF hardening, is in [SECURITY.md](../SECURITY.md).

## Team use

A vault is a folder of Markdown, so a shared team vault is one kept in a git repo. Commit the entries, `taxonomy.json` and the generated `AGENTS.md`. The derived caches (`.vault-manifest.json`, `_index/`, `_obsidian/`) are git-ignored by the bundled `.gitignore`; each person rebuilds them with `lint`, `compile` and `obsidian`. Run `lint --check` in CI or a pre-commit hook; that gate, not a server, keeps a multi-writer vault consistent.

## Design notes

- **Cache, not source of truth.** The design treats staleness as the main risk of agent research; the vault makes it visible and actionable.
- **Lint is the guarantee, not the hook.** Correctness lives in `lint`, which runs anywhere on any writer. The plugin's four Claude Code hooks (a post-edit lint-fix, a session-start summary, a pre-web-fetch vault lookup that hands matching entries to the model before it searches and names a blocklisted URL's reason before a fetch, and a Stop gate that blocks a turn leaving a changed gated draft without a verdict) are conveniences.
- **The vault's agent-facing files are generated.** `AGENTS.md` and each vault's `taxonomy.json` come from the schema at `init`; CI checks the generator against `schema/AGENTS.golden.md`.
- **Orchestration is a reference implementation with a contract.** `research-orchestrate` drives vault-first research with eager source capture and a batch for the distilled layers; other orchestrators compose the same way. See [ORCHESTRATOR-INTEGRATION.md](ORCHESTRATOR-INTEGRATION.md).
- **Migrating existing notes?** See [MIGRATION.md](MIGRATION.md).

## Development

```text
npm test     # node --test; no test-framework dependencies
```

CI runs the suite plus `init`, `lint --check`, the AGENTS.md drift check, an encoding check and `npm run lint:self` on Linux and macOS with Node 22 and 24.
