# Security model

`research-vault` is a local Markdown toolkit. Two features reach outside the vault, and this document is the exhaustive contract for both. The README explains *when* to use them; this explains *what they guarantee*.

## Reporting a vulnerability

Email **andrew.brooks.aob@gmail.com** with details and a reproduction. Please don't open a public issue for a security report.

## Threat model in one line

Everything is local and read-only by default. The only network feature (`refresh`) and the only egress feature (`export`) are off or conservative until you opt in per run, and neither ever mutates your entries.

## Local writers

One local process writes your entries without a per-run prompt: the advisory `PostToolUse` hook re-runs `lint --fix` and a manifest rebuild on the vault after a vault-file edit. It touches only local files inside the vault, never the network, and is convenience-only — the `lint` correctness gate does not depend on it.

## Network refresh (`refresh`)

`refresh` is the only feature that opens a network connection, and it is off by default.

- **Double-gated.** It refuses — non-zero exit, including under `--dry-run` — unless you both invoke the `refresh` subcommand *and* set `RESEARCH_VAULT_ALLOW_NETWORK=1`. Either alone does nothing.
- **Hash-only.** It fetches the source URL and buffers the response solely to hash it: it computes the SHA-256 of the raw bytes and compares that to the entry's stored `content_hash`. It never parses, stores, or writes back the fetched bytes, and does no HTML-to-text conversion.
- **Never mutates.** It reports `confirmed`, `changed`, or `unreachable` and defers every edit to `verify`. Entries and the manifest are left byte-identical.
- **SSRF-hardened:**
  - HTTPS only. Plaintext URLs and `https`-to-`http` redirect downgrades are refused.
  - Every resolved address must be public global-unicast. RFC 6890 private, loopback, link-local, CGNAT, ULA, documentation, multicast, and reserved ranges are rejected — including IPv4-mapped IPv6, alt-encoded numeric hosts, and the cloud metadata address `169.254.169.254`.
  - The socket is pinned to the pre-validated IP. No re-resolution, no connection pooling.
  - Redirects are re-validated per hop against every rule above.
  - A body-size cap and a timeout bound each request. No cookies or auth headers are ever sent.

## Data export (`export`)

`export` is the only path that writes vault content to an external file, and it is conservative by default.

- **Metadata-first.** By default it emits only **answered questions** as `{input, output}` pairs, each with per-record metadata — no other entry types, never any entry body, never a `source` body. `--scope <types>` widens it to other types as `{input: title, output: summary}` records — the entry's `summary` field when present, empty otherwise; still no entry body.
- **Body egress is double-gated.** Including any entry body requires both `--include-bodies` *and* `--ack-data-egress`. `--include-bodies` without the ack refuses and writes nothing; `--ack-data-egress` alone is inert — the export proceeds but emits only the default metadata and `summary` records, no bodies.
- **Deterministic and offline.** Output is stable, id-sorted JSONL for an external pipeline. Nothing is sent over the network and the vault is never modified.

See [`docs/FINETUNING.md`](docs/FINETUNING.md) for the export format and intended pipeline.