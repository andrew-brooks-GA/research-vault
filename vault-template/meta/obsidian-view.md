# Obsidian View

The `_obsidian/` directory is a **derived** browsing view, never a source of truth.
`research-vault obsidian` regenerates it from the manifest: one `[[wikilink]]` stub per
entry (forward links + backlinks) plus a `MOC.md` Map of Content grouped by type. The
canonical entries always live in the type folders (`sources/`, `notes/`, …); the view is
a convenience layer over them.

## Generate it

```sh
research-vault obsidian             # writes <vault>/_obsidian/
research-vault obsidian --out name  # use a different derived dir under the vault
```

`--out` must name a derived directory **under the vault**, never the vault root or an
entry folder (`sources/`, `notes/`, …). It refuses otherwise, so the view can never
overwrite a canonical entry.

## Open it in Obsidian

Point Obsidian at the **`_obsidian/` folder** (*Open folder as vault* → select
`_obsidian/`). The stubs link to each other by id, so the graph view, backlinks, and
`MOC.md` all resolve cleanly. Each stub header names its canonical file (e.g.
`Canonical: sources/<id>.md`); open that file in the type folder to read or edit the
real entry.

> Open `_obsidian/` itself, not the vault root. The stubs share basenames with the
> canonical entries (`<id>.md`), so opening the whole vault makes `[[id]]` links
> ambiguous between a stub and its canonical file.

## Rules

- **Do not edit the stubs.** They are overwritten on the next run; edits are lost. Edit
  the canonical entry instead, then regenerate.
- **Regenerate after changes.** The view does not auto-update; re-run `obsidian` after
  capturing or verifying entries.
- **It is git-ignored.** `_obsidian/` is excluded by the vault's `.gitignore`, so each
  teammate rebuilds it locally. Commit the entries and `AGENTS.md`, not the view.