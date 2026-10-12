# 10 — Paired evaluation: does traversal help on this vault?

## Problem

Round 1's open question `2026-10-12-evidence-typed-edge-traversal-small-curated` is still open: every published gain for graph retrieval is on LLM-extracted graphs over corpora far larger than a vault, and the one small-corpus result (GraphRAG-Bench ablation) may be mislabeled (`2026-10-12-there-independent-small-corpus-benchmark-comparing`). Three proposals were rejected this round for lack of local evidence: output caps and hub demotion in `related`, a shortest-path flag, and link suggestions in `advise` (`2026-10-12-does-personalized-pagerank-order-traversal-results`, `2026-10-12-which-lexical-candidate-generator-gives-precise`). Each needs a measurement, not a spec.

## Change (docs and a template; no runtime code)

`docs/EVALUATION.md` defines the protocol and `docs/evaluation-template.json` is the `capture --batch` plan a run starts from. `docs/EVALUATION.md` defines a frozen, repeatable protocol:

- **Frozen inputs.** Vault snapshot (git commit of the vault, or the manifest's content hash), question set, prompts, model id, token budget. Record all in the experiment entry.
- **Questions.** Pilot of 20 drawn from the vault: 10 single-fact, 10 multi-hop or provenance ("what evidence supports…", "what depends on…", "is … still current"). Each has gold supporting ids and gold answer points written before any run.
- **Conditions.** A: `search` only. B: `search` plus `related` per AGENTS.md §5.2. Both may read bodies. Independent sessions per question, order counterbalanced across conditions.
- **Metrics.** Answer correctness and completeness against the gold points (citation correctness alone rewards incomplete answers); citation correctness (ids exist and support the claim); staleness honesty (did the agent flag stale or superseded evidence that the gold marks); tokens read; tool calls.
- **Offline companion checks** on the same 20 questions, no agent needed: (1) personalized PageRank seeded from the search hits versus `related` distance ordering; count how often the top-10 sets differ. (2) For the shared-source link candidates (two notes citing one source with no edge between them), a human reviews the first 50 and records accept/reject.
- **Output.** One `experiment` entry per run with `outcome`, linked to the questions above via `contributing`. The open questions move to `answered` only when results exist; the pilot may answer "not measurable at 20" and that is a result.

What the results gate: enabling any ranking or truncation in `related`; link suggestions in `advise`; a `check --transitive` flag (round-1 question `2026-10-12-should-check-gate-transitive-staleness-cited`). The paired run does not measure transitive gating; that needs its own observation period, as spec 04 already says.

## Tests

None (documentation). The experiment template is validated by `capture --batch` on first use.
