---
name: research-authoring
description: Use when authoring or editing a document that cites external facts in a repo bound to a research vault (a .research-vault.json is present) — adding a reference, pinning a tool/library/SDK version, or asserting an external API behavior in prose you are writing. For answering a research question from the vault instead, use research-vault-usage.
---
# Authoring against the research vault

The write-side counterpart to `research-vault-usage`. That skill owns answering questions *from* the vault; this one owns the moment an external citation is about to enter a document you are authoring in a bound repo. Topic-agnostic: broad area goes in `domain`, specific tech in `topics`. Applies when a `.research-vault.json` binds the repo (capture-enabled); its `defaults` supply `domain`/`topics` to `capture` when you omit those flags (an explicit flag always wins), and `references.globs` name the files `check` reads when it is given no file argument. No binding yet? Create one with `research-vault init --project` at the repo root.

A **citation** is any external URL or factual pin — a version number, an API default, a "canonical reference" — that you are adding to prose. The discipline below applies to each one *before it lands*, so research flows back into the vault instead of only into the document.

## 1. Consult before a citation lands
1. Search the vault first: `research-vault search --topic <tech> --domain <d>`. If an entry already covers the fact, cite it instead of re-researching.
2. If it exists, check freshness (its `volatility` window vs. `last_verified`, per the vault's `AGENTS.md`). Stale → verify before relying on it; offline → prefix `unverified-offline`.

## 2. Capture what the vault is missing
If nothing covers the fact, capture it before (or as) you write the sentence. Never let the document be the only record.
- **Versioned fact** (SDK / library / tool pin): `research-vault capture --type source --url <official> --subject-name <tool> --subject-version <ver> --volatility fast`. `subject-version` is load-bearing — it is the part that goes stale.
- **Stable reference** (a canonical doc, a classic paper): capture as a `source` with `volatility: stable` or `slow`.
- **Unresolved assumption** you are relying on but cannot confirm: capture a `question` (`state: open`), not a parenthetical hedge in the prose.

Capture fills `domain`/`topics` from the `.research-vault.json` `defaults` when you omit those flags; pass them explicitly to override. Pass `--subject-version`/`--series` for version-bearing sources so siblings stay distinct.

**Verify what you capture — do not assert from memory.** A version, date, or API claim must be confirmed by fetching the authoritative source (its docs/releases page), not recalled: training lags reality, so a remembered "latest version" is stale by construction. `capture` seeds only a `captured` provenance marker, which is *not* a verification — record a real `verify` (`refetched-source`) once you've fetched, or the entry trips `WARN_SOURCE_UNVERIFIED` and is not authoritative. If you cannot fetch, capture it as a `question`, not a `source` stated as fact.

## 3. Verify after authoring
Run `research-vault check "<file-or-reference-glob>"` to confirm the new citation reports `ok`, not `uncovered` or `stale`. `research-vault check --check` exits 1 when any row is `stale`, `uncovered` or `unattached`, so a consuming repo can gate CI on it.

If the document matches `gates.globs`, run the `research-claims-gate` skill before it is shown or sent.

## Code

This section applies only when the binding has a `code` block and the file you are editing matches its `code.globs`; outside `code.globs`, `check` reads a file as prose. Two triggers: a declaration being written or changed because of a vault entry (a call sequence from a snippet, a constant from a source, a formula from an experiment), and a version being changed in a file named under `code.versions`.

1. Search the vault first; the entry's id is what goes in the comment. If nothing covers the fact, capture it first (section 2).
2. Choose the key: the entry of `code.versions` whose file declares the dependency the symbol calls; none for a pure formula. Read the declared version from the `versions:` footer of `research-vault check`, and write the link as the last comment line above the declaration: a whole comment line in the file's language (`-- ` for the shipped Lua row), a few words of why, then `<id>@<key>=<version>`; or `<id>` alone when no key applies, in which case the link follows the entry's time rule like prose. One link per declaration the entry justifies: a sequence that spans two functions gets two comment lines, one above each.
3. Run `research-vault check <file>`; the new row must be `ok`, not `uncovered`, `stale` or `unattached` (a link whose next non-blank, non-comment line does not match the language's `decl` pattern, a column-0 declaration for the shipped Lua row).
4. On a versions-file change: for each link the hook or `check` reports as `stale (<key> <old> -> <new>)`, re-verify the entry against the new version (`research-vault verify --id <id> --method tool-probe --result confirmed`, or `--method refetched-source`). Confirmed: move the pin to the new version; the unit's hash does not change and no gate round follows. Changed: capture the new version as its own entry, supersede the old one (`verify --id <old> --method <m> --result outdated --superseded-by <new>`), and replace the id in the comment; the gate reopens the unit. Never move a pin without the verify step: the pin says "checked at this version".

## What this skill is not
Not a research-orchestration entry point, and not the question-answering path — that is `research-vault-usage`. It owns one thing: a citation entering a document you are writing.
