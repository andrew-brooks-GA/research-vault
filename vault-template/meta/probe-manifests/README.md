# Probe manifests

One file per tool: `<tool>.md`. A manifest lists the tool's ground-truth surface — the read-only commands whose output outranks documentation for the claims they cover.

Rules:
- **Read-only commands only.** A probe must never mutate state (no `create`, `apply`, `delete` — `--help` on those subcommands is fine). Agents run nothing outside the manifest without asking the user first.
- Probe output is captured as a `source` entry: `authority_tier: primary`, `authority_basis: tool-output`, `source_type: tool-output`, `source_url: cli://<tool>/<probe-name>`, `subject: {name, version}` (the version the version_command reported — required; lint `TOOL_OUTPUT_VERSION` enforces it), `volatility: fast`.
- **Dedup:** one probe source entry per (tool, version, probe name). If one exists for the current version, link it instead of re-capturing.
- Procedure: `meta/prompt-templates/probe-tool.md`.

Format (fenced YAML inside the markdown file):

```yaml
tool: <binary name>
version_command: <command printing the tool version>
probes:
  - name: <kebab-case-probe-name>
    command: <read-only command>
    ground_truth_for: <one line — which claims this output settles>
```

Extra keys on a probe entry are allowed (forward-compatible); unknown keys are ignored.
