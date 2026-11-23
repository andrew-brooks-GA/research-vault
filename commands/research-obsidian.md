---
description: Regenerate the derived Obsidian browsing view (wikilinks + Map-of-Content).
argument-hint: [--out _obsidian]
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" obsidian` and report the summary line. `--out` must resolve inside the vault and outside the canonical entry folders; its normalized spelling must not name the vault root or fall inside an entry folder. A canonical entry folder must also be known to resolve outside the output directory. Existing segments below the vault root through the output directory must be directories, with no symbolic links or junctions; the vault root may itself be linked. Missing output directories and parents are created. Each destination is checked against the resolved output directory immediately before writing; an outside or unresolved destination is refused. See [Local writers](../SECURITY.md#local-writers) for the checks and [Threat model in one line](../SECURITY.md#threat-model-in-one-line) for their limits.
