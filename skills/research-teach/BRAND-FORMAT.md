# Brand Format

A brand puts an organisation's name, logo, colours, fonts and footer on every HTML page `teach serve` returns and every HTML page `teach export` writes. It lives in the workspace's `brand/` folder, never in `assets/lesson.css`. With no `brand/` folder the pages keep their bytes (checked on a test workspace, served and exported).

## Files

`brand/brand.json` and the files it names. A file is a path under `brand/` whose segments are made of letters, digits, `.`, `_` and `-`, none starting with `.`. `teach serve` serves `/brand/<file>`, and `teach export` copies the files under `brand/`, `brand.json` included.

## Keys

Every key is optional. Any other key makes the brand invalid.

| Key | Value |
|---|---|
| `name` | string: the header's text |
| `logo` | `{ "light": file, "dark": file (optional), "alt": string (optional) }`: with `dark`, the light logo shows in the light scheme and the dark logo in the dark one |
| `favicon` | file: the page's icon |
| `color` | `{ "light": { token: colour }, "dark": { token: colour } }`, each optional |
| `font` | `{ "body": family, "code": family }`, each optional |
| `footer` | `{ "classification": string or { audience: string }, "copyright": string }`; `{year}` in `copyright` becomes the year |
| `audience` | string: the key of `footer.classification` to show |
| `tokens` | file: a design-tokens JSON file (Design tokens) |
| `voice` | `{ "avoid": [ { "term": string, "use": string (optional) } ] }` |
| `dividers` | `{ "image": file, "alt": string (optional) }`: the image of every divider page (Dividers) |

A colour is `#rgb`, `#rrggbb` or a `{dotted.path}` reference. A family is comma-separated names made of letters, digits, spaces and hyphens, with no quote, or a reference.

## Colours and fonts

A token is one of the custom properties of the first `:root` block of the plugin's `lesson.css`, read from that file: 23 today (`--bg`, `--card`, `--ink`, `--muted`, `--rule`, `--code-bg`, `--code-ink`, `--link`, `--chip`, `--c-mission`, `--c-fact`, `--c-example`, `--c-quiz`, `--c-step`, `--c-sources`, `--c-followup`, `--c-prereq`, `--c-note`, `--ok-bg`, `--ok`, `--bad-bg`, `--bad`, `--mark`). Any other name makes the brand invalid. The `color.light` values go in a `:root` rule, and the `color.dark` values in the two rules `lesson.css` writes for dark: `:root:not([data-theme="light"])` under `@media (prefers-color-scheme: dark)`, and `:root[data-theme="dark"]`. A token the brand does not set for a scheme keeps `lesson.css`'s value there. `font.body` sets the font of `body` and of the citation markers; `font.code` sets it on `code` and `pre`.

## What a page gets

- Before `</head>`: `<link rel="icon">` when `favicon` is set, then one `<style>` element holding the rules above.
- `<header class="brand-header">` when `name` or `logo` is set: the logo, linked to the index, then the name. It follows the navigation bar.
- `<footer class="brand-footer">` before `</body>` when a classification or a copyright is set: the classification, the copyright and, on a lesson, `lesson N of M`, where N is the lesson's place in the lesson index and M the number of lessons in it (in an export, the exported lessons).

The name, the alt text, the classification and the copyright are written escaped. In an exported page the logo and icon paths are relative. `teach serve` reads `brand.json` on every request, so an edit shows on reload.

## Audience

With `footer.classification` written as an object, each key is an audience and `audience` picks the one to show; changing `audience` changes that line only. An `audience` that is not one of its keys, or none, makes the brand invalid, and so does an `audience` beside a string classification.

## Design tokens

`tokens` names a JSON file under `brand/`. A colour or family written `{a.b.c}` is the `$value` at that dotted path of the file, and a `$value` that is itself `{...}` is followed in turn, at most eight times. A colour must end as `#rgb` or `#rrggbb`, or an object whose `hex` is one; a family as a string or a list of strings, joined with `, `. The page is the same as with the values written by hand.

## Dividers

With `dividers` set, each group of lessons gets a divider page before it. A group is a run of consecutive lessons, in id order, that close on `Project:` lines of `PATH.md` with the same title; the index shows each group under one heading. A run that closes on no `Project:` line gets no divider page.

A divider page holds the navigation bar, the image with its `alt`, the group's `Project:` title as its title and heading, and links to the group's lessons. It carries the brand's style, header and footer like any page.

`teach serve` serves divider page k at `/dividers/<k>.html`, k counting from 1 over the groups with a `Project:` line, and `teach export` writes it as `dividers/<k>.html`.

Previous and next pass through the divider pages: the last lesson of a group, then the next group's divider page, then that group's first lesson. The first divider page has no previous link. `/lessons.json` lists the divider pages among the lessons in that order, each with only an id, a title and a path. `line N of M` is unchanged and the footer's `lesson N of M` counts lessons only, and a divider page shows neither.

The index links each group's heading to its divider page.

A divider page needs no claims verdict: it shows the `Project:` titles and lesson titles that the index already shows. The export's phrase check reads it. With `--skip-ungated`, a group whose lessons are all left out gets no divider page, and a group with some left out lists only the lessons kept.

Without `dividers`, there is no divider page and `/dividers/<k>.html` is 404.

## An invalid brand

`teach serve` prints one line at start and serves every page without the brand; `teach export` prints one line, writes nothing and exits 1.

## Lint

With a `brand/` folder, `teach lint` reports these errors, in `brand/brand.json` unless a page is named:

- `BRAND_INVALID`: `brand.json` is missing or not JSON, or breaks a rule above: an unknown key, a wrong type, a bad path, colour, family or audience, or a reference that does not resolve.
- `BRAND_TOKEN_UNKNOWN`: a `color` key that is not a token, by name.
- `BRAND_FILE_MISSING`: `logo.light`, `logo.dark`, `favicon` or `dividers.image` naming a path that is not a regular file, by key and path.
- `BRAND_ALT_MISSING`: a `logo` or `dividers` with no non-empty `alt`.
- `BRAND_CONTRAST`: a pair under 4.5:1 in the light or the dark scheme, with the scheme, the two tokens, their values and the ratio. Each token takes the brand's value for that scheme, or else `lesson.css`'s. The pairs are `--ink` on `--bg`, `--card`, `--chip`, `--ok-bg`, `--bad-bg` and `--mark`; `--muted` on `--bg` and `--card`; `--link` on `--bg` and `--card`; and `--code-ink` on `--code-bg`.
- `BRAND_OFF_PALETTE`, on a lesson or reference page: a figure's fill or stroke colour, which is the warning `WARN_FIGURE_COLOR` without a brand. Also each `#hex`, `rgb(`, `rgba(`, `hsl(` or `hsla(` colour in a `style` attribute or in the rules of a `<style>` element; its selectors are not read.
- `BRAND_VOICE`, on a lesson: each `voice.avoid` term in its prose, with its `use` when set. The match is case-sensitive and whole-word. The prose is every block but `sources` and `followup` with its `<pre>`, `<code>` and `<script>` elements removed, plus the quiz and predict items' questions, options and explanations.

`BRAND_FILE_MISSING`, `BRAND_ALT_MISSING` and `BRAND_CONTRAST` are checked only once `brand.json` has no `BRAND_INVALID` or `BRAND_TOKEN_UNKNOWN`. Without a `brand/` folder none of these codes is reported.

## Example

`brand/brand.json`, with `brand/logo.svg` beside it:

```json
{
  "name": "Example Org",
  "logo": { "light": "logo.svg", "alt": "Example Org" },
  "color": { "light": { "--link": "#c2410c", "--bg": "#fafaf0" } }
}
```
