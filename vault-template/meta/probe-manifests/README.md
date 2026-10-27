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

Example, a read-only manifest for kubectl (`kubectl.md`):

```yaml
tool: kubectl
version_command: kubectl version --client
probes:
  - name: create-help
    command: kubectl create --help
    ground_truth_for: subcommands and flags of `kubectl create`
  - name: explain-deployment-spec
    command: kubectl explain deployment.spec
    ground_truth_for: fields of the Deployment spec served by the connected cluster
  - name: api-resources
    command: kubectl api-resources
    ground_truth_for: resource kinds, short names, and API groups the cluster serves
```
