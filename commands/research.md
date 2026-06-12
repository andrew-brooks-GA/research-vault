---
description: Run the reference research orchestrator — vault-first answer, then web fan-out with conformant capture.
argument-hint: [question]
---
Invoke the `research-orchestrate` skill with the user's question as the research task. If no question was given, ask for one plus any version/environment constraints before starting. Follow the skill end-to-end: vault-first lookup, workflow (or degraded inline mode), `capture --batch`, lint gate, and the close-out report listing every entry created.
