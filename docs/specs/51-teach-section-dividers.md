# Spec 51: section divider pages, one page per path group between the lessons (#64, acceptance line 5)

At 07f3974 with no code changed. This spec designs one acceptance line of upstream issue 64 (2026-11-11-research-vault-issue-64-research-teach): "Section divider pages appear between path groups when the manifest names a divider graphic". The issue's slot list asks for "generated section divider pages between path groups (each `Project:` group), with the index as the linked table of contents". The code lines this spec rests on are quoted in 2026-11-12-lines-behind-spec-51-section-dividers ("the snippet"), and the runs are in 2026-11-12-spec-51-divider-prototype-runs ("the runs", parts A to E). Everything under Decisions, Not in this spec, Tests and Order of commits is this spec's judgment unless it cites an entry. Its premise, which no entry records: spec 50 left this line out, and the user asked on 2026-11-12 for a page per group.

## What exists, in one paragraph

`lessonIndex` gives each lesson, in id order, the `project` that closes its group: the title of the first PATH.md line at or after its own whose title starts `Project:`, or null (the snippet, teach.mjs 521; lesson.mjs 730). `indexHtml` cuts the lessons into runs of consecutive lessons with the same `project` and writes an `<h2>` above each run whose project is not null (teach.mjs 614 to 619). Previous and next come from `neighbours` over `index.lessons` (quiz.js 38 to 41): on a served lesson quiz.js's `renderNav` fetches `/lessons.json` and calls it (quiz.js 136, 141), and on an exported lesson `exportPage` writes `navHtml(index, id)` into the page, which calls it too (teach.mjs 381, 653). `line N of M` comes from `pathPosition`, which finds the lesson by id in `index.lessons` and reads its `line` (quiz.js 44 to 47). The footer's `lesson N of M` comes from `lessonPosition`, the page's place in `index.lessons` (teach.mjs 666 to 669; brand.mjs 155). `/lessons.json` is `JSON.stringify(lessonIndex(ws))` (teach.mjs 959). `teach serve` serves files only under `STATIC_DIRS`, and `GLOSSARY.md` (teach.mjs 410, 483), and `teach export` walks the same directories (teach.mjs 759). Spec 50 test 1 pins the sha256 of `/lessons.json` and of the exported `assets/quiz.js` and `assets/lesson.css` (test/teach-brand.test.mjs 93, 114, 115), so with no brand neither plugin file may change. `readBrand` refuses a key not in its list (brand.mjs 22, 58 to 65).

## Findings from research

**F1. Today there is no divider and no brand can ask for one.** At HEAD `/dividers/1.html` is 404, and `teach lint` on a `brand.json` with a `dividers` key reports `BRAND_INVALID ... unknown key dividers` and exits 1 (the runs, part B).

**F2. Served, previous and next passed through a page per group with HEAD's quiz.js.** A prototype in front of HEAD's server answered three routes. `/lessons.json` had `lessons` replaced by the reading order, each group with a `Project:` line preceded by a divider entry of id, title and path. `/` had each heading linked, and `/dividers/<k>.html` was the divider page. Every other request went to HEAD's handler. In headless Chrome 157, HEAD's `renderNav` gave lesson 0001 the previous link `/dividers/1.html`, 0003 the next link `/dividers/2.html`, 0004 the previous link `/dividers/2.html`, and 0006 the next link 0007, a lesson on no PATH.md line. `line N of M` was unchanged and the footer counted the seven lessons only (`lesson 4 of 7` on 0004). The divider pages showed the server-written bar, the brand's header and footer (no `lesson N of M`), the image loaded with its alt, the escaped group title and the group's lessons. `/dividers/0.html`, `/dividers/01.html` and `/dividers/3.html` were 404 (the runs, part C).

**F3. From `file://` the same.** The divider pages were passed through HEAD's `exportPage`. Every `href` and `src` in `dividers/1.html` was relative (`../lessons/...`, `../brand/divider.svg`), and the index linked `dividers/1.html` and `dividers/2.html`. In Chrome from `file://` both images loaded, and previous and next matched the served ones with relative paths (the runs, part D).

**F4. The real workspaces.** kubernetes-basics has 26 lessons in 6 runs, 5 with a `Project:` line; vmetal has 92 lessons in 7 runs, all with one; istio-gateway-api and listenerset-wake have none. No project title closes two runs in any of the four (the runs, part E).

## Decisions

### D1. A path group is a run of the index

A group is a run as `indexHtml` makes it: consecutive lessons, in id order, with the same `project` (the snippet, teach.mjs 614 to 619). Each run whose `project` is not null gets one divider page; a run whose `project` is null gets none and its lessons keep their place in the reading order (F2, 0007). `indexHtml`'s loop moves into `lessonRuns(lessons)` in teach.mjs, which `indexHtml` and D4 both call, so the index and the dividers cannot disagree. Rejected: grouping by distinct project title, which would give a title that closes two runs one page whose lessons are not consecutive; none of the real workspaces has such a title (F4). Rejected: a divider for a run with no `Project:` line, which has no title to show.

### D2. The key, and what a divider page is

`brand.json` gains one key:

| Key | Value |
|---|---|
| `dividers` | `{ "image": file, "alt": string (optional) }` |

`image` is required, since the issue's line asks for divider pages "when the manifest names a divider graphic"; a `dividers` object without it, or with another key, is `BRAND_INVALID`. `alt` is optional to `readBrand` and its absence is a lint error (D6), as for `logo` (brand.mjs 82 to 86). One image serves every group. With no `brand/` folder, an invalid brand, or a brand without `dividers`, no divider page exists and every route keeps its bytes.

`dividerHtml(index, k, brand)` in teach.mjs returns divider k's page, or null when there is none:

- `<title>` and `<h1>`: the group's `project`, escaped;
- after `<body>`: `navHtml(index, 'divider-<k>')`, written by the server, since the page loads no quiz.js (F2);
- `<figure class="brand-divider">` holding `<img>` with `src` `brandUrl(image)` and the escaped `alt`, before the `<h1>`;
- a `<section>` whose `data-block` is `index` holding an `<ol class="lesson-index">` of the group's lessons, each `<li>` as the index writes it.

`withBrand` then adds the header after the bar and the footer before `</body>`, as on any page (brand.mjs 159 to 162). `brandCss` gains two rules, only when `dividers` is set: `.brand-divider { grid-column: 1 / -1; margin: 0; }` and `.brand-divider img { width: 100%; height: auto; }`, so the image spans both columns of lesson.css's wide layout (lesson.css 140 to 142). Rejected: per-group images keyed by project title, which an edit to PATH.md would break; the line asks for a graphic, and one meets it. Rejected: the two rules in lesson.css, which would change the exported `assets/lesson.css` that test 1 pins.

### D3. Address and file

Divider k is served at `/dividers/<k>.html` and exported as `dividers/<k>.html`, k from 1 in the order of D1's runs with a project. `createServer` matches `^/dividers/([1-9]\d*)\.html$` after `/progress.json` and before `serveFile`, and sends `dividerHtml` through its `branded` function (teach.mjs 954 to 957), which gives the page no `lesson N of M` since `lessonPosition` finds no lesson at that path (teach.mjs 666 to 669). A k with no page, a brand without dividers and a non-canonical number such as `01` fall through to `serveFile`, which returns 404 as today because `dividers` is not in `STATIC_DIRS` (F1, F2). No lesson can collide: lessons are under `lessons/`, and a workspace folder named `dividers/` is neither served nor walked, as today. `exportWorkspace` adds `dividers/<k>.html` as `exportPage(dividerHtml(index, k, brand), 'dividers/<k>.html', ctx)` with the export's index, so the page is branded and its links made relative like any other (teach.mjs 646 to 663; F3). Rejected: a file named from the slugified title, which two titles can share and a title edit renames.

### D4. Navigation

`withDividers(index, brand)` returns `index` itself when `brand?.dividers` is unset, else `{ ...index, pages }`, where `pages` is the reading order: for each run of D1, its divider entry `{ id: 'divider-<k>', title, path: '/dividers/<k>.html' }` when it has a project, then its lessons. `index.lessons` is untouched. Then:

- `navHtml` takes previous and next from `neighbours(index.pages ?? index.lessons ?? [], id)`; `pathPosition` still reads `index.lessons`. On an exported lesson `exportPage` gets the export's index with `pages` (teach.mjs 653), and the footer's `lessonPosition` still counts `index.lessons`, so `lesson N of M` counts lessons only, as it did served in F2.
- `GET /lessons.json` returns `JSON.stringify(lessonIndex(ws))` as today when there are no dividers; with dividers it returns the index with `lessons` replaced by `pages` and no `pages` key. A divider entry carries `id`, `title` and `path` only. quiz.js does not change: `renderNav` already takes `neighbours` over `index.lessons` (quiz.js 141), and `pathPosition` finds a lesson's `line` by id in the same array, where every lesson entry keeps it (F2).
- On a divider page there is no `line N of M`, since `pathPosition` finds no line for `divider-<k>`, and no `lesson N of M`.
- The order is the last lesson of a group, the next group's divider, that group's first lesson (F2, F3). The first divider has no previous link.

Rejected: a new `pages` key in `/lessons.json` that quiz.js reads, which changes quiz.js and so the exported `assets/quiz.js` bytes that test 1 pins (test/teach-brand.test.mjs 114). Rejected: divider entries in `index.lessons` inside the server, which would make `lessonPosition` count them.

### D5. The index

With dividers, each `<h2>` of `indexHtml` holds a link to its divider, `<h2><a href="/dividers/<k>.html">title</a></h2>`, k counted as in D3; the export makes it `dividers/<k>.html` (F3). This is the issue's "index as the linked table of contents". Without dividers the index keeps its bytes. `indexHtml` knows dividers are on from `index.pages`. The image is not shown on the index.

### D6. Gate, export and lint

A divider page is generated from PATH.md's `Project:` titles and the lessons' titles, the same text the index already shows under its headings with no verdict (teach.mjs 613, 619). It is not a file in the workspace, so no `WORKSPACE_GATES` glob matches it (gate.mjs 344) and `exportWorkspace` never asks for its verdict, which it asks only of the walked pages and `README.md` (teach.mjs 759 to 769). Judgment: it states no claim, so it needs no verdict. The export's other checks reach it: it is in `files` before the phrase check, so a `Project:` title that names the terminal gives a `mention dividers/<k>.html` line and the export refuses (teach.mjs 790 to 795). With `--skip-ungated`, `withDividers` runs over the filtered index (teach.mjs 773 to 774). A group whose lessons are all skipped has no run, so it gets no page, no index link and no bar entry. A group with some lessons kept lists only those.

`teach lint` reuses three codes. `readBrand` reports `BRAND_INVALID` for a `dividers` that is not an object, holds another key, has no `image`, has an `image` that breaks the path rule (brand.mjs 27) or an `alt` that is not a string. On a valid brand `lintBrand` reports `BRAND_FILE_MISSING` for `dividers.image` that is not a regular file, beside `logo.light`, `logo.dark` and `favicon` (lesson.mjs 958 to 960), and `BRAND_ALT_MISSING` for a `dividers` with no non-empty `alt`. No other check is added.

### D7. Docs and `scripts/deps.mjs`

`skills/research-teach/BRAND-FORMAT.md`: the `dividers` row in Keys; a Dividers section with D1's group, D2's page, D3's address, D4's order and the two positions, D5's links, and D6's export rules; and in Lint, `dividers.image` under `BRAND_FILE_MISSING` and `dividers` under `BRAND_ALT_MISSING`. `docs/REFERENCE.md`, the `teach` row: for `teach serve`, the divider pages at `/dividers/<k>.html` and `/lessons.json`'s reading order; for `teach export`, the `dividers/<k>.html` files. Judgment: the research-teach skill needs no change. COUPLINGS gains two rows on the divider address, literal `/dividers/`: teach.mjs with BRAND-FORMAT.md, and teach.mjs with docs/REFERENCE.md. The quiz.js and teach.mjs row's reason gains that a divider entry in `lessons` carries the `id` that `neighbours` reads and the `title` and `path` that `renderNav` and `navHtml` read (scripts/deps.mjs 102). The brand.mjs row with BRAND-FORMAT.md (deps.mjs 201) and the lesson.mjs row with BRAND-FORMAT.md name `dividers` in their reasons.

## Not in this spec

The user can ask for each later; none blocks the rest.

- **A graphic per group**, or appendix dividers.
- **The divider image on the index**, the index-only version.
- **A divider before a run with no `Project:` line.**
- **A lint finding** for `dividers` set in a workspace with no `Project:` line, where no divider page exists.
- **Dividers on the progress page**, in `teach readme`, or a `group k of D` label.

## Risks

- **`/lessons.json`'s `lessons` holds entries that are not lessons** when dividers are on. quiz.js's `renderNav` reads the reply (the snippet, quiz.js 136) and takes a divider entry as it takes a lesson (F2). A script of the author's that reads the reply would see entries with no `line`, `shape` or `project`.
- **Divider numbers move.** Adding a `Project:` line before a group, or `--skip-ungated` leaving out a whole group, renumbers the pages after it, so a saved `/dividers/2.html` can show another group, and an exported page's number can differ from the served one.
- **A title that closes two runs** gets two divider pages with that title. None of the real workspaces has one (F4).
- **The image's rendered width** read 669 px served and 1089 px from `file://` in Chrome's default window; this was not looked into. At 1200 by 900 both screenshots showed it across the content width (the runs, part D).
- **The image's size is not checked**; a large file loads on every divider page.

## Not established

Safari, Firefox, a headed browser and print were not run (the runs). The prototype's `dividers` value was a constant, not a `brand.json` key, since HEAD's `readBrand` refuses the key (F1), so D6's lint and D2's `readBrand` checks were not run. The prototype exported without the footer, because HEAD's `exportPage` counts `lesson N of M` over the index it is handed and that index held the dividers; D4's split of `pages` from `lessons` is what keeps the exported count right, and it was not run.

## Open questions

None blocks the build. The defaults under Not in this spec stand unless the user asks.

## Tests

In test/teach-brand.test.mjs, on the workspace `brandRepo` builds, with PATH.md given a second `Project:` line after line 3 and a seventh lesson on no PATH.md line, as the runs' build.mjs does, and a `brand/` holding `divider.svg`; no file is added under `test/fixtures/teach/`.

1. **Dividers off keeps every byte.** Spec 50 test 1 passes with no edit. A new pin covers a brand without `dividers`: `TWO_COLOURS` with `LOGO_FILES`. The implementer computes at 07f3974, with this file's own builder, the sha256 of each served reply (`/`, `/progress`, `/lessons.json`, each lesson, the reference page, reading.html) and of each exported file, and the test holds them; every hash matches, and `/dividers/1.html` is 404.
2. **Groups.** With dividers on, `/lessons.json`'s `lessons` is, by id, `divider-1`, 0001, 0002, 0003, `divider-2`, 0004, 0005, 0006, 0007; each divider entry has exactly `id`, `title` and `path`; `/dividers/3.html`, `/dividers/0.html` and `/dividers/01.html` are 404.
3. **Previous and next pass through a divider, served.** quiz.js's `neighbours` over the served `/lessons.json` gives 0003 the next `/dividers/2.html` and 0004 the previous `/dividers/2.html`. `pathPosition` gives 0003 `line 3 of 10`. The served `/dividers/2.html` holds the bar with previous 0003 and next 0004 and no `lesson-nav-line`; `/dividers/1.html` has no previous link.
4. **Previous and next pass through a divider, exported.** In the export, `lessons/0003-review-good.html`'s next is `../dividers/2.html`, `lessons/0004-tool-fxctl.html`'s previous is `../dividers/2.html`, and `dividers/2.html`'s previous and next are `../lessons/0003-review-good.html` and `../lessons/0004-tool-fxctl.html`.
5. **A divider page carries the brand.** With a footer copyright set, the served `/dividers/1.html` holds the brand's `<style>` with both divider rules, the header after the bar, and the footer with the copyright and without `lesson`. It holds the `<img>` with `src` `/brand/divider.svg` and the escaped `alt`, the escaped title in `<title>` and `<h1>`, and links to its three lessons. Each lesson's footer still reads `lesson N of 7`.
6. **The index links each group.** The served `/` holds two headings linking `/dividers/1.html` and `/dividers/2.html`; the exported `index.html` links `dividers/1.html` and `dividers/2.html`.
7. **The export holds the divider files with relative links.** The export holds `dividers/1.html`, `dividers/2.html` and `brand/divider.svg`; no `href` or `src` in a divider file starts with `/`. With the lessons of the second group left without a verdict and `--skip-ungated`, the export holds `dividers/1.html` only, the index one link, and 0003's next is `../lessons/0007-extra.html`.
8. **The phrase check reads a divider.** A `Project:` title holding `teach serve` makes the export exit 1, and its lines include one starting `mention dividers/1.html:`.
9. **Lint.** One workspace each, every case exit 1: `dividers` with no `image` (`BRAND_INVALID`), with an unknown key (`BRAND_INVALID`), naming a missing file (`BRAND_FILE_MISSING`, `dividers.image` and the path), with no `alt` (`BRAND_ALT_MISSING`). A valid `dividers` gives no `BRAND_` finding.

## Order of commits

One commit, with its line under `## [Unreleased]` in `CHANGELOG.md`, `npm test` green and spec 50 test 1 unedited. It holds:

- in teach.mjs, `lessonRuns`, `withDividers`, `dividerHtml`, the `navHtml` and `indexHtml` changes, the route, the `/lessons.json` reply and the files in `exportWorkspace`;
- in brand.mjs, the key in `readBrand` and the rules in `brandCss`;
- in lesson.mjs, the two checks in `lintBrand`;
- tests 1 to 9;
- D7's docs, claims-gated, and its COUPLINGS rows.
