# Spec 48: `teach export` and `teach attempt import`, a static copy of a teach workspace that works from `file://` (#62)

Round 3 (2026-11-11), at e80b914 with no code changed. This spec designs upstream issue 62 (2026-11-11-research-vault-issue-62-research-teach): "A `teach export <workspace> --out <dir>` command ... that writes a self-contained static site", quizzes that keep working with attempts kept in the browser and an "Export my results" button, and `teach attempt import <file>`. The code lines it rests on are quoted in 2026-11-11-lines-behind-spec-48-teach-export ("the snippet") and 2026-11-11-second-lines-behind-spec-48-teach ("the second snippet"), and the runs are in 2026-11-11-third-round-spec-48-export-probes ("the probes": round 1 items 1 to 6, round 2 items A to H, round 3 item I). Everything under Decisions, First slice, Tests and Order of commits is this spec's judgment unless it cites an entry.

## What exists, in one paragraph

`teach serve` serves files only from `STATIC_DIRS = ['lessons', 'reference', 'assets']` plus `GLOSSARY.md`, renders `/` with `indexHtml`, which reads `lessonIndex` and the workspace `README.md` itself, renders `/progress` with `progressHtml`, and answers `/lessons.json` and `POST /attempt` (the snippet, teach.mjs 325 to 327, 373 to 396, 490 to 514, 549 to 570). `serveFile` passes a lesson or reference page through `footnoteCitations` and inserts `navHtml()` after `<body>` on an HTML page that does not load `quiz.js`; `navHtml`, `indexHtml`, `progressHtml` and reading.html's back link use root-absolute paths such as `/`, `/progress` and `/assets/lesson.css`, while a lesson links its stylesheet and script as `../assets/` (the snippet: teach.mjs 302 to 306, 315 to 317, 373 to 396, 490 to 514; reading.html 6 to 10; LESSON-FORMAT.md 13; the probes, item 1). A lesson's own navigation bar is built only by `renderNav` in quiz.js, from a `fetch('/lessons.json')`, and only when `location.origin` matches `http://127.0.0.1:<port>`; quiz.js's `postAttempt` has the same guard, and when the reply is null the widget appends `Tell me your score in the terminal.` (the snippet, quiz.js 1 to 3, 61 to 97, 132 to 144). The server grades: teach.mjs's `postAttempt` passes the body's `lesson` and `answers` to `writeAttempt` with the server's clock as `now`, and `writeAttempt` takes the attempt's `date` and id from that `now` (the snippet, teach.mjs 118 to 161, 533 to 545, 549 to 570; SECURITY.md 28 to 31). quiz.js is an ES module whose functions bin/lib/teach.mjs and bin/lib/lesson.mjs import (the snippet, teach.mjs 11 to 13, lesson.mjs 14).

## Findings from research

**F1. In headless Chrome 157 a module script did not load from `file://`; a prototype of quiz.js with `export ` removed and its default submit swapped for a localStorage save did, as a classic script, with `defer` when in `<head>`.** MDN's modules guide, as captured on 2026-11-03, says that loading the HTML file "with a file:// URL" runs into "CORS errors due to JavaScript module security requirements", and names no browser (2026-11-03-mdn-javascript-modules-guide-local-testing). In headless Chrome 157.0.8103.40 the fixture lesson opened from `file://` rendered no quiz option and logged "Access to script at 'file:///.../assets/quiz.js' from origin 'null' has been blocked by CORS policy" (the probes, item 3). quiz.js has no `import`, `import.meta` or top-level `await` line and no `export` that does not start a line (the probes, item C). With every line-initial `export ` removed it compiles under `vm.Script`; a prototype made that way, with its default submit swapped for a localStorage save, loaded as `<script src="../assets/quiz.js"></script>` at the end of the body from `file://`, rendered the quiz, scored it and logged no console line (the probes, item 4). Loaded from `<head>`, that prototype rendered no option without `defer` and the page's two with it (the probes, item D). From `file://`, headless Chrome 157 gave a page its full file path as `location.pathname` (the probes, item I), and `lessonIdFrom` returns null for such a path unless given a fallback (the probes, item E).

**F2. Browser storage carried across two prototype pages in headless Chrome 157.** In that prototype, a save to `localStorage` from `lessons/0001-good.html` was read back by `progress.html`, one directory up, in a second headless run with the same profile; that page printed its origin as `file://` (the probes, item 4). No Firefox is in `/Applications` on this machine, and the one Safari 27.0.1 attempt captured nothing (the probes, "Not run in round 1").

**F3. Import and `POST /attempt` reach the same writer.** The server's route passes the body's `lesson` and `answers` and its clock's `now` to `writeAttempt` (the snippet, teach.mjs 141 to 161, 533 to 545), the call import would make with the browser's `at` as `now`; one probe gave byte-identical files. The attempt the Chrome prototype stored, graded by `writeAttempt` with `now = new Date(at)`, and the same answers posted to `createServer` with its clock fixed at `at`, gave the same reply and byte-identical files (the probes, item 5). The widget stores authored option indices, `answers[i] = item.order[k]`, not displayed positions (the snippet, quiz.js 132 to 144), so the shuffle does not enter the file.

**F4. Where real lessons send the learner.** `FOLLOWUP` is the module constant `You can ask follow-up questions in the terminal.` (the second snippet, lesson.mjs 22), and the `connect` row of LESSON-FORMAT.md calls the block "The terminal prompt" (the second snippet, LESSON-FORMAT.md 32). Over the 123 lessons of the four workspaces under `~/vcluster-support-lab/docs/teach/`, the most common connect lead is "Type your answer to Claude Code in the terminal, in a few sentences:" (56 pages); others are "in the Claude Code chat where you started this lesson" (17 with the "window" variant), "Type your answer in the terminal, where this lesson's guide (Claude Code) reads it" (3) and "Answer in the Claude Code terminal" (1); step blocks ask to "tell Claude Code in the terminal" (the probes, items A and H, and the log). With the follow-up sentence and that one connect lead replaced, the rule of D7, applied to the text of each lesson file's `data-block` sections and not to a rendered exported page, leaves 81 of the 123 pages clean and refuses 42: all 26 of kubernetes-basics and 16 of vmetal's 92, with matches in connect 21, step 16, followup 4, mission 2, scaffold 1 and prereq 1 (a page can count in more than one block); three clean pages still hold "terminal" as a plain word (the probes, item A). Round 1's rule, as first written, refused 100 (the probes, item B).

**F5. What the gate, the vault and the CLI already give.** `gatedFiles` covers each workspace's `lessons/*.html`, `reference/*.html` and `README.md`; `teach next`'s `readmeLine` asks `ledgerRoot` and `gateStatus` whether a file has a verdict for its current content, and counts no ledger as none; a manifest entry carries `title`, `summary` and `source_url` (the snippet: gate.mjs 214 to 231, 331 to 332; commands/teach.mjs 66 to 75; manifest.mjs 31 to 36). `isInsideVault(parent, child)` is true for a path at or under `parent` (the second snippet, containment.mjs 26 to 35; the probes, item G). `--skip-ungated`, which is not in `BOOL` in args.mjs, takes the next token as its value: `--skip-ungated ws` parses as `"skip-ungated": "ws"` (the second snippet, args.mjs 1 to 12; the probes, item F). Chrome 157 showed `GLOSSARY.md` opened from `file://` as text (the probes, item 6).

## Decisions

### D1. The command and what it writes (judgment)

`teach export [workspace] --out <dir> [--skip-ungated] [--vault <path>]`, with `skip-ungated` added to `BOOL` (F5). The workspace rule is `teach`'s usual one (the snippet, commands/teach.mjs 16 to 25). Exit 2 when `--out` is missing, exists and is not an empty directory, or is inside the vault or inside the workspace's `lessons/`, `reference/` or `assets/` (`isInsideVault`, F5). The export builds every file in memory, runs the checks of D5, D6 and D7, and writes only when all pass, so a refusal leaves nothing behind. It writes nothing in the workspace outside `--out`, and nothing in the vault.

The layout mirrors the served paths, so the relative links a lesson already has keep working:

| Path under `--out` | From |
|---|---|
| `index.html` | `indexHtml` (D2), README included |
| `progress.html` | a new `localProgressHtml()`: the nav, `<h1>Progress</h1>` and an empty `<section>` whose `data-block` is `progress`, which quiz.js fills (D4) |
| `sources.html` | D5 |
| `lessons/**`, `reference/**`, `assets/**`, `GLOSSARY.md` | every regular file `serveFile` returns 200 for, with HTML limited as D6 says and each page rewritten (D2) |
| `assets/quiz.js`, `assets/reading.html` | the plugin's copies under `skills/research-teach/assets/`, not the workspace's; reading.html gets the nav as any page without quiz.js does |
| `assets/lesson.css` | the workspace's, else the plugin's |

Files are found by a recursive `readdir` of the three directories that does not follow a symlinked directory; each path segment goes through `encodeURIComponent` before `serveFile`, which decodes it (the snippet, teach.mjs 373 to 396). Left out: everything outside `serveFile`'s allowlist of `GLOSSARY.md` and the three directories (such as `MISSION.md`, `NOTES.md`, `PATH.md`, `GATE-LOG.md`, `learning-records/`, `attempts/`, `evidence/`, `.teach-serve.json`, the README's Markdown source) and the vault. The plugin's quiz.js and reading.html are taken because the results file of D4 is a contract between this version's widget and this version's `attempt import`, and because a workspace copy made with `cp -n` before this change still names the terminal. Rejected: overwriting a non-empty `--out` (it could delete results a learner saved there).

### D2. An exported page is the served page, rewritten (judgment)

Each page is what `teach serve` returns (`serveFile`, `indexHtml`), then passed through one function, `exportPage(html, path, ctx)`, which in order:

1. replaces `type="module"` with `defer` on the tag that loads `quiz.js`, giving `<script defer src="../assets/quiz.js"></script>`, which rendered the quiz from `<head>` in headless Chrome 157 (F1);
2. on a page that loads `quiz.js`, inserts `navHtml(index, id)` (D3) after `<body>`, where `index` is `lessonIndex` less any page D6 leaves out;
3. adds `data-export="<key>"` to `<body>`, `<key>` being the workspace directory's name passed through `slugify`, and `data-lesson="<id>"` from the file name when the lesson's `<body>` lacks it, since `lessonIdFrom` needs that fallback under `file://` (F1);
4. applies the replacements of D7;
5. rewrites every root-absolute `href` and `src` (one `/`, not `//host`) to a path relative to the page: `/` to `index.html`, `/progress` to `progress.html`, any other `/x` to `x` under the output root.

`indexHtml(ws, { index, readme })` and `serveFile(ws, path, { titles, sourceHref })` each gain an option whose default keeps today's output: `index` and `readme` let the export pass the filtered index and the README text of D7; `sourceHref(id)` replaces the `#src-<id>` that `footnoteCitations` gives a sources-block anchor with no `href` (the snippet, teach.mjs 345 to 371; the probes, item 1), so in the export that anchor points to `../sources.html#<id>`. serveFile's nav insertion (the second snippet, teach.mjs 386 to 391) becomes a small `withNav(html)` that the export also calls for the plugin's reading.html. quiz.js is written once, with every line-initial `export ` removed (F1). Rejected: a second renderer for exported pages (two copies of the page logic), and the script inlined in every page (the same transform, repeated in each file).

### D3. The navigation bar with no fetch (judgment)

`navHtml(index = null, id = null)` in teach.mjs builds, from `neighbours` and `pathPosition`, which quiz.js already exports (the snippet, quiz.js 27 to 47), the bar `renderNav` builds: the three links, then previous, `line N of M` and next. With no arguments it returns today's string byte for byte. The export calls it for each lesson at export time, so the bar is in the file and needs no script. `renderNav` stays as it is, plus one early return when `<body>` has `data-export`, so an export hosted on `127.0.0.1` never fetches `/lessons.json`. deps.mjs row 101, which couples the two builders (the snippet, deps.mjs 101 to 102), stays, its wording widened to the previous, position and next entries. Rejected: a shared `navLinks` function for both (it would move `renderNav`'s DOM code for no change in output), and `/lessons.json` embedded in each page (a bar built by script, and one more copy of the index per page).

### D4. Attempts with no server

The widget is in export mode when `<body>` has `data-export`. Its default submit is then `saveLocal`, which appends `{ "lesson", "answers", "at", "total", "wrong" }` to the array under `research-vault-attempts:<key>` in `localStorage` and returns `Saved in this browser.`; `at` is `new Date().toISOString()`, and `total` and `wrong` are what `grade` already returned in the widget (the snippet, quiz.js 132 to 144). Every `localStorage` read and write is in `try`/`catch`; when the write fails, it returns `Not saved in this browser.` and keeps the attempt in memory. After the score, the result line gets a button, `Export my results`, and `progress.html` shows the stored attempts (lesson linked, date, score) with the same button. The button downloads, through a Blob and an `<a download>`, the stored attempts plus those held in memory, as `results-<key>-<YYYYMMDD-HHMMSS>.json`:

```json
{
  "format": "research-vault-attempts",
  "version": 1,
  "workspace": "<key>",
  "attempts": [
    { "lesson": "0001-good", "answers": [1, 0, 1], "at": "2026-11-11T20:57:00.690Z", "total": 3, "wrong": [0, 1, 2] }
  ]
}
```

A pure `resultsFile(key, attempts)` in quiz.js builds that text, so a test can make the file the button makes. The button is on both pages so that a browser which keeps storage per file would still let the learner export each lesson's attempts from that lesson; whether Safari or Firefox do so is not established (F2). The served widget is unchanged: with no `data-export`, `postAttempt` and its reply stay as they are. Rejected: one downloaded file per attempt with no store (a file per quiz to send), and posting anywhere (there is no server).

`teach attempt import <file> [workspace]` accepts that file and nothing else. Learner-supplied strings are printed only through `JSON.stringify`.

- Exit 2: no file argument, no workspace, a file that cannot be read, or one over 1 MiB.
- Exit 1 with nothing written, one `attempt <n>: <reason>` line per problem (structural errors are all-or-nothing): not JSON; top-level keys other than exactly `format`, `version`, `workspace`, `attempts`; another `format` or `version`; a `workspace` other than this workspace's `<key>`; `attempts` not a non-empty array; an attempt whose keys are not exactly the five above; a `lesson` that fails `LESSON_ID_RE` or names no `lessons/<id>.html`; `answers` not an array of non-negative integers; an `at` not in `toISOString` form or later than the import's own clock.
- Each attempt is regraded by `gradeAttempt`'s rule (the snippet, teach.mjs 126 to 139). When its answers no longer fit the lesson (another item count, an index out of range), or the import's `total` and `wrong` differ from the file's, the lesson changed since the attempt: it prints `changed <lesson>: browser s/t, now s'/t'` (`now -/t'` when the answers no longer fit), skips that attempt, writes the rest and exits 1.
- An attempt whose id without a collision suffix already exists in `attempts/` is skipped with `skipped <id>: already recorded`, so a second import of the same file writes nothing.
- The rest go through `writeAttempt` with `now = new Date(at)`, each printing `recorded <id>: <score>/<total>`, the line `teach attempt add` prints (the snippet, commands/teach.mjs 227 to 233). Exit 0 when nothing was refused or changed.

An imported attempt goes through the same `writeAttempt` call as a served one, with the browser's `at` as `now` (F3, where one probe gave byte-identical files); its date and id come from the learner's browser clock, not the server's. A project lesson's `--result` run and learning records stay with `teach attempt add` and `teach record add`; this spec reads the issue's "lets the author add records" as that, not as a new flag.

### D5. The sources page (judgment)

`sources.html` has the nav, `<h1>Sources</h1>` and one `<li id="<id>">` per vault id that `extractCites` finds in any exported page, in id order: the entry's `title`, linked to its `source_url` only when that is `http:` or `https:`, the date its id begins with and the `summary`, all escaped. The export prints one `source <id> <url>` line per entry (`-` for no URL), so the author sees what leaves with the copy. A cited id with no vault entry refuses the export with `unknown-source <path>: <id>`. The export needs the vault, so with none it exits 2. Rejected: copying the entries' bodies (more of the vault would leave the machine than the issue asks for).

### D6. Gating (judgment)

The issue's acceptance line is a refusal "unless a flag explicitly allows skipping those pages", and this spec takes it as written. The export gates exactly what `gatedFiles` covers for the workspace: `lessons/*.html`, `reference/*.html` and `README.md` (F5). The README is beyond the issue's "any lesson or reference doc", a judgment: it is a gated page the index shows. Any other HTML under the three directories, such as a page under `lessons/files/`, is left out and printed as `not gated <path>`, so no ungated page reaches the learner; the plugin's reading.html is the one exception. For each gated page the export asks `hasVerdict(file, vaultPath)`, readmeLine's test (`ledgerRoot`, then `gateStatus(...).verdict`, F5) moved into one helper that `teach next` also calls. When any lacks a verdict it prints `ungated <workspace-relative path>` for each and `teach export: <n> page(s) have no PASS or MERIT for their current content; nothing written (--skip-ungated leaves them out)`, and exits 1. With `--skip-ungated` those pages are not exported, are left out of the index and every nav bar, and each is printed as `skipped <path>`; a skipped README leaves the index with no README section. Rejected: a warning only (the acceptance line asks for the refusal).

### D7. No page sends the learner to the terminal (judgment)

`EXPORT_TEXT` in teach.mjs holds two exact replacements, applied to every exported page: `FOLLOWUP`, now exported from lesson.mjs and imported, becomes `You can ask your instructor follow-up questions.`; `CONNECT_LEAD`, a new export of lesson.mjs, `Type your answer to Claude Code in the terminal, in a few sentences:`, becomes `Write your answer down, or send it to your instructor, in a few sentences:`. LESSON-FORMAT.md names `CONNECT_LEAD` as the connect block's opening sentence, and `teach lint` gains the advisory `WARN_CONNECT_LEAD` for a connect block that does not start with it; no finding changes. The table does not cover the other measured phrasings (F4): the Claude Code chat or window lead, the "lesson's guide" lead, "Answer in the Claude Code terminal", a followup that adds where the terminal is, and step, mission, scaffold or prereq text that names Claude Code. On the index, the body of the README's `## How to take it` section is replaced by `Open the lessons below in order. Your quiz answers are kept in this browser; use Export my results on the Progress page and send the file to your instructor.` The plugin's reading.html is reworded in the same change so that its lines 54, 62 and 74 name no place to answer or ask.

Then the check: on every exported HTML page but `sources.html`, and on `GLOSSARY.md` as plain text, the rendered text (tags removed, quiz JSON kept, `<pre>` and `<code>` removed) is matched against `\bin (the|your) terminal\b|\bteach serve\b|\bClaude Code\b`, any case; a match refuses the export with `mention <path>: <the sentence>`. The rule names phrases that send the learner somewhere, so "terminal" on its own passes, as on three measured pages (F4). `sources.html` is exempt: a cited source's title stays as the source wrote it, since a scrubbed title would misname the citation, and this spec reads the acceptance line as about where the learner is sent. quiz.js keeps its terminal string; export mode never shows it. Rejected: rewriting other prose, and an override flag (the acceptance line has none).

### D8. Browsers for the acceptance line (judgment)

`npm test` launches no browser; the tests of the file set, the script tag and the classic compile stand in for it. The build's closing report checks an exported workspace by hand in Google Chrome and in Safari, whose versions the probes read on this machine: open `index.html` from Finder, follow the nav to two lessons and back, answer one quiz, export the results, import them with `teach attempt import`, and watch the developer tools' network panel for any request. Chrome is also run headless with `--dump-dom`, as in the probes. No Firefox is in `/Applications` here (the probes) and nothing is installed in this run, so Firefox is reported as not opened (open question 2).

### D9. What else changes, and what keeps the export and `teach serve` in step (judgment)

- `SECURITY.md`: a section for `teach export` (it reads only what `teach serve` serves, the plugin's two assets, the manifest fields of D5 and the ledger; writes only under `--out`; opens no listener and makes no network request; `sources.html` carries the titles, URLs, dates and summaries of cited entries) and one for `teach attempt import` (a learner-supplied file, validated as D4 says, written only through `writeAttempt`).
- `docs/REFERENCE.md`: the two verbs in the `teach` row, with their exit codes and output lines, and `WARN_CONNECT_LEAD`.
- The research-teach skill: section 5 names the exported copy as the route for a learner with no command line and `attempt import` as how its results come back; section 1's `attempts/` row adds `teach attempt import`. `LESSON-FORMAT.md` names the connect lead and says what the export does to `connect` and `followup`; `README-FORMAT.md` says what it does to How to take it.
- `scripts/deps.mjs` COUPLINGS rows: quiz.js `resultsFile` and teach.mjs's import (format, version, workspace and the five attempt keys); teach.mjs `exportPage` and quiz.js (the `data-export` attribute and the storage key); README-FORMAT.md's How to take it and the export's replacement; row 101's wording. `FOLLOWUP`, `CONNECT_LEAD` and the verdict test are shared by the export (and `teach next`) through a JS import, not by a couplings row.
- Drift guards, as tests: the expected file set is computed in the test from `lessonIndex` and `serveFile`, so a page `teach serve` gains is expected in the export; `navHtml()` equals today's string; every exported quiz tag is the deferred classic one and `assets/quiz.js` compiles under `vm.Script`.

## Risks

- **42 of the 123 measured lessons would be refused** until reworded and re-gated, as measured on the lesson files' `data-block` sections: all 26 of kubernetes-basics and 16 of vmetal (F4). That workspace's authors carry the cost of the narrow table.
- **Vault metadata leaves with the copy.** The sources page carries each cited entry's title, URL, date and summary to anyone the export is sent to, internal sources included: the `source` lines (D5) print every cited entry's URL, and an `http:` or `https:` URL of a private repository is linked on the page if a lesson cites it. The `source` lines (D5) show it before the copy is sent.
- **The browser clock dates an imported attempt**, not the author's machine (D4).
- **Exported text differs from the gated bytes** in D7's fixed strings and the README's replaced section. The two fixed strings are not cited claims, which is this spec's reason to allow it; a citation in a README's How to take it section would be dropped from the export.
- **The results file is the learner's.** Import checks its shape and regrades it, but cannot tell answers a learner chose on the page from answers typed into the file.
- **Two workspaces with the same folder name share a storage key** in a browser that gives every `file://` page one origin; the `workspace` field cannot tell their files apart either.
- **Storage can vanish.** A learner who clears site data before pressing the button can lose those attempts (not verified by a run).
- **Skipped pages leave dead links** in other pages' prose under `--skip-ungated`; the nav and the index are filtered, prose is not.

## Not established

How Safari 27.0.1 and any Firefox handle the deferred classic script, `localStorage` across pages and the download from `file://`, and whether Firefox shows `GLOSSARY.md` from `file://` or downloads it (the probes, "Not run in round 1"); the Blob download in any browser, Chrome included (no download was run); headed Chrome.

## Open questions

1. A lesson whose `step` asks for a command, or names an `evidence/` script the export leaves out, is exported as written under this spec. Keep that (this spec's default), or leave such lessons out?
2. Firefox, for the user: install it for the acceptance check, or accept "opens in Chrome, Firefox and Safari" as partly met with Firefox not opened.
3. Should the README format gain an optional section the author writes for exported copies, in place of D7's fixed text?

## First slice

Commit 1 below: export mode in quiz.js and `teach attempt import`, with the round-trip test. It changes nothing a served learner sees and fixes the file format before any page is exported.

## Tests

On workspaces built in the test (`MISSION.md`, `PATH.md`, two lessons with quizzes, a reference page, a `README.md`, `GLOSSARY.md`, the plugin's assets, plus `attempts/`, `evidence/` and `learning-records/` that must be left out), with a temp vault holding the cited entries and a temp repo binding whose ledger has PASS rows recorded by the gate. No file is added under `test/fixtures/teach/`.

1. **Opens from `file://` with working navigation and quizzes and no network requests.** The exported file set equals the expected list; no exported page contains `type="module"`; each lesson's quiz tag is `<script defer src="../assets/quiz.js"></script>` and its `<body>` has `data-lesson`; `assets/quiz.js` compiles under `vm.Script`; every relative `href` and `src` resolves to an exported file; no `script`, `link`, `img`, `iframe`, `source`, `video` or `audio` tag has a `src` or `href` with a scheme or starting `//`, and no exported CSS has a `url(` or `@import` with one; each lesson carries a nav with the links its `line N of M` position calls for.
2. **A quiz answered offline round-trips through `teach attempt import`.** `resultsFile` builds a file; `teach attempt import` writes an attempt byte-identical to the one `createServer`, clock fixed at `at`, writes for `POST /attempt` with the same answers; a second import prints `skipped`; an answer out of range for the current lesson prints `changed` and the other attempts are written; a non-integer answer exits 1 and writes nothing; another `workspace` exits 1 and writes nothing; a changed quiz prints `changed`, writes the other attempt and exits 1. The widget, run in test/quiz.test.mjs's fake DOM (the second snippet, quiz.test.mjs 99 to 102, 113 to 117) with `data-export` and a stub `localStorage`, stores the attempt, and with a `localStorage` that throws still exports it.
3. **No exported page sends the learner to the terminal, `teach serve` or Claude Code.** No exported page but `sources.html` matches the D7 rule; a connect block opening with `CONNECT_LEAD` exports with the instructor sentence; a lesson saying "the error is terminal" exports; a lesson whose `step` says "in the terminal" makes the export exit 1 with a `mention` line and no `--out`.
4. **Every cited vault entry is on the sources page.** Each id `extractCites` finds in the exported pages has an `<li id>` on `sources.html` with its title and a `source` line on stdout; a cited id missing from the vault exits 1 with `unknown-source`.
5. **Refusal without a verdict.** One lesson with no ledger row: exit 1, its `ungated` line, no `--out`; with `--skip-ungated` before the workspace path: exit 0, its `skipped` line, the page absent from the output, the index and every nav bar. An HTML file under `lessons/files/` is left out with its `not gated` line.
6. **`teach serve` unchanged.** `navHtml()` equals the e80b914 string, and the existing serve tests pass untouched.

## Order of commits

Each commit adds its own line under `## [Unreleased]` in `CHANGELOG.md`.

1. Export mode in quiz.js (`saveLocal`, the button, `resultsFile`, the local progress table, `renderNav`'s `data-export` return); `teach attempt import`; test 2, with the export list that test/quiz.test.mjs line 63 pins (the second snippet, quiz.test.mjs 48 to 66) gaining `resultsFile`. Gated docs staged: `docs/REFERENCE.md` (the import verb) and `skills/research-teach/SKILL.md` (section 1's `attempts/` row), with `SECURITY.md`'s import section and the COUPLINGS rows on the file format.
2. `teach export`: `skip-ungated` in `BOOL`, `exportPage`, `navHtml(index, id)`, `withNav`, the `indexHtml` and `serveFile` options, `localProgressHtml`, `sources.html`, `hasVerdict` (with `teach next` moved onto it), `FOLLOWUP` and `CONNECT_LEAD` exported, `EXPORT_TEXT`, `WARN_CONNECT_LEAD`, the reworded reading.html; tests 1, 3, 4, 5 and 6. Gated docs staged: `docs/REFERENCE.md` (the export verb and the warning), `skills/research-teach/SKILL.md` (section 5), `skills/research-teach/LESSON-FORMAT.md` and `skills/research-teach/README-FORMAT.md`, with `SECURITY.md`'s export section and the remaining COUPLINGS rows.

## What the export leaves open for later issues

This spec designs nothing for issues 63, 64 and 65. Rules here that later work on them starts from: HTML under `lessons/files/` is left out (D6) and any other file under the three directories is copied (D1); a script loads from `file://` in Chrome 157 by the route of D2 only if it is a classic script; the export takes the workspace's `lesson.css` but the plugin's quiz.js and reading.html (D1).
