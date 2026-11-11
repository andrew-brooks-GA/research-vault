# Security model

`research-vault` is a local Markdown toolkit. Five features reach outside the vault (`refresh`, `capture --batch` over a URL list, the embedding endpoint behind `embed` and `search --semantic`, `export` and `teach serve`), and this document is the exhaustive contract for all five. The README explains *when* to use them; this explains *what they guarantee*.

## Reporting a vulnerability

Email **andrew.brooks.aob@gmail.com** with details and a reproduction. Please don't open a public issue for a security report.

## Threat model in one line

Everything is local. The features that reach outside the vault are off or conservative until you opt in per run. `refresh` and `export` never mutate entries. `teach serve` writes only in the teaching workspace it serves.

## Local writers

One local process writes your entries without a per-run prompt: the advisory `PostToolUse` hook re-runs `lint --fix` and a manifest rebuild on the vault after a vault-file edit. It touches only local files inside the vault, never the network, and is convenience-only — the `lint` correctness gate does not depend on it.

A second local process, `teach serve`, writes learner data, not entries: one attempt file in the workspace's `attempts/` per accepted `POST /attempt`, and `.teach-serve.json`. Its limits are in the next section.

A third local write is the usage log, `_index/usage.jsonl` in the vault, appended by the pre-web hook, the post-edit hook and `search`: ids, facets and an outcome per event, never the fetched page, and free query text only when the repo's binding sets `usage.text` to `true`. It stays under `_index/`, which the vault's `.gitignore` ignores, and nothing reads it but the vault's own reports.

## Lesson server (`teach serve`)

`teach serve [workspace]` serves one teaching workspace to a browser so a lesson's quiz can record an attempt. It runs until it is stopped.

- **Loopback only.** It listens on `127.0.0.1` on a port the operating system assigns (`listen(0, '127.0.0.1')`) and prints `serving <workspace> at http://127.0.0.1:<port>/`. It never listens on another interface.
- **Exact `Host`, before any work.** Every request, of any method, must carry `Host: 127.0.0.1:<port>` with the server's own port. Anything else, a missing `Host` included, is 403 before the path is read. A request whose `Host` is any other value is refused, for GET and POST alike.
- **Static reads from an allowlist.** `GET` and `HEAD` serve files only from `lessons/`, `reference/` and `assets/`, each path checked with `isInsideVault` against that directory, plus the exact file `GLOSSARY.md`. `GET /` answers with an HTML index of the lessons and reference docs, and `GET /lessons.json` with the same list as JSON (title, URL, and each lesson's `PATH.md` line number, shape and closing `Project:` line); `GET /lessons.json` reads only `lessons/`, `reference/` and `PATH.md`, and `GET /` reads those and the workspace's `README.md`, which it renders from Markdown above the index, with `&`, `<`, `>` and `"` of the source escaped, so raw HTML shows as text, and a link kept as a link only when its target is `http:`, `https:` or has no scheme. Everything else is 404, including `NOTES.md`, `MISSION.md`, learning records, attempts, `evidence/`, `.teach-serve.json`, a directory, a path with a NUL byte and any path segment that starts with `.` (so `..` escapes, encoded or not). A path that does not URL-decode is 400. A method other than `GET`, `HEAD` or `POST` is 405. Every response carries `X-Content-Type-Options: nosniff`.
- **One write, `POST /attempt`.** A `POST` to any other path is 404. Before the body is read, the request must carry `Origin` equal to the server's own `http://127.0.0.1:<port>`, `Content-Type: application/json` (optionally with `; charset=utf-8`), and, when `Content-Length` is present, a length of at most `ATTEMPT_BODY_MAX` (4096) bytes. Anything else is 403. A body sent without `Content-Length` is counted as it arrives and is refused with 403 once it passes 4096 bytes.
- **Validated body.** The body must be the JSON object `{ "lesson": "<lesson id>", "answers": [integers] }`. The lesson id must match `^\d{4}-[a-z][a-z0-9-]*$` and name an existing `lessons/<id>.html`, and `answers` must hold one integer per quiz item, each an index of that item's options. Anything else is 400 and no attempt file is written. A lesson whose quiz data does not parse, or a failed write, is 500.
- **The server grades.** The client sends answers, never a score. The server grades them against the lesson's own quiz data through `writeAttempt`, the same function `teach attempt add` calls, and replies `{ "id", "score", "total", "wrong" }`.
- **Its other write.** On start it writes `.teach-serve.json` (`{ port, pid }`) in the workspace and removes it on exit, including on `SIGINT` and `SIGTERM`. Besides that file and the attempt files, it writes nothing.

## Static export (`teach export`)

`teach export [workspace] --out <dir>` writes a copy of one teaching workspace for a learner who opens it from disk with no server.

- **What it copies.** The pages and files `teach serve` returns from `lessons/`, `reference/`, `assets/` and `GLOSSARY.md`, read through the same `serveFile` (which serves `GLOSSARY.md` only when it is not a symlink, so a symlinked one is neither served nor copied), plus the plugin's `quiz.js` and `reading.html` and, when the workspace has no `assets/lesson.css`, the plugin's. An `.html` or `.htm` file the claims gate does not cover is left out. `MISSION.md`, `NOTES.md`, `PATH.md`, `GATE-LOG.md`, learning records, attempts and `evidence/` are not copied, and neither is any vault entry's body.
- **What leaves with the copy from the vault.** `sources.html` carries the title, `source_url`, date and summary of every vault entry a copied page cites. The command prints one `source <id> <url>` line per entry, so the author sees them before sending the copy. A title or summary is HTML-escaped, and a URL is a link only when it is `http:` or `https:`.
- **Gated pages only.** It refuses (exit 1, nothing written) while a lesson, reference doc or the `README.md` has no `PASS` or `MERIT` for its current content, unless `--skip-ungated` leaves those pages out.
- **Where it writes.** Only under `--out`, which must be absent or an empty directory, not a symlink, and not inside the vault or the workspace's `lessons/`, `reference/` or `assets/` (exit 2). Every check runs before the first write, so a refusal leaves no directory behind. Each file is written with the `wx` flag, so none is overwritten, and a path that resolves outside `--out` stops the command. When a write fails part way, it removes what the run created (`--out` itself when it was absent) and exits 2. It writes nothing in the workspace outside `--out`, and nothing in the vault.
- **What an exported page runs.** The export adds one script, the plugin's `quiz.js`, loaded as a classic `defer` script, and removes none of a page's own. A lesson's navigation bar is written into the file, so it fetches nothing. A finished quiz is saved in the browser's `localStorage` under `research-vault-attempts:<key>`, and Export my results downloads the saved attempts as a file. In headless Chrome 157, a lesson of an exported copy opened from `file://`, answered and exported made three requests, all `file://`: the page, `lesson.css` and `quiz.js`. The results come back only when the learner sends the file and the author runs `teach attempt import` (below).

## Results import (`teach attempt import`)

`teach attempt import <file> [workspace]` records the attempts in a results file, the JSON that quiz.js's `resultsFile` builds when a quiz is taken with no server. The file comes from the learner, so the command treats it as untrusted input.

- **Read, not fetched.** It reads the one local path it is given, refuses a file over 1 MiB before reading it (exit 2), and opens no listener and no network connection.
- **Checked whole before any write.** The file must be JSON with exactly the keys `format`, `version`, `workspace` and `attempts`: `"format": "research-vault-attempts"`, `"version": 1`, `workspace` equal to the workspace directory's name passed through `slugify`, and a non-empty `attempts` array of objects with exactly the keys `lesson`, `answers`, `at`, `total` and `wrong`. Each lesson id must match `^\d{4}-[a-z][a-z0-9-]*$` and name an existing `lessons/<id>.html`, `answers` must be non-negative integers, and `at` must be in `toISOString` form and no later than this machine's clock. Any failure prints one line per problem, exits 1 and writes nothing.
- **Graded here.** Each attempt is regraded against the lesson's own quiz data. One whose lesson has no quiz that parses, whose answers no longer fit the lesson, or whose grade differs from the file's `total` and `wrong`, is reported as `changed` and not written. Every attempt is decided before the first is written. The rest are written through `writeAttempt`, the function `POST /attempt` and `teach attempt add` call, so the score comes from the lesson, not the file, and the attempt file's name comes from the lesson number and `at`; `writeAttempt` never overwrites an existing attempt file. An attempt whose id is already in `attempts/`, or is recorded earlier in the same file, is skipped.
- **Printed escaped.** Every value from the file that a problem line or a `changed` line prints goes through `JSON.stringify`, which escapes a quote, a backslash and U+0000 to U+001F; U+007F to U+009F, U+200E, U+200F, U+202A to U+202E, U+2028, U+2029 and U+2066 to U+2069 are then written as `\uXXXX`. An array or object value is printed as `an array` or `an object`, never walked, so a deeply nested value cannot exhaust the stack. A `changed` line names the lesson only after its id has passed the lesson id pattern.
- **What it cannot check.** It cannot tell answers a learner chose on the page from answers typed into the file, and an attempt's date and id come from the file's `at`, the learner's browser clock.
- **What it writes.** Only attempt files in the workspace's `attempts/`.

## Network refresh (`refresh`)

`refresh`, `capture --batch` over a URL list and the embedding endpoint (`embed`, `search --semantic`) are the only features that open an outbound network connection, and all are off by default.

- **Double-gated.** It refuses — non-zero exit, including under `--dry-run` — unless you both invoke the `refresh` subcommand *and* set `RESEARCH_VAULT_ALLOW_NETWORK=1`. Either alone does nothing.
- **Hash-only.** It fetches the source URL and buffers the response solely to hash it: it computes the SHA-256 of the raw bytes and compares that to the entry's stored `content_hash`. It never parses, stores, or writes back the fetched bytes, and does no HTML-to-text conversion.
- **Never mutates.** It reports `confirmed`, `changed`, or `unreachable` and defers every edit to `verify`. Entries and the manifest are left byte-identical.
- **SSRF-hardened:**
  - HTTPS only. Plaintext URLs and `https`-to-`http` redirect downgrades are refused.
  - Every resolved address must be public global-unicast. RFC 6890 private, loopback, link-local, CGNAT, ULA, documentation, multicast, and reserved ranges are rejected — including IPv4-mapped IPv6, alt-encoded numeric hosts, and the cloud metadata address `169.254.169.254`.
  - The socket is pinned to the pre-validated IP. No re-resolution, no connection pooling.
  - Redirects are re-validated per hop against every rule above.
  - A body-size cap and a timeout bound each request. No cookies or auth headers are ever sent.

## Network ingest (`capture --batch <url list>`)

`capture --batch` over a URL list (a file that is not `.json`, one URL per line, `#` comments) fetches each URL to create a source entry. It is the second outbound feature, and it is off by default.

- **Double-gated, like `refresh`.** It refuses unless you both pass a URL list to `capture --batch` *and* set `RESEARCH_VAULT_ALLOW_NETWORK=1`; a JSON plan and a Markdown directory never open a connection.
- **The same fetcher.** Every request goes through the `refresh` fetcher, so every rule in the previous section applies: HTTPS only, public addresses only, the socket pinned, redirects re-validated, a body-size cap and a timeout, no cookies or auth headers. One request per line, in order; there is no rate limit.
- **Writes entries.** Unlike `refresh`, it creates a source per URL with `content_hash` over the raw bytes, which is what `refresh` later compares against. The fetched text lands in the entry only under `--store-body --ack-data-egress`, the gate a single capture has, and it lands raw: no HTML-to-text conversion.

## Embedding endpoint (`embed`, `search --semantic`)

Optional, for a vault whose repo binding sets `"embedding": { "url": "...", "model": "...", "chunk": 800, "overlap": 100 }`. Without the block both commands refuse and nothing is written. With it:

- **Double-gated, plus the egress acknowledgement.** Each command refuses unless `RESEARCH_VAULT_ALLOW_NETWORK=1` is set *and* `--ack-data-egress` is given, before any request.
- **What leaves the machine.** `embed` sends the window texts of every non-superseded entry (bodies included) to the endpoint, in batches of 64, one `POST` per batch; `search --semantic` sends the query, one `POST`. The request is `{ input, model }` as JSON, with `Authorization: Bearer <RESEARCH_VAULT_EMBED_KEY>` only when that variable is set. Nothing else is sent.
- **Where.** To the binding's `url`, which the operator chose and which may be local, so the `refresh` fetcher's SSRF guard is not applied; the request goes through Node's global `fetch`.
- **One file written.** `_index/embeddings.jsonl` in the vault (a header line, then one line per window with its text and vector), ignored by the template's `.gitignore` and safe to delete; `search --semantic` also appends its usage-log line as `search` does. No entry is modified.

## Data export (`export`)

`export` is the only path that writes vault content to an external file, and it is conservative by default.

- **Metadata-first.** By default it emits only **answered questions** as `{input, output}` pairs, each with per-record metadata — no other entry types, never any entry body, never a `source` body. `--scope <types>` widens it to other types as `{input: title, output: summary}` records — the entry's `summary` field when present, empty otherwise; still no entry body.
- **Body egress is double-gated.** Including any entry body requires both `--include-bodies` *and* `--ack-data-egress`. `--include-bodies` without the ack refuses and writes nothing; `--ack-data-egress` alone is inert — the export proceeds but emits only the default metadata and `summary` records, no bodies. `--chunk` windows the same `output` the gate allows, so a body still needs both flags.
- **Deterministic and offline.** Output is stable, id-sorted JSONL for an external pipeline. Nothing is sent over the network and the vault is never modified.

See [`docs/FINETUNING.md`](docs/FINETUNING.md) for the export format and intended pipeline.