---
name: research-claims-gate
description: Use when a draft that cites vault evidence is about to be shown, sent or taught (a teach lesson or reference doc, a vault synthesis, a document matching the project's gates.globs). Checks citations, derives the evidence list from the vault, dispatches one fresh research-vault:claims-reviewer, and records the verdict in the claims ledger (the repo's, or the vault's for an entry outside any bound repo) keyed to the draft's content hash. Not a style check and not the research itself.
argument-hint: "<draft path> [snippet and experiment ids]"
---
# Claims gate

A fresh reviewer checks every factual claim in the draft's changed units (every unit on a first review) against the vault entries on its evidence list, plus any entry its omitted-entry search turns up. The verdict goes to the ledger (`.research-vault-ledger.jsonl` at the repo root, or in the vault for an entry outside any bound repo), keyed to the draft's content hash, so an edit that changes a unit (or an image a page references) needs a new verdict for that unit. The Stop hook blocks a turn that leaves a changed gated file (or a changed image it references that still exists) for which `gate status` shows no `PASS` or `MERIT`.

## Paths

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now; it is unset in the Bash environment of the controller and of a subagent. Run every command below from the bound repo root (the directory holding `.research-vault.json`). For a vault entry outside any bound repo, run from the vault's parent with `--vault <path>` or `RESEARCH_VAULT_PATH` set; the ledger then lives in the vault.
- Vault path: the `vault` value in `.research-vault.json`, as an absolute path.
- `GATE-LOG.md`: in the teach workspace if the draft sits under a directory holding `MISSION.md`, else at the repo root. Append-only; do not edit earlier entries.

## Steps

If no draft was named, ask which file to gate.

0. **Citations clean.** Run `check --check <draft>`. Any `uncovered` or `stale` row stops the gate: capture the source (`--store-body --ack-data-egress` when the quoted text matters; a source already in the vault gets its text in step 1a) or re-verify the entry, then run it again. Dispatch only on exit 0.
1. **Evidence list.** Run `gate evidence <draft> --extra <ids> --changed`, `<ids>` comma-separated (omit `--extra` when there are none). Give each section of a Markdown draft with headings its evidence in a comment on its own line under the heading, `<!-- evidence: <id> <id> -->`. For a Markdown draft with headings the command lists only the citations inside the changed units, in a comment or in prose. A changed row with none takes its section's, and a changed unit with none gives the whole file's. `<ids>` are then the ids no citation in those units carries. For any other draft, `<ids>` are the draft's `snippet` and `experiment` ids. Copy the output as printed; do not retype or trim it. Its `changed units: ...` line (followed, for a Markdown draft with headings and for a code draft, by one `unit` line per changed unit) names the units (data-block elements, every repeated block a whole `<name>#N` unit suffixed with the first available `#2`, `#3`, … that is not a real block name; `rest`; `script:<src>`; `fact:N` and `quiz:N` per paragraph and item; `img:<src>` per `<img>` of a lesson or reference page, hashed over its `<figure>` and the image file, so a change to the image file alone reopens only that unit, and a caption or alt change also reopens the data-block holding the figure, or for a `fact` block the paragraph holding it (a caption change to a figure between `fact` paragraphs also reopens `rest`); `sec:<slug>` per heading section of a Markdown draft and `sec:<slug>/<first-cell slug>` per table data row in it, each with a `unit <name> <file>:<start>-<end> prose` line giving its range) that no PASS or MERIT row or current shipped-script exemption covers yet. On a first review that is every unit except scripts equal to the current shipped copy; after an edit it is only what changed, and the reviewer verdicts only those. For `rest`, read the page text and markup outside the hashed block interiors or fact paragraphs, including block tags and attributes and every parsed quiz JSON key except item values (item count stays in `rest`; insignificant JSON formatting is exempt). A page with images also gets one line per readable png, jpg, jpeg, gif, svg or webp file it references under the workspace's `lessons/`, `reference/` or `assets/`, `image: <workspace-relative path> sha256:<hash>` (the path is relative to the directory holding `MISSION.md` above the page, else to the page's grandparent); `gate status` counts a changed image file against its page; `gate staged` also looks at a page git tracks when an image file it references is staged, also one gone from the working tree, and the Stop hook when one is changed while it still exists (a deleted image shows in `gate status` and `gate changed` on the page; `gate staged` sees it only while the index holds a staged copy, and the Stop hook not at all).
1a. **Page text.** The list holds the sources behind each note it lists. If it flags a source `no-body` and the user is present, ask once for this gate: may the session fetch those pages and store their text in the vault? Give the count and the hosts, and say the text is copied into the source entries, which go wherever the vault goes. In a subagent, a Workflow agent or a headless run do not ask; the answer is no. On yes, run `capture --fill <id> --ack-data-egress` with `RESEARCH_VAULT_ALLOW_NETWORK=1` set, once for each such source, one command at a time; report each result (`filled`, `kept`, `refused`, `version-floating`, `unreachable`, `no-text` or `too-large`); then run step 1 again. On no, say which claims are likely to fail for want of text, and continue. Do not ask again in the second round.
1b. **Packet, for a run's own synthesis only.** When the draft is the synthesis of a research-orchestrate run that stored page text, and you hold that run's key, the first round may read an evidence packet in place of the whole sources: run step 1's command with `--packet <new empty directory outside the vault> --run <run key>`. It writes a copy of the listed entries in which each large source is cut to the lines within three of a quote that run checked, and prints a last `packet:` line. It refuses, and writes nothing, when a listed source has a quote row of another run or of an earlier text; then gate on the whole sources. Dispatch as in step 2 with `Vault:` set to the packet directory and the list without its `packet:` line. Two rules hold. A round on a packet can fail a draft and cannot pass one: an excerpt cannot show that a page lacks something, and the reviewer's search for entries off its list finds none in a packet. So a `FAIL-as-sent` from a packet round is a round, and its findings are fixed as in step 3; a `PASS` from a packet round is not recorded and does not count as a round: run the round again on the real vault. And a finding that says a page lacks something is checked against the whole source before the draft is changed.
2. **Dispatch.** ONE subagent: Agent tool, `subagent_type: research-vault:claims-reviewer` (use the qualified name), no `model`, not a fork. The prompt is exactly:

   ```
   Draft: <absolute draft path>
   Vault: <absolute vault path>
   Evidence (read ONLY these vault entries):
   <the step 1 output, verbatim, including its changed units line>
   ```

   The reviewer verdicts only the changed units; the rest keep the verdict they have. The `image:` lines name the only files outside the vault it may open, with Read. Round caps count per unit, not per draft.

   Nothing else. No summary of the work: a summary could bias the reviewer.

   A changed `script:<src>` unit means a loaded script is missing or has bytes neither passed nor equal to the plugin's current copy, including on first review. The reviewer does not read script files. Before recording a verdict, the controller reads that script’s change itself (the file or its `git diff`) and records only if it does what the page says.
3. **On `FAIL-as-sent`.** Fix the draft or the evidence for each failing claim: narrow the claim to what the evidence shows, capture the missing source with a body (for a source already in the vault, the fill of step 1a), or add the probe, re-run it and re-capture the snippet and experiment (the old ones get `verify --id <old id> --method <method> --result outdated --superseded-by <new id>`). Then re-run from step 0. After the second round, decide each surviving finding on its merits: append to `GATE-LOG.md` a heading naming the draft and date, then each finding, the decision and the reasoning. After round two change only the sentences a finding names, and log each change with the finding it answers. If a change after round two adds a claim no finding named, run one more round over every unit `gate changed` lists, apply its findings, and record `MERIT`, never `PASS`; there is no round after that. Otherwise stop dispatching.
4. **Record.** `gate record <draft> PASS` when the reviewer's verdict line is `VERDICT: PASS`, or `gate record <draft> MERIT "<GATE-LOG.md heading>"` after step 3's merit decision. Never record `PASS` for a `FAIL-as-sent` verdict. The row stores a hash per unit, so a later edit reopens only the units it touches (`gate changed <draft>` lists them); units untouched since a PASS or MERIT keep it. `gate status <draft> --check` confirms the draft is covered.
5. **Present.** Show the draft with the reviewer's claim table.

## Anti-patterns

| Mistake | Do instead |
|---|---|
| A fork as the reviewer | `subagent_type: research-vault:claims-reviewer`, never a fork |
| `model` on the spawn | Omit it; the agent file pins the model |
| Summarising the investigation in the prompt | Draft, vault and evidence lines only |
| Arguing a finding down | Change the draft or the evidence, or log a merit decision after round two |
| Hand-typing the evidence list | Paste `gate evidence` output verbatim |
| Re-rolling the reviewer for a PASS | Two rounds, then decide on merit in `GATE-LOG.md` |
| Recording `PASS` from a round on a packet | A packet round can only fail a draft; a `PASS` needs a round on the whole sources |
