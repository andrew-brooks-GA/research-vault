---
name: research-review
description: Use when retroactively reviewing or auditing an existing document or corpus (a set of briefs, ADRs, a book, a docs site) against a research vault — assessing whether its load-bearing claims and assumptions are vault-backed and still fresh, beyond just its citations. For a single citation entering a document you are writing, use research-authoring; for answering a question from the vault, use research-vault-usage.
---
# Auditing a corpus against the vault

A retroactive audit, not a write of new prose. It answers: *for this document, which of its load-bearing claims and assumptions are backed by a fresh vault entry, and which are floating?* A citation linter sees only what is written as a citation; this skill reaches the **uncited claim** and the **implicit assumption** a linter cannot. It is an orchestration skill — drive it document by document and obey the capture lifecycle in `docs/ORCHESTRATOR-INTEGRATION.md`.

## 0. Iron law — fetch before you assert

Every external-fact claim you classify or capture — a version, a release date, an API behavior, a "current best" — must be **verified by fetching the authoritative source** (web fetch / cross-reference), with the URL and date recorded as a `refetched-source` or `cross-referenced` verification. **Model recall is not verification**, and for version currency it is actively wrong: training lags reality, so a remembered "latest version" is stale by construction. A claim you cannot fetch is an open `question` or `unverified-offline` — **never** a reported defect and never a "backed" entry. An audit run without web access cannot assess currency at all; say so rather than guessing. Run the audit's subagents *with* web access. A `source` whose only provenance is `captured` is not authoritative and trips `WARN_SOURCE_UNVERIFIED` until a real verification is recorded.

## 1. Start mechanical
Run `research-vault check --report "<glob>"` first. That matrix already classifies every citation and version pin as `ok` / `stale` / `uncovered` for free. Do not redo by hand what the report gives you; the semantic pass below is only for what the report cannot see.

## 2. Sweep each document for claims and assumptions
Read the document and extract its **load-bearing** statements — the ones a recommendation, build step, or design choice depends on. Two kinds the report misses:
- **Uncited claims:** a factual assertion with no link or pin ("dynamic rendering is a required device feature", "this API defaults to X"). Real, checkable, invisible to `check`.
- **Assumptions:** something the document relies on without stating ("the reader already knows RAII", "OpenGL DSA is the right baseline", "this library is still maintained"). Often the riskiest content, because nothing marks it.

Ignore incidental colour (a decorative link, an aside). Audit what the document *leans on*.

## 3. Classify and capture the gaps
For each load-bearing statement, search the vault and decide:
- **backed-fresh** — a current entry covers it *and that entry has a real (non-`captured`) verification*. Cite the id. A `captured`-only entry is not "backed" — verify it first.
- **backed-stale** — an entry covers it but is past its window. Fetch the source and record a `verify`.
- **uncited claim** — no entry. Fetch the authoritative source, then capture a `source` (verified, not just `captured`) — and a `note` if it needs interpretation — to ground it.
- **unvalidated assumption** — no entry and not confirmable by fetch. Capture a `question` with `state: open`. An assumption is a `question` entry, never a parenthetical hedge — and never a guessed "fact."

The durable outputs are these entries. Walk the four-prompt capture plan (`AGENTS.md` §2.6) before writing any synthesis of the audit.

## 4. Output is a view, not the artifact
Produce a per-document audit summary — the coverage matrix plus the new `question`/`source` ids — as a **report you hand back**, not a file that becomes the only record. Reports are views; the vault entries are the system of record. A 2000-word audit document with no captured entries is the failure mode this skill exists to prevent.

## What this skill is not
Not the single-citation write path (`research-authoring`) and not question-answering (`research-vault-usage`). It owns the backward pass: an existing corpus measured against the vault, claims and assumptions included.
