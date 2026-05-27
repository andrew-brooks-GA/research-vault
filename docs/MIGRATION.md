# Migrating an existing vault

This plugin ships **no entry content** — only the scaffold and tooling. To move existing research entries into a vault managed by this plugin:

1. Run `research-vault init` (or `/research-init`) to scaffold an empty vault at the resolved location.
2. Copy your existing `sources/`, `notes/`, etc. entries into the new vault's matching folders.
3. Run `research-vault lint --fix` to normalize encoding/formatting and rebuild the manifest, then `research-vault lint` to surface any schema violations to fix by hand.
4. Personal/machine-specific paths belong only in your private entries — never commit them to this plugin repo.

Note: in v1, `capture` fully populates `source` entries; the other types (note/synthesis/snippet/experiment/question) can be authored by hand per the schema, and `lint` enforces their required fields regardless.
