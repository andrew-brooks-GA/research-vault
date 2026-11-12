# Spec 50: brand packages, a workspace's colours, logo, footer and term rules on every page (#64)

At f7dfcf9 with no code changed. This spec designs upstream issue 64 (2026-11-11-research-vault-issue-64-research-teach): "A company or an individual drops a brand package into a folder and the module applies it wherever appropriate". The code lines it rests on are quoted in 2026-11-12-lines-behind-spec-50-brand-packages ("the snippet"), and the runs are in 2026-11-12-spec-50-brand-prototype-runs ("the runs", parts A to F). Everything under Decisions, Not in this spec, Tests and Order of commits is this spec's judgment unless it cites an entry. This spec chooses to stay small: it designs a version that meets seven of the issue's eight acceptance lines and names what it leaves out.

## What exists, in one paragraph

lesson.css declares its colours as custom properties in a `:root` block, repeats the dark values under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`, and names Inter for the body and the citation markers and Roboto Mono for code (the snippet, lesson.css 4 to 31, 41, 116 to 118). The figure's svg takes `color: var(--ink)`, the progress table takes `--rule` and `--muted`, and the quiz options and their marks take `--card`, `--rule`, `--ok-bg`, `--ok`, `--bad-bg` and `--bad` (lesson.css 60 to 62, 99 to 100, 130 to 134). `indexHtml`, `progressHtml`, `localProgressHtml` and `sourcesHtml` each write a `</head>` after the stylesheet link, and `serveFile` passes a lesson or reference page through `footnoteCitations` and every HTML file through `withNav` (teach.mjs 397 to 399, 476 to 499, 609 to 621, 665 to 668, 685 to 687). `withNav` puts `navHtml()` right after `<body>` on a page that does not load quiz.js, and on a served lesson quiz.js's `renderNav` prepends the bar to `<body>` (teach.mjs 387 to 388; quiz.js 131 to 133, 151). `teach serve` serves files only under `STATIC_DIRS = ['lessons', 'reference', 'assets']` plus `GLOSSARY.md`, and `teach export` walks the same three directories (teach.mjs 409, 748 to 751). `exportPage` rewrites every root-absolute `href` and `src` to a relative path (teach.mjs 655 to 660). The export's phrase check runs over every exported HTML file except sources.html, and GLOSSARY.md, after `exportPage` has built them (teach.mjs 770 to 786).

## Findings from research

**F1. A brand folder changes no served page today.** With HEAD's server, a fixture workspace returned the same bytes on `/`, `/progress`, a lesson, a reference page and `/assets/reading.html` with and without a `brand/` folder, and `/brand/brand.json` and `/brand/logo.svg` were 404; each of those HTML replies held `</head>`, `<body` and `</body>`, and only the lesson lacked the nav bar right after `<body>` (the runs, part A).

**F2. One style element and two inserted elements carried a brand to each page probed, served and from `file://`.** A prototype layer over HEAD's server added, to each HTML reply, a `<style>` before `</head>` that sets custom properties in the three selector blocks lesson.css uses, a header after the nav bar (or after `<body>`), and a footer before `</body>`. In headless Chrome 157 on `/`, `/progress`, a lesson and reading.html, the link colour took the brand's light and dark values, the background its dark `--bg` (lesson.css's in light, which the brand does not set); a token the brand set for light only (`--c-quiz`) kept lesson.css's dark value in dark; the figure followed `--ink`; ten quiz options rendered; the light or the dark logo showed, never both; with `data-theme="dark"` set under a light preference, the dark values applied; the nav bar preceded the header on every page; and a name holding `<A&B>` was in the HTML escaped (the runs, part B). Pages built as the export would build them, the branded page passed through HEAD's `exportPage`, had a relative logo `src` and gave the same computed values from `file://` (part C).

**F3. Contrast.** WCAG 2.2's text, fetched with curl and printed in the experiment's run (not a captured source), gives success criterion 1.4.3, Level AA, as a contrast ratio of at least 4.5:1 for text and 3:1 for large-scale text, the ratio being (L1 + 0.05) / (L2 + 0.05) over the relative luminance it defines (the runs, part E). At lesson.css's own values, the eleven pairs D7 checks are each at 5.06 or above in light and in dark; `--ok` on `--ok-bg` in light is 4.30 (part D).

**F4. The real workspaces.** The four under `~/vcluster-support-lab/docs/teach/` hold 123 pages, all with `</head>`, `<body` and `</body>`; none has a colour literal in a `style` attribute or a `<style>` element, none has a `brand/` folder, and `teach lint` reports no `WARN_FIGURE_COLOR` in any (the runs, part F). lesson.css's first `:root` block declares 23 custom properties (part D).

## Decisions

### D1. A brand is `<workspace>/brand/`, and with none nothing changes

A brand is the folder `brand/` in the workspace: `brand.json` and the files it names, each named file a relative path under `brand/` whose segments match `[A-Za-z0-9._-]+`, none starting with `.`. Every key is optional; an unknown key is an error.

| Key | Value |
|---|---|
| `name` | string: the header's text |
| `logo` | `{ "light": file, "dark": file (optional), "alt": string }` |
| `favicon` | file |
| `color` | `{ "light": { token: colour }, "dark": { token: colour } }`, each optional |
| `font` | `{ "body": family, "code": family }`, each optional |
| `footer` | `{ "classification": string or { audience: string }, "copyright": string }`; `{year}` in the copyright becomes the year |
| `audience` | string: the key of `footer.classification` to show |
| `tokens` | file: a design-tokens JSON file (D6) |
| `voice` | `{ "avoid": [ { "term": string, "use": string (optional) } ] }` |

A colour is `#rgb` or `#rrggbb`, or a `{dotted.path}` reference (D6). A family is comma-separated names of letters, digits, spaces and hyphens, written into the rule as given; it may not hold a quote. This spec chooses these few forms so that no brand value holds `{`, `}`, `;` or a quote, and every colour has a computable contrast. With no `brand/` folder, `withBrand(html, null)` returns its input, so every page and exported file keeps its bytes (the first acceptance line). Rejected: a brand shipped in the plugin repo (the issue asks that the module know no company), and a user-level or vault-level default (Not in this spec).

### D2. Tokens and schemes

A brand may set exactly the custom properties of lesson.css's first `:root` block, 23 today (F4). `bin/lib/brand.mjs` reads that list from the plugin's lesson.css at load, so a property added there is settable with no second list. `color.light` becomes a `:root` rule; `color.dark` becomes the same two dark rules lesson.css writes, under the media query and under `data-theme="dark"`. A token the brand does not set keeps lesson.css's value for that scheme (F2). `font.body` sets `font-family` on `body` and on lesson.css's own selectors for the citation markers, `a.cite, a[data-cite]:not(.cite):not([href])`, since those name Inter themselves and line 118's selector outranks a bare `a[data-cite]` (the snippet, lesson.css 116 to 118); the marker's computed font was not probed. `font.code` sets it on `code, pre`. How a family the reader's machine lacks falls back was not checked. The figure, the quiz widget and the progress table draw only from these tokens (the snippet, lesson.css 60 to 62, 99 to 100, 130 to 134), so the cascade should carry a brand value to them with no change; this was probed only for `--link`, `--bg` and `--c-quiz` (F2). Rejected: a role vocabulary (primary, hover, pressed) mapped onto the tokens, a second set of names for the same 23; a generated `brand.css` at a new route, which needs a route, a link tag and a file in the export where one inline element needed none (F2); editing `assets/lesson.css`, the issue's own complaint.

### D3. Slots: a header and a footer

`withBrand(html, brand, { position, year })` in brand.mjs makes three insertions, all brand text through `escapeHtml`:

1. before the first `</head>`: `<link rel="icon" href="/brand/<favicon>">` when set, then one `<style>` holding D2's rules and the slot rules (header and footer span the grid; one logo hidden per scheme, by the same three selectors);
2. `<header class="brand-header">`, when `name` or `logo` is set: a link to `/` around `<img class="brand-logo-light">` and, when set, `<img class="brand-logo-dark">`, each with the escaped `alt`, then the name. It goes after the `<nav class="lesson-nav">` element when the page holds one, else right after `<body>`; on a served lesson quiz.js prepends the bar later, so the bar comes first on every page probed (F2);
3. before the last `</body>`: `<footer class="brand-footer">` when a classification or a copyright is set, with one `<span>` each for the classification D5 selects, the copyright with `{year}` replaced, and on a lesson `lesson N of M`, N its place in `lessonIndex`'s lessons and M their count.

A logo's `src` is `/brand/` plus its segments through `encodeURIComponent`. This spec uses two `img` elements, not `<picture>`, because `exportPage` rewrites `href` and `src` and no `srcset` (the snippet, teach.mjs 656). Rejected: a slot for HTML written in the brand, which would put brand markup unescaped in every page.

### D4. Where the brand is applied

`readBrand(ws)` returns `{ brand, problems }` and is called on each request, so an edited brand shows on reload. `createServer` passes its three HTML replies (`/`, `/progress`, and a `serveFile` reply of type `text/html`) through `withBrand`, with the year of the server's clock and, for `/lessons/<id>.html`, the position. `exportPage` calls it before its own steps, so every exported page (lessons, reference pages, index, progress, sources and reading.html, teach.mjs 771 to 784) is branded and its logo `src` made relative (F2). `brand` joins `STATIC_DIRS`, so `/brand/<file>` is served and the export copies `brand/` whole. With any problem in `brand.json`, pages are served unbranded, `teach serve` prints `brand: brand/brand.json is invalid; run teach lint` once at start, and `teach export` refuses with `brand brand/brand.json: invalid; run teach lint` and writes nothing.

### D5. Audience

`audience` names the key of `footer.classification` to show; switching audience is editing that one field. An `audience` that is not a key of the object is a `BRAND_INVALID` problem. Only the classification varies. Rejected: an `--audience` flag on `teach serve` and `teach export`, two flags and their plumbing for an edit the author can make (Open question 3).

### D6. Design-tokens files

`tokens` names a JSON file under `brand/` in the W3C Design Tokens Community Group form the issue names. This spec assumes the form (Not established): a colour or family written as `{a.b.c}` is looked up by that dotted path in the file and the token's `$value` taken; a `$value` that is itself `{...}` is an alias, followed at most eight times. A colour must end as a hex string D1 accepts, or an object whose `hex` is one; a family as a string or an array of strings, joined with `, `. The result is the value D2 would write by hand, so the CSS is the same. Rejected: mapping a whole tokens file onto lesson.css's names by a naming convention, which needs a convention the author's tools may not follow; an explicit reference is one lookup.

### D7. Lint

`lintWorkspace` reads the brand once and adds these errors, each naming what is wrong:

- `BRAND_INVALID brand/brand.json`: not JSON, an unknown key, a wrong type, a bad path, colour or family, an unknown audience, an unresolved or too-deep reference.
- `BRAND_TOKEN_UNKNOWN`: a `color` key that is not one of D2's tokens, by name.
- `BRAND_FILE_MISSING`: a named file that is not a regular file, by key and path.
- `BRAND_ALT_MISSING`: a `logo` with no non-empty `alt`.
- `BRAND_CONTRAST`: in light and in dark, using the brand's value or else lesson.css's, a pair below 4.5:1 (F3), with the scheme, the two tokens, their values and the ratio. This spec chooses eleven pairs: `--ink` on `--bg`, `--card`, `--chip`, `--ok-bg`, `--bad-bg` and `--mark`; `--muted` on `--bg` and `--card`; `--link` on `--bg` and `--card`; `--code-ink` on `--code-bg`. On the quiz marks, `--ok` is a border on `--ok-bg` (the snippet, lesson.css 133), not text, so its 4.30 (F3) is not checked. Judgment: a token colours text of every size, so every pair takes 4.5:1, not the 3:1 for large-scale text.
- `BRAND_OFF_PALETTE`: with a brand, each colour `WARN_FIGURE_COLOR` would report (the snippet, lesson.mjs 366 to 367) is reported under this code as an error instead, and each `#hex`, `rgb(` or `hsl(` colour in a `style` attribute or `<style>` element of a lesson or reference page is reported with the colour. A literal equal to a token's value is still reported, since it would not follow the dark scheme. None of the 123 real pages has either (F4).
- `BRAND_VOICE`: each `voice.avoid` term found in a lesson's prose, with its `use` when set. Prose is `proseOf`'s text (the snippet, lesson.mjs 236 to 245) with `<code>` elements also removed, as it already removes `<pre>` and scripts; the match is case-sensitive and whole-word, `termRe`'s boundaries without its `i` flag (lesson.mjs 247), so each wrong capitalisation is its own entry (`Vcluster`, with `use` `vCluster`).

Without a brand none of these runs and every existing finding is unchanged. Rejected: a JSON Schema file and a validator for it (this repo's AGENTS.md allows no dependencies; the checks above are one short function in brand.mjs); a line number in `BRAND_VOICE`, since `proseOf` joins the blocks (Not in this spec).

### D8. The export

The brand reaches the copy through D4: the files by the walk, the slots by `exportPage`. Nothing is fetched: the manifest takes only paths under `brand/`, and the CSS brand.mjs writes holds no `url(`. Since the phrase check reads the exported files after `exportPage` (the snippet, teach.mjs 770 to 786), brand text in the header and footer is checked like lesson text, and a classification such as "Ask in the terminal" yields a `mention` line.

### D9. Docs and `scripts/deps.mjs`

A new `skills/research-teach/BRAND-FORMAT.md`: D1's table, D2's rule for the token list, D3's slots, D5, D6 and D7's codes, and one minimal example (a logo and two colours). `docs/REFERENCE.md`: the `BRAND_*` codes in the `teach lint` row, and D4's lines for `teach serve` and `teach export`. The research-teach skill: a `brand/` row in section 1's table and one sentence in section 4 that a brand goes in `brand/`, never in `assets/lesson.css`. COUPLINGS rows: brand.mjs and lesson.css (the token list is read from the first `:root` block, and the dark selectors are copied); brand.mjs and BRAND-FORMAT.md (the keys and the slots); lesson.mjs and BRAND-FORMAT.md (D7's codes).

## Not in this spec

The user can ask for each later; none blocks the rest.

- **Section divider pages** (acceptance line 5, not met). Pages between path groups need a page per group in the served routes, the previous and next links in both `renderNav` and `navHtml`, and the export's file set. The smallest useful version is the divider image above each `Project:` heading on the index.
- **Layering**: a user-level or vault-level default brand under the workspace's. Copying `brand/` into each workspace is the convention meanwhile.
- **Font files and allowed URLs**: `@font-face` from files under `brand/`. Families are names only.
- **`strings`**: overrides for fixed text such as the block labels and the nav's links.
- **`tables`** (a coloured header row, alternating rows) and semantic good and bad roles beyond `--ok` and `--bad`.
- **Per-audience strings** other than the classification, and an `--audience` flag.
- **Voice**: line numbers, punctuation rules such as no em dashes, and README or reference prose.
- **Off-palette colours** in CSS files under `assets/` or `lessons/files/`.

## Risks

- **Two positions on a lesson.** The footer's `lesson N of M` counts built lessons, while the nav's `line N of M` counts the path's lines (the snippet, quiz.js 44 to 47), so the two can differ on one page.
- **`brand/` is served and exported whole**: any file put there whose path has no segment starting with `.` leaves with an exported copy.
- **A page with no `</head>`** gets no tokens. None of the 123 real pages lacks one (F4).
- **Brand text is not claims-gated.** A classification or copyright is the author's statement, not a cited claim; the export's phrase check still reads it (D8).
- **The brand is read per request**, one more file read per HTML reply; a brand made invalid while the server runs serves pages unbranded with no further message.

## Not established

Safari, Firefox, a headed browser and print were not run (the runs). No design tool's export was read, so whether D6's `$value` forms match real files is not established. How a brand family falls back on another machine was not checked.

## Open questions

1. Section dividers: leave out (this spec's default), or build the index-only version?
2. A user-level or vault-level default brand: wanted?
3. An `--audience` flag on `teach serve` and `teach export`, for an internal and a customer copy from one tree without an edit?
4. Should `BRAND_VOICE` also read README.md and reference pages?

## Tests

On workspaces built in the test (a copy of the fixture lessons with the plugin's assets, as the runs' build.mjs makes), each with a `brand/` the test writes; no file is added under `test/fixtures/teach/`. One test per acceptance line:

1. **No brand folder renders exactly as today.** The test holds the sha256 of each reply (`/`, `/progress`, `/lessons.json`, each lesson, the reference page, reading.html) and of each file `exportWorkspace` returns, for the workspace it builds, computed by the same builder at the parent commit; with no `brand/`, every hash matches.
2. **A logo and two colours change the pages.** With `brand.json` holding a logo and two light colours, `/`, `/progress`, a lesson and the export's index, progress page and lessons each hold the `<style>` with both values and the header's `img`; the bytes under `lessons/` and `assets/` are the same before and after serving and exporting.
3. **Light and dark use the brand's tokens.** The `<style>` holds the light values under `:root` and the dark values under both dark selectors; a token set for light only is in no dark rule; a static check finds that lesson.css's quiz, progress-table and figure rules name colours only through `var(--`.
4. **Footer and audience.** With a classification and a copyright set, every HTML reply ends its body with the footer holding both, the year from the server's clock; each lesson's footer holds `lesson N of M`; changing `audience` changes the classification span and nothing else.
5. **Section dividers**: not met; no test (Not in this spec).
6. **A design-tokens file gives the same result.** A brand whose colours and families are references into `tokens.json`, one through an alias chain of two, gives replies byte-identical to the brand that writes the values by hand; a reference cycle is `BRAND_INVALID`.
7. **Lint fails and names the token, colour or term.** One workspace each: a missing logo file (`BRAND_FILE_MISSING`, the path), an unknown key (`BRAND_INVALID`), an unknown token (`BRAND_TOKEN_UNKNOWN`, its name), `--ink` set to `--bg`'s value (`BRAND_CONTRAST`, both tokens), a figure with `fill="#ff0000"` (`BRAND_OFF_PALETTE`, `#ff0000`), an avoided term in a fact block (`BRAND_VOICE`, the term); each exits 1. The same term inside `<code>` or `<pre>` is not reported, and without `brand/` the figure gives `WARN_FIGURE_COLOR` as before.
8. **No brand-specific values; two unrelated brands.** Two brands with different palettes, fonts and term rules each serve, export and lint with the same code; neither brand's name, colours or terms occur in any file under `bin/` or `skills/research-teach/assets/`.

Also: the export of a branded workspace holds `brand/`'s files and a relative logo `src`, a classification naming the terminal yields a `mention` line (D8), and an invalid `brand.json` refuses it with D4's line.

## Order of commits

Each commit adds its line under `## [Unreleased]` in `CHANGELOG.md`, keeps `npm test` green and passes test 1.

1. **The brand on pages.** `bin/lib/brand.mjs` (`readBrand` with D1's checks and D6's lookup, the token list, `withBrand`); `brand` in `STATIC_DIRS`; the `createServer` and `exportPage` calls; D4's serve line and export refusal. Tests 1, 2, 3, 4, 6, the serve and export part of 8, and the export tests. Gated docs staged: `skills/research-teach/BRAND-FORMAT.md` (all but its lint section), `docs/REFERENCE.md` (serve and export) and `skills/research-teach/SKILL.md`; the first two COUPLINGS rows.
2. **Brand lint.** D7's codes in lesson.mjs (`lintWorkspace`, the `WARN_FIGURE_COLOR` switch, the style-colour scan, `BRAND_VOICE`). Test 7 and the lint part of 8. Gated docs staged: `skills/research-teach/BRAND-FORMAT.md` (its lint section) and `docs/REFERENCE.md` (the `teach lint` row); the third COUPLINGS row.
