# Spec 49: labs a lesson can run from `teach serve` (#63)

Round 3 (2026-11-11), at 123b26a with no code changed. This spec designs upstream issue 63 (2026-11-11-research-vault-issue-63-research-teach, "the issue"): a workspace lab manifest, `labs/labs.json`, that "declares each lab by id: `up`, `down` and optional `verify` commands (paths to committed scripts, each pinned by a content hash), a plain-language cost line ... and a list of prerequisite checks", and a lab section of a lesson that `teach serve` can run, stop, reset and verify. The code lines it rests on are quoted in 2026-11-12-third-lines-snippet-behind-spec-49 ("the snippet"); the runs are in 2026-11-12-third-round-spec-49-lab-runner ("the probes": round 1 parts 1 to 8, items a to k, A to N4; round 2 parts 9 to 17, items O to W3; round 3 parts 18 to 20, items X1 to X4 and Y). Everything under Decisions, Threat model, First slice, Tests and Order of commits is this spec's judgment unless it cites an entry. The issue asks no questions, so this spec has no answers section.

## What exists, in one paragraph

`teach serve` listens on `127.0.0.1` on an assigned port, writes `.teach-serve.json`, and on `SIGINT` or `SIGTERM` calls `process.exit(0)` (the snippet, commands/teach.mjs 194 to 205). `createServer` refuses any `Host` other than `127.0.0.1:<port>` with 403 before it reads the path, answers a `POST` to any path but `/attempt` with 404, and `postAttempt` refuses, before reading the body, an `Origin` other than the server's own, a `Content-Type` other than `application/json`, or a `Content-Length` over `ATTEMPT_BODY_MAX` (teach.mjs 786 to 842). `serveFile` serves only `GLOSSARY.md` and files under `STATIC_DIRS = ['lessons', 'reference', 'assets']` (teach.mjs 405 to 423, 454 to 477); `exportWorkspace` reads every exported lesson and reference page through `serveFile` and copies the non-HTML files it serves, other than `assets/quiz.js`, as they are (teach.mjs 714 to 744). The binding's `lab` block is `{ docs, uses, bypass }` (projectconfig.mjs 95 to 111); `teach lint` passes it to `lintWorkspace`, which hands it to `lintLab`, which scans `.sh` files under `evidence/` and `lessons/` (commands/teach.mjs 44 to 52; lesson.mjs 439 to 462, 866 to 872). README-FORMAT.md's `## Labs` table has one row per lab folder, `lessons/files/{folder}/`, and `teach readme` prints one row per directory under `lessons/files/` (README-FORMAT.md 24 to 27, 32 to 34; teach.mjs 505 to 518). A checked task is a `project` lesson with `evidence/NNNN/setup.sh`, `check.sh` and `solution.sh`; `check.sh` prints `PASS` and exits 0, else `FAIL` lines and exits 1 (SKILL.md 60; lesson.mjs 581 to 600). The gate hashes a block other than `fact` and `quiz` by its inner HTML (gate.mjs 97 to 125). The quiz widget, which every lesson loads (LESSON-FORMAT.md 13), posts only when `location.origin` matches `http://127.0.0.1:<port>` (quiz.js 154 to 168).

## Findings from research

**F1. What a real lab needs, counted by reading (no script was run).** The four workspaces' `evidence/` and `lessons/files/` hold 157 `.sh` files; the repo's lab library under `~/vcluster-support-lab/lab/` holds 174. All 331 start with `#!`. 70 and 94 of them use `$0` or `BASH_SOURCE`; 19 and 84 source a path with `../` or an absolute path. The library's 81 `run-lab.sh` entry points all call `lab_main`, whose dispatch has seven stage arms and takes its stage from the first argument (`local subcmd="${1:-}"`, then `case "$subcmd" in`; the snippet, dispatch.sh 19 to 22). 37 of the 49 `recipe.yaml` files declare a required environment variable, and the library reads 27 distinct upper-case names containing `TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `PASSWD`, `LICENSE`, `CRED` or `AUTH`. The `--timeout=` waits in its `_lib/common/` and `_lib/modules/` scripts run from 5 s to 600 s, and one recipe README contains `~15 min`. (The probes, part 1.)

**F2. Labs that exist today.** One workspace has eight directories named `lessons/files/*-lab/`, holding 17 `.sh` files, all with the owner's executable bit: 3 call `sudo`, 3 call a VM tool, and 9 use a positional parameter (`$1` to `$9`, `$@`, `$*` or `getopts`) (the probes, part 9). `sudo true` started detached, with stdin ignored, exited 1 with "a terminal is required to read the password" (item O).

**F3. What `teach serve` answers today.** On a scratch copy of `test/fixtures/teach`: `GET /` with `Host` `localhost:<port>` or `rebind.test:<port>` is 403; `POST /attempt` with another port's `Origin`, with no `Origin`, or with `Content-Type: text/plain` is 403; `POST /lab/run` with the server's own `Origin` is 404; `OPTIONS /attempt` is 405; `GET /labs/labs.json` and `GET /evidence/` are 404 (the probes, items a to k).

**F4. What headless Chrome 157.0.8103.51 sent to a loopback port from a page on another port.** With `Content-Type: application/json` only an `OPTIONS` reached the logger; with `text/plain`, and with `no-cors`, the `POST` arrived with the page's own `Origin` and a `text/plain` type; an `Origin` header set by the script arrived as the page's own. A page opened at a name mapped to `127.0.0.1` arrived with that name in `Host` (items L and M).

**F5. Process groups in node v22.23.4 on macOS 27.0.1.** A child spawned with `detached: true` led a process group of its own, and its background children were in it. `process.kill(-pid, 'SIGTERM')` ended the leader and a plain child; a child ignoring `SIGTERM` lasted until `process.kill(-pid, 'SIGKILL')`, after which `process.kill(-pid, 0)` threw `ESRCH`; a child that called `setsid()` survived both. `child.kill()` and spawn's `timeout` option each ended only the leader and left its children running (items A to D). After `SIGTERM`, a 1000 ms grace and `SIGKILL`, a group with a `SIGTERM`-ignoring child was gone 22 ms later (item Q). A foreground `up` led its own group (pgid equal to its pid) and a `verify`, spawned detached as in item A, was started beside it; `verify` exited 0 while `up`'s group stayed up, and a `SIGTERM` to `up`'s group then ended it (item R).

**F6. Exit and close, environment, start errors, hashing.** With a background child holding stdout, node's `exit` event came at 25 ms and `close` at 2033 ms (item E). A child saw exactly the `env` it was given, plus `PWD`, `SHLVL` and `_` from bash; with no `env` option it saw 73 names (item F). A file without the executable bit gave an `error` event with `EACCES`; an executable with no `#!` line made `spawn` throw `ENOEXEC` (item G). node's SHA-256 of a file equalled `shasum -a 256` (item H).

**F7. Streaming and redaction.** A `node:http` reply written per chunk, `transfer-encoding: chunked`, was read by node's `fetch`: each tick line, written 300 ms apart, reached the reader in its own chunk within 3 ms; lines written together arrived in one chunk (item I). A client that aborted made the reply emit `close` before it finished; a `SIGTERM` to the group then left `process.kill(-pgid, 0)` throwing `ESRCH` (item J). The prototype line redactor, with a streaming UTF-8 decoder: replaced a value written in two parts, a value on stderr, a value whose two-byte character was split across chunks, and a value on a final line with no `\n`; dropped a 70000-character line holding the value, and the rest of that line up to its `\n`, with one marker line; passed the value's base64 form, a value with an ANSI escape inside it, and a value printed across two lines. Decoding the split chunks one by one with `String()` lost the value (items I, W1 to W3, Y).

**F8. The lab's group when the server ends.** In round 1, a server whose only handler was `SIGTERM` calling `process.exit(0)` left the group alive after `SIGTERM`; adding an `exit` handler that sends `SIGKILL` to the group, or a `SIGTERM` handler that stops the group before exiting, left none; a server killed with `SIGKILL` left its group alive (item K). In round 2, a server handling `SIGINT` and `SIGTERM` with `process.exit(0)` and with that `exit` handler died with signal `SIGHUP` on `SIGHUP`, which it did not handle; its `exit` handler did not run and the group stayed alive. With `SIGHUP` handled the same way the group was gone, and an uncaught exception ran the `exit` handler and the group was gone (item P). Run under `script` on a pseudo-terminal, and `script` killed, the server died; without a `SIGHUP` handler its `exit` handler did not run and the group stayed alive, and with one the group was gone (item S).

**F9. Blocks, comments and paths.** The gate hashes a block other than `fact` and `quiz` by its inner HTML, taking the blocks from `pageBlocks`, which returns `parseBlocks`' result for a page whose path does not end in `.md` (gate.mjs 104, 136 to 137); with a `PASS` recorded, a changed attribute in a lab section's opening tag still gave `PASS (by unit)`, and a changed `<data>` value inside the section gave no verdict (gate.mjs 97 to 125, 217 to 234; items N1 to N4). `parseBlocks` keeps the first element of each block name (lesson.mjs 58 to 76), and it returned a lab section inside an HTML comment when that came first (item V). `isInsideVault(ws, ws/labs)` was false with `labs/` a symlink to a directory outside, while `isInsideVault(ws/labs, ws/labs/up.sh)` was true; a script that is a symlink to a file outside was outside its root and `lstat` reported it a symbolic link (item V).

**F10. A token and cookie, prototyped.** In round 2, on a scratch server, a 256-bit token from `randomBytes(32)` compared with `timingSafeEqual` after a length check: `GET /labs/open?t=<token>` answered 303 with `Set-Cookie: rv-labs-<port>=<token>; HttpOnly; SameSite=Strict; Path=/`; a wrong or short token was 403; a lab `POST` with the right `Origin` was 403 with no cookie or a wrong one and 200 with it. In headless Chrome 157, a page opened at the plain address got 403 on its own `POST`; after the token address, the same page got 200 and `document.cookie` was empty. While the cookie was set, the browser sent it to a server on another `127.0.0.1` port the page fetched or framed, and a page on that port that `POST`ed with credentials sent it too, with its own `Origin` (403). A new browser process on the same profile sent no cookie (items T to U3). In round 3, a single-use address on a scratch server: the first `GET /labs/open` with `t` answered 303 with a cookie holding a second 64-hex value, not `t`; `t` a second time, or a wrong `t`, was 403; a `POST` was 200 with that cookie and 403 with `t` as the cookie or with none. When someone else opened `t` first, they got the cookie and their `POST` 200, and the learner's open of `t` was 403 with no cookie (items X1 to X4).

## Decisions

### D1. The manifest (judgment)

```json
{
  "version": 1,
  "labs": {
    "<id>": {
      "cost": "About 4 minutes, 2 GB of disk, 1 GB of memory, downloads about 500 MB",
      "timeout": 900,
      "env": ["EXAMPLE_TOKEN"],
      "checks": [
        { "script": "labs/<id>/check-runtime.sh", "sha256": "<64 hex>", "message": "The container runtime is not running. Start it, then press Run again." }
      ],
      "up": { "script": "lessons/files/0042-lab/up.sh", "sha256": "<64 hex>" },
      "down": { "script": "lessons/files/0042-lab/down.sh", "sha256": "<64 hex>" },
      "verify": { "script": "evidence/0042/check.sh", "sha256": "<64 hex>" }
    }
  }
}
```

- The top level has exactly `version` (1) and `labs`; a missing file is a manifest with no labs. An id matches `LAB_ID_RE = /^[a-z][a-z0-9-]{0,39}$/`. An entry has exactly `cost` (1 to 200 characters), `timeout` (whole seconds, 1 to 7200), `up` and `down`, and may have `env` (distinct names matching `^[A-Z_][A-Z0-9_]*$`), `checks` (at most 10, each exactly `script`, `sha256` and a 1 to 200 character `message`) and `verify`. A command is exactly `{ "script", "sha256" }`.
- A script path matches `^[A-Za-z0-9._/-]+$`, has no empty segment and none starting with `.`, and starts with one of three roots: `labs/`, `evidence/` or `lessons/files/`. The root itself must resolve inside the workspace (`isInsideVault(ws, root)`), so a symlinked root that leads outside is refused (F9). The script must resolve inside its root and be a regular file that is not a symlink (`lstat`). `sha256` is 64 lowercase hex characters. A script runs with no arguments, from the workspace root.
- `readLabs(ws)` in a new `bin/lib/labs.mjs` returns the validated object, its keys in the order above, or throws with one line per problem.
- The buttons map onto the issue's commands: Run runs the checks, then `up`; Stop signals the running `up` or `verify` and runs no script; Reset runs `down`; Check my work runs `verify`.

Why a script with no arguments: every byte that decides what runs is then in a file the pin covers. Scripts that take an argument (the library's entry points, which take their stage from it, F1; 9 of the 17 lab scripts of F2 use a positional parameter) get a one-line wrapper. A check is a script judged by its exit status alone. Rejected: an argument list or a shell string in the manifest (a second place that changes what runs, outside any hashed file).

Why three roots: `lessons/files/*-lab/` is where today's labs live (F2) and what the README's `## Labs` table lists; `evidence/` lets a checked task pin its own `setup.sh` and `check.sh`; `labs/` holds wrappers and checks. Scripts under `lessons/files/` are served and exported as files, as they are today (teach.mjs 454 to 477, 714 to 744); `labs/` and `evidence/` are not (F3). Rejected: any other path in the repo, so a lab on the repo's library pins only its wrapper (Risks).

The binding's `lab` block (issue 60) stays an author rule: the server never reads it, and `lintLab`'s directory list gains `labs`. The module ships no check and names no tool (Tests, test 1).

### D2. Pins (judgment)

- **What and where.** Each script's bytes, SHA-256 hex, beside its path in `labs/labs.json`. The lab's pin, `labPin(id, lab)`, is the SHA-256 hex of `JSON.stringify([id, lab])` with the entry as `readLabs` returns it, so it covers every script's path and hash, the checks, the env names, the cost and the timeout. The lesson stores it inside its lab section, as `<data class="lab-pin" value="<64 hex>"></data>`: inside, because a changed opening-tag attribute kept the lesson's verdict and a changed inner element did not (F9).
- **Who writes them.** The author, by hand. `teach lint` names the value it expects: `LAB_HASH_MISMATCH` says `<path> changed: read the change, then copy sha256 <actual> into labs.json`, and `LAB_PIN_STALE` gives the new pin. No command writes `labs.json` or a lesson. The claims reviewer reads only the draft, the vault and the image files its evidence lists (agents/claims-reviewer.md 3): it sees a script only as the author captured it in the vault, and nothing compares that capture with the pinned file. A re-pin is the author's own review of the change (Threat model 5).
- **When checked.** At lint (D3). At server start, `readLabs` only; an invalid manifest exits 2. At each action, before anything runs: the server hashes every script the action runs (Run: each check and `up`; Reset: `down`; Check my work: `verify`), and requires a lesson that stores the current pin (D4, check 9). Run hashes `up` again after the checks pass, immediately before it starts it, since the checks can take 100 s or more (ten checks of `CHECK_TIMEOUT`, plus `STOP_GRACE` and `KILL_WAIT` for each that times out).
- **The lesson the server reads.** For each `lessons/*.html`, the server reads the lab block `parseBlocks` returns, the same one the gate hashes (gate.mjs 104, 136 to 137): `data-lab` from its attributes, and the `lab-pin` `<data>` element from its inner HTML. Nothing else on the page counts. The server does not read the ledger. The verdict binds where it already does: the pin sits in a gate unit, so a re-pinned lesson has no verdict until it is gated again (F9), and `teach export` sorts a lesson without one as ungated (teach.mjs 714 to 744, 753 to 759).
- **When a changed script leaves an environment Reset will not remove.** Reset hashes only `down` and needs a lesson that stores the current pin. It refuses when `down`'s bytes no longer match `labs.json`, or when `labs.json`'s entry has changed (any script re-pinned, or any other field) and no lesson stores the new pin yet. A changed `up` that has not been re-pinned refuses Run only. When Reset refuses, the author runs `down` by hand from the workspace root, or finishes the re-pin.
- **What the pin does not stop.** The bytes are hashed just before `spawn` runs the file by path; a file swapped in between runs. Anyone who can write the workspace can also edit `labs.json` and the lesson. The pin catches drift, not a hostile writer. Rejected: running the hashed bytes through `bash -c` (it would make bash every script's interpreter and change the path the 164 scripts of F1 that read `$0` or `BASH_SOURCE` see; not probed).

### D3. The lab section (judgment)

**Markup.** One `<section>` whose `data-block` is `lab`, with `aria-label="lab"` and `data-lab="<id>"`. It holds the `lab-pin` `<data>` element, a cited sentence or two on what the lab builds, and at least one `<pre>` of output from the author's run, cited to the experiment whose log holds that run. It is optional in any shape. `parseBlocks` also matches a section inside an HTML comment, and returns the first (F9). So a commented-out lab section placed first is the one the server reads and the gate hashes, and the page does not show that section. Lint therefore refuses a second lab section, or one inside a comment.

**What `serveFile` adds**, after the opening tag that `parseBlocks` matched, when the manifest is valid and names the id: `labStepsHtml(lab)`, escaped. It is a `<p class="lab-cost">` with the cost line, then `<p>The author ran:</p>`, then one `<pre>` each for the `up` path, the `verify` path when the lab has one, and the `down` path. With an invalid manifest, or an id it lacks, `serveFile` adds nothing. With `--labs`, the opening tag also gets `data-lab-live` (and `data-lab-verify` when the lab has one), but only on a request that carries the lab cookie (D4). On a request without it, `serveFile` instead adds `<p class="lab-open">To run this lab from the page, open the lab address teach serve printed when it started.</p>`.

**Lint** (`teach lint` never runs a script):

| Code | File | When |
|---|---|---|
| `LAB_MANIFEST_INVALID` | `labs/labs.json` | one per problem `readLabs` reports, path and symlink rules included |
| `LAB_SCRIPT_NOT_RUNNABLE` | `labs/labs.json` | no owner executable bit, or a first line that is not `#!` (F6) |
| `LAB_HASH_MISMATCH` | `labs/labs.json` | `<path> changed: read the change, then copy sha256 <actual> into labs.json`, or `<path> cannot be read` |
| `LAB_UNKNOWN` | the lesson | no `data-lab`, or an id the manifest lacks |
| `LAB_PIN_STALE` | the lesson | no `lab-pin` element, or `the stored pin is <old>; the lab's pin is <new>` |
| `LAB_SECTION_DUPLICATE` | the lesson | more than one opening tag whose `data-block` is `lab`, or one inside an HTML comment |
| `LAB_OUTPUT_MISSING` | the lesson | no `<pre>` in the section, or no cited `experiment` entry |
| `LAB_VERIFY_MISSING` | the lesson | a `project` lesson's lab has no `verify` |

This spec reads the issue's lint line as `LAB_UNKNOWN`, `LAB_HASH_MISMATCH` and `LAB_PIN_STALE`. "Since the lesson's claims verdict" is held by the gate unit that holds the pin (D2).

**The widget**, `renderLab(section)` in quiz.js, acts on `document.querySelector` of the first element whose `data-block` is `lab`. It acts only when that element has `data-lab-live`, the body has no `data-export`, and `location.origin` matches the pattern `postAttempt` uses (quiz.js 154 to 155). Each button sends `POST /lab/<action>` with `{"lab": "<id>"}`, reads the reply with a reader, and appends each chunk to the output `<pre>` through `textContent`, so nothing is parsed as HTML.
- Stop is enabled while a Run or a Check my work reply is open, and disabled otherwise, including during Reset (the server answers a stop during `down` with 409, since `down` cannot be stopped from the page).
- While Run's reply is open, Run and Reset are disabled and Check my work stays enabled. While Check my work or Reset runs, its own button is disabled.
- The status line (`role="status"`) is set from the reply's final line only when the reader reports done and that line starts with `lab: `; otherwise it says the reply ended early. A 4xx or 5xx reply's body becomes the status.

### D4. Routes and what the server refuses (judgment)

**Off unless asked for.** Lab routes exist only under `teach serve --labs [workspace]` (`labs` added to `BOOL`, args.mjs 1 to 12). Without it, a `POST /lab/...` is 404 as today (F3).

**The lab address.** Two random values, each from `randomBytes(32)` (256 bits, 64 hex characters):
- At start, `teach serve --labs` makes the address value `t` and prints `labs: open http://127.0.0.1:<port>/labs/open?t=<t>` once in its terminal. `t` is never written to `.teach-serve.json`, a page, a log line or a file.
- `GET /labs/open?t=<t>[&next=/lessons/<id>.html]` compares `t` in constant time: lengths first, then `crypto.timingSafeEqual`.
  - On a match it answers 303 to `next` (when `next` matches `^/lessons/<LESSON_ID_RE>\.html$`, else `/`), with `Set-Cookie: rv-labs-<port>=<session value>; HttpOnly; SameSite=Strict; Path=/`. The session value is made at the first match and kept for the life of the server, and nothing is voided: `t` stays valid while that server runs, so the learner opens the same address again after a browser restart or in a second browser.
  - A wrong or missing `t` is 403 and sets no cookie (the first labs commit's runs: a wrong and an empty `t` each gave 403 with no `Set-Cookie`).
- The lab routes compare the cookie with the session value, never with `t`. The cookie has no expiry and lasted only while the browser ran (F10).
- The address is reusable by the user's choice (2026-11-11). The token is the only thing that stops another local account; making it single-use only added protection against someone who reads `t` later, from `ps` or the browser's history (neither checked by a run) or a transcript, at the cost of a restart of `teach serve --labs` after every browser restart. A new `t` comes only with a restart.
- Opened at the plain address, a lesson shows its lab with D3's steps and the `lab-open` line, and no buttons.

**Framing.** Under `--labs` every response carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. A page on another `127.0.0.1` port is same-site, the browser sent the `SameSite=Strict` lab cookie to another `127.0.0.1` port the lab page fetched or framed, and on a POST from a frame on that port (F10); a page on another port framing a lesson was not run, and the headers are there in case it carries the cookie too, since once a lesson has buttons such a page could frame a live lesson and trick a click. Without `--labs` no response carries either header.

**Routes.** `POST /lab/run`, `/lab/stop`, `/lab/reset` and `/lab/verify`. The body is exactly `{"lab": "<id>"}`. No route takes a path, a command, an argument or an environment value. No `GET` starts anything.

**Checks, in order.** The first that fails answers, and nothing runs:

| # | Check | Refusal |
|---|---|---|
| 1 | `Host` is `127.0.0.1:<port>` | 403 `forbidden` |
| 2 | the `POST` path is `/attempt` or, with `--labs`, one of the four | 404 `not found` |
| 3 | `Origin` is `http://127.0.0.1:<port>`; `Content-Type` is `application/json`, optionally `; charset=utf-8`; `Content-Length`, when present, at most `LAB_BODY_MAX` (256); a body without it is counted and cut at 256 bytes | 403 `forbidden` |
| 4 | the `rv-labs-<port>` cookie equals the session value, compared as above | 403 `no lab cookie; open the lab address teach serve printed` |
| 5 | the body is a JSON object with exactly `lab`, matching `LAB_ID_RE` | 400 `body must be {"lab": "<id>"}` |
| 6 | `labs/labs.json` reads and validates | 500 `labs/labs.json is invalid; run teach lint` |
| 7 | the id is in the manifest | 404 `no lab` |
| 8 | for verify, the lab declares `verify` | 404 `no verify` |
| 9 | except for stop, a lesson stores the lab's current pin (D2) | 409 `no lesson stores this lab's current pin` |
| 10 | except for stop, every script the action runs hashes to its pin | 409 `pin mismatch: <path>` |
| 11 | for run, reset and verify, each `env` name is set in the server's environment, 8 or more characters, no line break | 409 `env <NAME> is unset, shorter than 8 characters or multi-line` |
| 12 | run and reset: nothing is running; verify: nothing is running, or only this lab's `up` | 409 `busy: <id> <action>` |
| 13 | for stop, this lab's `up` or `verify` is running | 409 `not running` |

Checks 1 to 4 read no byte of the body. Checks 6 to 12 and taking the run slot happen synchronously, in one turn of the event loop once the body has arrived (files read and hashed with synchronous calls), so two requests cannot both pass check 12. A refusal names a lab id only after it matched `LAB_ID_RE`, and a path or variable name only as the manifest spells it, never a value, `t` or the session value.

**Concurrency.** One action at a time across the server, with one exception: `verify` may run while the same lab's `up` runs, spawned detached so that it leads its own process group as item A's child did, with its own reply (F5; `verify`'s own group id was not printed in item R). That is how a lab whose `up` stays in the foreground is checked.

**The reply.** 200 with `Content-Type: text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, chunked (F7). A script's lines pass through after redaction and the `\r` cut (D6); a line that then starts with `lab:` is sent with `> ` in front, so `x\rlab: verify pass` gives `x` and `> lab: verify pass`. The server's own lines start with `lab: `:
- Run gives `lab: check <n> ok` or `lab: check <n> failed: <message>` for each check. When any fails, `lab: not started, <k> check(s) failed` ends the reply.
- After the script's output has ended (`close`), the server writes exactly one final line: `lab: exit <code>`, `lab: stopped`, `lab: stopped (processes remain)`, `lab: timed out after <t> s` or `lab: could not start: <code>`. Verify's final line is D7's.
- `POST /lab/stop` answers with the same stopped line, written after the last group it stops is gone.

The server prints one line per lab request that passes check 5, `lab <id> <action>: <status or ending>`, and nothing of a script's output.

### D5. Starting, stopping and resetting (judgment)

- **Start.** `spawn(<absolute script path>, [], { cwd: <workspace>, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })` inside `try`, with an `error` listener; `ENOEXEC` throws and `EACCES` arrives as an event (F6).
- **Environment.** `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG` and `LC_ALL` from the server's environment when set, plus the lab's `env` names; nothing else (F6). Anything else a tool needs, `KUBECONFIG` for example, is declared in `env` and so redacted.
- **Process groups.** Each `up`, `down`, `verify` and check leads its own group (F5). Every signal goes to a group, never to a leader alone (F5).
- **The end of a run.** When the leader exits, the rest of its group gets the Stop sequence, and the reply ends on `close` (F6). Nothing a run left in its group outlives it. A lab that needs a process to stay up keeps it in the foreground of `up`, where Stop ends it and a concurrent `verify` can check it. An environment meant to outlive `up` lives outside the group, under a daemon, and `down` removes it; that case was not run.
- **The Stop sequence.** `SIGTERM` to the group. After `STOP_GRACE` (5 s), `SIGKILL` if `process.kill(-pgid, 0)` still succeeds. Then poll that every 20 ms for at most `KILL_WAIT` (2 s), and end with `lab: stopped`, or `lab: stopped (processes remain)` if the group outlasts the bound (F5). Stop runs it on the lab's running `up` and `verify` groups at once, and writes its reply line after the last of them is gone.
- **Reset** runs `down` only when nothing is running (check 12), so the learner presses Stop, then Reset. `down` runs no checks. It runs to completion, bounded by the lab's `timeout`, even if its page closes: a half-run teardown would leave the state it exists to remove.
- **Limits.**
  - `up`, `down` and `verify` each get the lab's `timeout`. A check gets `CHECK_TIMEOUT` (10 s); a check that times out has failed, and its output is dropped.
  - At expiry the Stop sequence runs, and the reply ends with `lab: timed out after <t> s`.
  - A reply carries at most `LAB_OUTPUT_MAX` (1 MiB) of script output, then `lab: output over 1 MiB not shown`. The rest is read and dropped while the script runs on.
  - Tests pass smaller limits through a `createServer` option.
- **The page closes.** A reply's `close` before it finished runs the Stop sequence on that action's group (F7), except for `down`.
- **The server exits.** `SIGINT`, `SIGTERM` and `SIGHUP` handlers run the Stop sequence on every running group, `down` included, then exit. An `exit` handler sends `SIGKILL` to every running group, which covers an uncaught exception (F8). Without the `SIGHUP` handler, a server under `script` on a pseudo-terminal, with `script` killed, left its lab running (F8).
- **Not a sandbox.** A script runs as the user who started `teach serve`. A process that leaves its group is out of reach (F5), and so, by design and not run, is one a daemon starts.

### D6. Secrets (judgment)

- **Where from.** The environment `teach serve` was started in, under the names a lab lists in `env`, or a file a script reads itself, whose presence a check may test (check output is never shown). Never from the page, the manifest (names only), a URL or the lesson.
- **How it reaches the script.** As an environment variable, under the declared names only, to that lab's scripts only (D5).
- **The stream.**
  - Each of stdout and stderr goes through a streaming UTF-8 decoder (`StringDecoder`), so a character split across chunks still decodes whole (F7).
  - The text is cut into lines at `\n`. In each complete line every occurrence of each value is replaced with `[redacted]`, longest value first; the line is then cut again at `\r`, and only then does a piece that starts with `lab:` get its `> ` (D4).
  - A partial line waits for its `\n`; at `close`, the final partial line is redacted and flushed. A line over 65536 characters is dropped with `lab: a line over 65536 characters is not shown`, and the rest of that line up to the next `\n` is discarded too (F7).
  - The values are the current values of the lab's `env` names. A value shorter than 8 characters, or holding a line break, refuses the action (check 11).
- **The page and the logs.** Served pages are not redacted. `teach serve --labs` prints at start one line, `warning: <path> holds the value of <NAME>`, for each lesson or reference page that holds a declared value. The check is the export's, below. The server's log lines are D4's. Nothing about a run is written to disk, and the widget stores nothing.
- **The export** refuses with `secret <path>: <NAME>` when an exported page holds the value of a declared `env` name set in the export's environment.
- **Not promised.** No pattern scan for unknown secrets. Not caught:
  - a value the script transforms (base64, F7), prints across two lines (F7) or one character per line, or prints with an ANSI escape inside it (F7);
  - a secret not declared in `env`;
  - what a script, a container, a daemon or a tool writes to its own files or logs;
  - whatever the learner's tools print that is not a declared value.

### D7. Verify (judgment)

Check my work runs `verify` and shows pass or fail. Exit 0 ends the reply with `lab: verify pass`. Any other exit code, a timeout or a stop ends it with `lab: verify fail (exit <code>)`, `(timed out)` or `(stopped)`. A script that cannot start gives `lab: could not start: <code>`.

A script that prints `lab: verify pass` is sent as `> lab: verify pass`, and the widget takes its status only from the final line. The server writes that line after the script's output has ended (D4). A `project` lesson uses verify as its check by showing pass or fail; recording stays with `writeAttempt`'s `result`, as today (teach.mjs 131 to 166). For a checked task, `verify` is `check.sh`, whose `PASS` or `FAIL` lines show above the verdict.

### D8. The export (judgment)

The export reads pages through `serveFile` without `--labs`. A lab section therefore exports with "The author ran:", the step paths, the cost line and the captured output, with no `data-lab-live` and no `lab-open` line. `renderLab` returns on `data-export`. `labs/` and `evidence/` are not copied; a script under `lessons/files/` is, as any file there is today (teach.mjs 714 to 744). Two new refusals:
- `secret <path>: <NAME>` (D6);
- `lab-manifest labs/labs.json: invalid; run teach lint`, when the manifest is invalid and an exported page has a lab section.

Rejected: inlining script text (open question 1).

### D9. What else changes (judgment)

- **`SECURITY.md`.** Five lines become false with `--labs` and are qualified "without `--labs`", each with what holds with it:
  - line 11, "`teach serve` writes only in the teaching workspace it serves": with it, it also runs the lab scripts a workspace pins, which write wherever they write;
  - line 17, `teach serve` writes one attempt file per accepted `POST /attempt` and `.teach-serve.json`: the same addition;
  - line 27, "Everything else is 404": with it, `GET /labs/open` answers too;
  - line 28, "One write, `POST /attempt`. A `POST` to any other path is 404": with it, the four lab routes also answer;
  - line 31, "Besides that file and the attempt files, it writes nothing": as line 11.

  Two lines gain a clause: line 3's count of features that reach outside the vault gains lab runs, and line 23's purpose gains "and, with `--labs`, run a lesson's lab".

  A new section, "Lab runs (`teach serve --labs`)", states the lab address and cookie, D4's checks, D5's process rules, D6 with what is not promised, and the threat model below.
- **`docs/REFERENCE.md`.** The `teach` row (REFERENCE.md 193): `serve [--labs]`, the lab address, the routes and replies, the `LAB_*` codes, and the export's two refusals.
- **The research-teach skill.**
  - Section 3: a lab is `labs/labs.json` plus its scripts, the three roots, pinning by hand, and wrappers for scripts that take arguments.
  - Section 4: the lab section, and deleting the workspace's `assets/quiz.js` after the upgrade so `cp -n` delivers the widget (SKILL.md 84 to 88).
  - Section 5: start `teach serve --labs` only for a lab lesson on a single-user machine, and open it through the lab address with `next`. The skill may reuse a running `teach serve --labs` only while it still has that server's address; otherwise it restarts it, since `.teach-serve.json` does not hold `t`.
- **`LESSON-FORMAT.md`.** A `## Labs` section (markup, manifest, lint codes) and no row in the Blocks table: a row would need a `lesson.css` rule and a `reading.html` entry, which the existing tests of the Blocks labels require of every row.
- **`README-FORMAT.md` and `teach readme`.** A manifest lab gets its own `## Labs` row. `teach readme` prints, after the directory rows, one row per manifest lab: `| <ids of lessons whose lab section names it> | labs/labs.json: <id> | <cost>; env: <names or none> |  |`.
- **`scripts/deps.mjs` COUPLINGS** (deps.mjs 28).
  - quiz.js and teach.mjs: the paths, the body, the `lab: ` lines, `data-lab-live`, `data-lab-verify`;
  - `LESSON-FORMAT.md` and `bin/lib/labs.mjs`: the manifest keys, limits, roots and patterns;
  - `README-FORMAT.md` and teach.mjs: the manifest row;
  - `SECURITY.md` and `bin/lib/labs.mjs`: the constants, the env allowlist, the cookie name.
- **One new module**, `bin/lib/labs.mjs`, holds the reader, the pin, the redactor and the runner.

## Threat model

Who can reach the server, what each can make it do, and what stops them:

1. **The learner's browser, after the lab address.** It holds the cookie, so it can Run, Stop, Reset and Check my work on any lab some lesson stores the current pin for, naming only an id. That includes a lesson with no verdict: the server does not read the ledger, so an author can run an ungated lesson's lab from the page.
2. **A page from another origin in the same browser** (another site, another `127.0.0.1` port, or a rebound name). A JSON `POST` is preflighted and gets 405. A `text/plain` or `no-cors` `POST` carries its own `Origin` and fails check 3, even when the browser attaches the lab cookie, as it did for a page on another port (F4, F10). A rebound name fails check 1. Nothing runs, and no reply can be read. Only headless Chrome 157 was run. A page on another `127.0.0.1` port is same-site, and the browser sent the lab cookie across ports in the F10 runs; under `--labs` every response carries the two headers meant to forbid framing (D4), though no browser was run against them (Not established).
3. **Another local process or account.** It can set `Host` and `Origin` (F3), but without the session value it fails check 4: it can neither run a lab nor read a run's output, which reaches only the requester. It can read the served pages. This spec assumes, without a run, that another account can open a `127.0.0.1` port. The address does not stop:
   - anyone who reads `t` from the terminal where `teach serve` printed it, the command line of an `open` call that passed it (likely visible in `ps`; not checked by a run), a background task's output file, an agent's transcript or the browser's history (not checked): they can open the address, and get the session, while that server runs;
   - a process that can read the browser's cookie store;
   - a server on another `127.0.0.1` port that the browser requests while the cookie is set, because the browser sent the cookie there (F10).

   The new `SECURITY.md` section will say `--labs` is for a single-user machine (D9).
4. **A browser extension** with access to the page or to cookies can read the stream and the cookie and drive the routes. Nothing here stops it.
5. **Anyone who can write the workspace.** Pins catch a script or entry that changed without a re-pin. The claims reviewer reads only the draft, the vault and the image files its evidence lists (agents/claims-reviewer.md 3), and nothing checks a captured script against the pinned file. So a re-pin is the author's own review, and someone who edits a script, `labs.json` and the lesson's pin together gets their script run, gated or not. The gap between the hash and the spawn is accepted.
6. **The script itself** runs with the user's rights and no sandbox. Only D5's environment allowlist, limits and group kill bound it.
7. **Whoever receives an exported copy.** There is no server; the lab is text (D8).

## Risks

- **Today's labs need work first:** of the 17 scripts under `lessons/files/*-lab/`, 9 use a positional parameter, 3 call `sudo`, which, needing a password, failed with no terminal and stdin ignored, and 3 call a VM tool (F2).
- **The pin covers the named files only.** 84 of the library's 174 scripts source a `../` or absolute path (F1), so a library lab pins its wrapper and nothing the wrapper reaches.
- **SIGKILL, or any other fatal signal the server does not handle, leaves the group running.** `SIGKILL` and an unhandled `SIGHUP` were run (F8); the others were not. So does a process that leaves its group (F5) and, not run, one a daemon starts.
- **A changed or re-pinned `down` can strand an environment** that Reset then refuses to remove (D2).
- **A stopped or timed-out `up` leaves part of an environment**; `down` must handle that.
- **Leaving the page stops `up`**, even in the middle of a long step (F1).
- **A workspace's copied `quiz.js` has no widget** until it is copied again (D9).
- **`t` is readable while the server runs**: in the terminal, an `open` command line, a background output file or a transcript, and probably the browser's history (not checked). Whoever reads it can open the address until that server stops. The browser sent the cookie to another `127.0.0.1` port the lab page fetched or framed (F10).
- **Redaction has holes** (D6), and a declared value under 8 characters cannot be used.

## Not established

- How Safari and Firefox treat the cross-origin `POST`, the preflight, a script-set `Origin`, and the cookie across ports.
- A real browser page reading a streamed body; only node's `fetch` read one (F7).
- Platforms other than macOS 27.0.1 with node v22.23.4.
- A container or VM a script starts when its group is killed.
- The real lab scripts under `SIGTERM` (none was run).
- A process that `SIGKILL` cannot end, which `KILL_WAIT` is for.
- Another account opening a `127.0.0.1` port.
- How a browser treats `X-Frame-Options: DENY` and `frame-ancestors 'none'` on these pages; no browser was run against them.
- `bash -c` as a way to run hashed bytes.

## Open questions

1. Should the export carry a lab's script text so the steps can be run from the copy? Default: paths, plus whatever `lessons/files/` already copies (D8).
2. Should a lab entry pin further files, such as what its wrapper sources? Default: no (Risks).
3. Should a run outlive its page, with a status route to reattach? Default: no (D5).

## First slice

Commit 1 below: the manifest, the pins, the lab section, its lint, the lab address and cookie, and every refusal of D4 except busy, with no code that starts a process.

## Tests

The tests run on workspaces built in a temp directory per test. Each has `MISSION.md`, lessons with a lab section, `labs/labs.json`, and scripts written with mode 755 under each root. The server is `createServer(ws, { labs: true, t, env, limits })`, so a test sets its own `t`, environment and limits and never touches `process.env`. A test gets the cookie through `/labs/open`. No file is added under `test/fixtures/teach/`.

1. **No topic-specific code; two unrelated labs on the same code.**
   - Workspace A's `up` starts a background `sleep` as a stand-in service; workspace B's `up` runs `node -e` to write a file.
   - Each runs, verifies `pass` and resets.
   - `bin/lib/labs.mjs` and quiz.js's lab functions match none of `docker`, `podman`, `kubectl`, `helm`, `kubernetes`, `vcluster`, `python`, `pip`, `venv`, as words in any case.
2. **Run, stop and reset, with the output streamed.**
   - Server side: `up` prints its pid, then a line every 100 ms, and the first line arrives before the action ends.
   - Stop gives `lab: stopped`, and `process.kill(-pid, 0)` throws `ESRCH`.
   - Reset while `up` runs is 409; after Stop, Reset runs `down`, which removes `up`'s file, and ends `lab: exit 0`.
   - A client that aborts during `up` leaves no process of the group; one that aborts during `down` does not stop it.
   - Browser side, with `renderLab` and a stub `fetch` on `globalThis`, as test/quiz.test.mjs's widget tests use (quiz.test.mjs 159 to 166), returning a reply whose body yields three chunks:
     - the output `<pre>` gains each chunk through `textContent`;
     - Run and Reset are disabled and Stop is enabled while the reply is open, and the reverse after; Stop is disabled while a Reset reply is open;
     - the status line becomes the final line, not an earlier `> lab: verify pass` line; a reply whose body ends without a final `lab: ` line gives the ended-early status.
3. **The three refusals, each written and failing before any code that starts a script exists.**
   - (a) `{"lab": "nope"}` gives 404 `no lab`.
   - (b) `up.sh` with one byte changed gives 409 `pin mismatch: <path>`.
   - (c) `Origin: http://127.0.0.1:<port + 1>`, with the lab cookie on the request, gives 403.

   In each, the file `up.sh` would write does not exist. Also:
   - another `Host`: 403; no `--labs`: 404;
   - no cookie, `t` as the cookie, or a wrong `t` at `/labs/open`: 403; `t` a second time: 303 with the same cookie;
   - under `--labs` every response carries the two framing headers; without it, none;
   - no lesson storing the pin: 409; a short env value: 409, naming the variable and not the value;
   - an extra body key: 400;
   - a symlinked root, a symlinked script, or a path outside the pattern: `LAB_MANIFEST_INVALID`, and 500 at the route.
4. **Checks before `up`.** Two checks, the second exiting 1, give `lab: check 1 ok`, `lab: check 2 failed: <its message>` and `lab: not started, 1 check(s) failed`, and `up`'s file does not exist. A check's own output is not in the reply. With both passing, `up` runs.
5. **Verify shown as pass or fail.**
   - Exit 0 gives `lab: verify pass`; exit 1 gives `lab: verify fail (exit 1)`.
   - A verify started while the same lab's foreground `up` runs gets 200, leads its own group, and passes on the file `up` wrote.
   - No file is added under `attempts/`.
6. **No secret value in the page, the stream or the logs.** `LAB_TOKEN` is set to a 20-character test value containing a two-byte character. `up` prints it:
   - whole;
   - in two writes, the split inside that character;
   - on stderr;
   - inside a 70 KiB line, whose rest after the next chunk is dropped too;
   - on a last line with no newline.

   Then:
   - the reply holds `[redacted]` and not the value;
   - the server's log lines hold neither the value nor `t` nor the session value; its start output holds `t` only on the `labs: open` line, and never the value;
   - neither `.teach-serve.json` nor any served page holds `t` or the session value;
   - no file under the workspace holds the value after the run;
   - a lesson holding the value gives the start warning, and its export refuses with `secret`.
7. **The export shows the steps and captured output instead of buttons.** The page has "The author ran:", the cost line, the step paths and the captured output, with no `<button`, no `data-lab-live` and no `lab-open` line. `renderLab` with `data-export` adds nothing. No path under `labs/` or `evidence/` is in the file set. An invalid manifest refuses with `lab-manifest`.

Beyond the acceptance lines:
- the env allowlist;
- a timeout of 1 s gives `lab: timed out after 1 s` and no process of the group;
- a leader that leaves a background child leaves no process of the group;
- the output limit;
- `SIGTERM`, and `SIGHUP`, to a `teach serve --labs` child process during a run leave no process of the group;
- a busy server gives 409, and two run requests sent together give one 200 and one 409;
- a script printing `x\rlab: verify pass` gives `> lab: verify pass`;
- `teach readme` prints the manifest row;
- the existing serve tests pass unchanged.

## Order of commits

Each commit adds its own line under `## [Unreleased]` in `CHANGELOG.md` (CHANGELOG.md 8) and leaves `npm test` green.

1. **The manifest, pins, lab section, lint, lab address and refusals; nothing runs.**
   - First, test 3's three refusals are written and seen failing at the starting commit: today all three get 404 `not found`, since `createServer` checks the path first (teach.mjs 828 to 830; F3).
   - Then: `bin/lib/labs.mjs` (`readLabs`, `labPin`, the pin reader); `labs` in `BOOL`; `t`, `/labs/open`, the session value and the cookie; checks 1 to 11 and 13, with a route that answers 501 `lab runs are not built yet` once they pass; `labStepsHtml` and the `lab-open` line; the `LAB_*` codes; `lintLab` reading `labs/`; `teach readme`'s manifest row; the rest of test 3.
   - Gated docs staged: `skills/research-teach/LESSON-FORMAT.md`, `skills/research-teach/README-FORMAT.md`, `docs/REFERENCE.md` (`serve --labs`, the lab address, the refusals, the lint codes) and `skills/research-teach/SKILL.md` (section 3). Also `SECURITY.md`'s changed lines and the lab section as far as the refusals, and the `LESSON-FORMAT.md` and `README-FORMAT.md` COUPLINGS rows.
2. **The runner and the widget.**
   - D5 in `labs.mjs`; the `SIGINT`, `SIGTERM`, `SIGHUP` and `exit` handlers; D6's redactor and start warning; D7; `renderLab`; the export's two refusals.
   - Tests 1, 2, 4, 5, 6 and 7, the busy 409, and the others listed after them.
   - Gated docs staged: `docs/REFERENCE.md`, `skills/research-teach/SKILL.md` (sections 4 and 5) and `skills/research-teach/LESSON-FORMAT.md`, with the rest of `SECURITY.md` and the remaining COUPLINGS rows.

## What the labs leave open for later issues

This spec designs nothing for issues 64 and 65. Later work on them starts from three rules here:
- the lab section adds markup with no rule of its own (`lab-cost`, `lab-open`, the step `<pre>`s, the buttons, the output, the status line); lesson.css 68 labels any `data-block` element with its name;
- a lab's output reaches the page only through D6's line redactor, and nothing of a run is kept on disk;
- an exported lab is its steps and the author's captured output, where a recorded replay could later appear.
