# Finetuning / evaluation data export

The `export` command turns the governed vault into JSONL for an **external** finetuning
or evaluation pipeline. It is a strictly read-only path: the vault is never modified, no
network is touched, and there is no trainer in this repo. Training runs OUTSIDE this
repository on the exported file.

## Privacy / copyright posture

By default the export emits **metadata and answered-question summaries only** — never
entry bodies and never any `source` body. Entry bodies frequently contain verbatim
third-party text (a data-egress and copyright surface), so emitting them is gated behind
two explicit flags that must BOTH be present:

```
research-vault export --include-bodies --ack-data-egress
```

Without `--ack-data-egress`, `--include-bodies` refuses (exit 1, nothing written).

## What gets exported

- **Default scope = `questions` only.** Only `question` entries with `state: answered`
  AND a non-empty `answer_summary` are exported, as
  `{ input: question, output: answer_summary }`. `answer_summary` is the only built-in
  summary field in the schema, which makes answered questions the one clean training
  target the vault produces today.
- `note` / `synthesis` (and other types) have **no summary field**, so they are NOT a
  clean training target. With a broader `--scope` they export **title/metadata-only**
  by default (empty `output`); their bodies appear only under
  `--include-bodies --ack-data-egress`.
- **No `source` body is ever emitted by default.**

## Format

Deterministic, id-sorted JSONL. One record per line:

```json
{"input": "...", "output": "...", "meta": {"id": "...", "type": "...", "last_verified": "2026-01-01"}}
```

`last_verified` is computed from the entry's verification history (not stored on disk).
The command reports total byte size and per-type counts. Output is byte-identical across
runs over an unchanged vault.

## Usage

```
research-vault export --format jsonl --vault ./vault                # answered questions only
research-vault export --scope question,note --out train.jsonl       # write to a file
research-vault export --include-bodies --ack-data-egress --out x.jsonl
```

`--format` accepts only `jsonl`. `--out` writes to the user-chosen path (outside the
vault); without it, JSONL goes to stdout and the report to stderr.
