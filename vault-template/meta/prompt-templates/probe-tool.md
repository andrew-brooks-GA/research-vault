# Prompt: Probe a tool against its manifest

Use at capture time (a claim concerns a tool with a manifest) and at verify time (method `tool-probe`). Manifest: `meta/probe-manifests/<tool>.md`. No manifest → docs-based behavior, unchanged; consider offering to create one.

1. Run the manifest's `version_command`; note the installed version V.
2. Run the manifest probe(s) whose `ground_truth_for` covers the claim. Manifest-listed read-only commands ONLY; anything else requires asking the user.
3. Dedup: if a probe source for (tool, V, probe-name) exists, reuse it. Otherwise capture one:
   `capture --type source --title "<tool> <probe-name> output (V)" --url "cli://<tool>/<probe-name>" --source-type tool-output --authority-tier primary --authority-basis tool-output --subject-name <tool> --subject-version V --volatility fast [--series <tool>-<probe-name>]`
   Body: the relevant output excerpt, verbatim.
4. Reconcile claim vs probe output — capture time:
   - Agree → the note links BOTH the docs source and the probe source.
   - Probe shows something the docs omit → the probe source is the primary citation; optionally file a `question` ("docs lag: <X> undocumented as of <tool> V").
   - Conflict at the same version → the probe wins; the note records the discrepancy.
5. Reconcile — verify time (entry matched by `series`/topics containing the tool name):
   - V equals the entry's pinned `subject.version` → normal outcomes: `verify --id <id> --method tool-probe --result confirmed|changed-trivially|outdated ...`.
   - V differs → do NOT mark outdated on that basis: this is version succession (freshness-policy §8) — keep the entry active for its version and capture V as a series sibling.
6. Offline: probes run locally, so `tool-probe` remains valid offline.

Anti-patterns: running commands not in the manifest; capturing a probe source without `subject.version` (lint `TOOL_OUTPUT_VERSION`); re-capturing an existing (tool, version, probe) output; treating a version mismatch as a contradiction.
