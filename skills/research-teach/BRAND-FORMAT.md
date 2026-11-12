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

## An invalid brand

`teach serve` prints one line at start and serves every page without the brand; `teach export` prints one line, writes nothing and exits 1.

## Example

`brand/brand.json`, with `brand/logo.svg` beside it:

```json
{
  "name": "Example Org",
  "logo": { "light": "logo.svg", "alt": "Example Org" },
  "color": { "light": { "--link": "#c2410c", "--bg": "#fafaf0" } }
}
```
