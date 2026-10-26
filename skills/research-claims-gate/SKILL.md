---
name: research-claims-gate
description: Use when a draft that cites vault evidence is about to be shown, sent or taught (a teach lesson or reference doc, a vault synthesis, a document matching the project's gates.globs). Checks citations, derives the evidence list from the vault, dispatches one fresh research-vault:claims-reviewer, and records the verdict in the repo's claims ledger keyed to the draft's content hash. Not a style check and not the research itself.
---
# Claims gate

A fresh reviewer checks every factual claim in the draft against the vault entries it cites, and nothing else. The verdict goes to the ledger (`.research-vault-ledger.jsonl` at the repo root, or in the vault for an entry outside any bound repo), keyed to the draft's content hash, so any edit after the gate needs a new verdict. The Stop hook blocks a turn that leaves a changed gated file without a `PASS` or `MERIT` row for its current content.

## Paths

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now; subagents do not inherit it. Run every command below from the bound repo root (the directory holding `.research-vault.json`). For a vault entry outside any bound repo, run from the vault's parent with `--vault <path>` or `RESEARCH_VAULT_PATH` set; the ledger then lives in the vault.
- Vault path: the `vault` value in `.research-vault.json`, as an absolute path.
- `GATE-LOG.md`: in the teach workspace if the draft sits under a directory holding `MISSION.md`, else at the repo root. Append-only; do not edit earlier entries.

## Steps

0. **Citations clean.** Run `check --check <draft>`. Any `uncovered` or `stale` row stops the gate: capture the source (`--store-body --ack-data-egress` when the quoted text matters) or re-verify the entry, then run it again. Dispatch only on exit 0.
1. **Evidence list.** Run `gate evidence <draft> --extra <ids>`, where `<ids>` are the draft's `snippet` and `experiment` ids, comma-separated (omit `--extra` when there are none). Copy the output as printed; do not retype or trim it.
2. **Dispatch.** ONE subagent: Agent tool, `subagent_type: research-vault:claims-reviewer` (the plugin's agent; a bare `claims-reviewer` can resolve to a different project agent), no `model`, not a fork. The prompt is exactly:

   ```
   Draft: <absolute draft path>
   Vault: <absolute vault path>
   Evidence (read ONLY these vault entries):
   <the step 1 output, verbatim>
   ```

   Nothing else. No summary of the work; the summary is the bias.
3. **On `FAIL-as-sent`.** Fix the draft or the evidence for each failing claim: narrow the claim to what the evidence shows, capture the missing source with a body, or add the probe, re-run it and re-capture the snippet and experiment (the old ones get `verify --result outdated --superseded-by <new id>`). Then re-run from step 0. After the second round, decide each surviving finding on its merits: append to `GATE-LOG.md` a heading naming the draft and date, then each finding, the decision and the reasoning. Then stop dispatching.
4. **Record.** `gate record <draft> PASS` when the reviewer's verdict line is `VERDICT: PASS`, or `gate record <draft> MERIT "<GATE-LOG.md heading>"` after step 3's merit decision. Never record `PASS` for a `FAIL-as-sent` verdict. Record against the exact bytes the reviewer saw; an edit after recording needs a new round. `gate status <draft> --check` confirms the row.
5. **Present.** Show the draft with the reviewer's claim table.

## Anti-patterns

| Mistake | Do instead |
|---|---|
| A fork as the reviewer | `subagent_type: research-vault:claims-reviewer`; a fork inherits the drafting context |
| `model` on the spawn | Omit it; the agent file pins the model |
| Summarising the investigation in the prompt | Draft, vault and evidence lines only |
| Arguing a finding down | Change the draft or the evidence, or log a merit decision after round two |
| Hand-typing the evidence list | Paste `gate evidence` output verbatim |
| Re-rolling the reviewer for a PASS | Two rounds, then decide on merit in `GATE-LOG.md` |
