# Migrating an existing vault

This plugin ships **no entry content** — only the scaffold and tooling. To move existing research entries into a vault managed by this plugin:

1. Run `research-vault init` (or `/research-init`) to scaffold an empty vault at the resolved location.
2. Copy your existing `sources/`, `notes/`, etc. entries into the new vault's matching folders.
3. Run `research-vault lint --fix` to normalize encoding/formatting and rebuild the manifest, then `research-vault lint` to surface any schema violations to fix by hand.
4. Personal/machine-specific paths belong only in your private entries — never commit them to this plugin repo.

## Upgrading an existing vault across plugin versions

The steps above import loose notes into a *new* vault. Upgrading a *managed* vault to a newer plugin release is different — see the **"Upgrading an existing vault"** section of `CHANGELOG.md` for the release-specific new lint codes, the one-time `MANIFEST_STALE`, and the pre-write quote-residue sweep.

> **Before running `lint --fix` on a vault last written by an older plugin**, run the residue sweep from the CHANGELOG first — `lint --fix` (and the PostToolUse hook) re-serialize frontmatter and will bake in any multi-cycle `\"` residue permanently. `research-vault advise` also lists affected entries under "quote residue".

Note: `capture` supports all six types (source/note/synthesis/snippet/experiment/question) with their type-specific flags; you can also author entries by hand per the schema, and `lint` enforces required fields either way.
