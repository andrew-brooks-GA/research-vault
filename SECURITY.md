# Security model

`research-vault` is a local Markdown toolkit. Three features reach outside the vault (`refresh`, `export` and `teach serve`), and this document is the exhaustive contract for all three. The README explains *when* to use them; this explains *what they guarantee*.

## Reporting a vulnerability

Email **andrew.brooks.aob@gmail.com** with details and a reproduction. Please don't open a public issue for a security report.

## Threat model in one line

Everything is local and read-only by default. The only network feature that fetches from outside the machine (`refresh`) and the only egress feature (`export`) are off or conservative until you opt in per run, and neither ever mutates your entries. The second network feature, `teach serve`, listens on `127.0.0.1` only and writes only inside the teaching workspace it serves.

## Local writers

One local process writes your entries without a per-run prompt: the advisory `PostToolUse` hook re-runs `lint --fix` and a manifest rebuild on the vault after a vault-file edit. It touches only local files inside the vault, never the network, and is convenience-only — the `lint` correctness gate does not depend on it.

A second local process, `teach serve`, writes learner data, not entries: one attempt file in the workspace's `attempts/` per accepted `POST /attempt`, and `.teach-serve.json`. Its limits are in the next section.

## Lesson server (`teach serve`)

`teach serve [workspace]` serves one teaching workspace to a browser so a lesson's quiz can record an attempt. It runs until it is stopped.

- **Loopback only.** It listens on `127.0.0.1` on a port the operating system assigns (`listen(0, '127.0.0.1')`) and prints `serving <workspace> at http://127.0.0.1:<port>/`. It never listens on another interface.
- **Exact `Host`, before any work.** Every request, of any method, must carry `Host: 127.0.0.1:<port>` with the server's own port. Anything else, a missing `Host` included, is 403 before the path is read. A DNS-rebound name arrives as a different `Host`, so this closes DNS rebinding for reads as well as writes.
- **Static reads from an allowlist.** `GET` and `HEAD` serve files only from `lessons/`, `reference/` and `assets/`, each path checked with `isInsideVault` against that directory, plus the exact file `GLOSSARY.md`. Everything else is 404, including `NOTES.md`, `MISSION.md`, learning records, attempts, `evidence/`, `.teach-serve.json`, a directory, a path with a NUL byte and any path segment that starts with `.` (so `..` escapes, encoded or not). A path that does not URL-decode is 400. A method other than `GET`, `HEAD` or `POST` is 405. Every response carries `X-Content-Type-Options: nosniff`.
- **One write, `POST /attempt`.** A `POST` to any other path is 404. Before the body is read, the request must carry `Origin` equal to the server's own `http://127.0.0.1:<port>`, `Content-Type: application/json` (optionally with `; charset=utf-8`), and, when `Content-Length` is present, a length of at most `ATTEMPT_BODY_MAX` (4096) bytes. Anything else is 403. A body sent without `Content-Length` is counted as it arrives and is refused with 403 once it passes 4096 bytes.
- **Validated body.** The body must be the JSON object `{ "lesson": "<lesson id>", "answers": [integers] }`. The lesson id must match `^\d{4}-[a-z][a-z0-9-]*$` and name an existing `lessons/<id>.html`, and `answers` must hold one integer per quiz item, each an index of that item's options. Anything else is 400 and no attempt file is written. A lesson whose quiz data does not parse, or a failed write, is 500.
- **The server grades.** The client sends answers, never a score. The server grades them against the lesson's own quiz data through `writeAttempt`, the same function `teach attempt add` calls, and replies `{ "id", "score", "total", "wrong" }`.
- **Its other write.** On start it writes `.teach-serve.json` (`{ port, pid }`) in the workspace and removes it on exit, including on `SIGINT` and `SIGTERM`. Besides that file and the attempt files, it writes nothing.

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