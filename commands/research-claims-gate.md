---
description: Run the claims gate on a draft that cites vault evidence, then record the verdict in the claims ledger.
argument-hint: <draft path> [snippet and experiment ids]
---
Invoke the `research-claims-gate` skill on the named draft, passing any snippet and experiment ids as the `--extra` ids. If no draft was given, ask which file to gate. Follow the skill end-to-end: clean `check --check`, `gate evidence`, one `claims-reviewer`, fix and re-run on `FAIL-as-sent`, `gate record`, then present the draft with the reviewer's table.
