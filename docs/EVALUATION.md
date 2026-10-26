# Paired evaluation: does graph traversal help on this vault?

A frozen, repeatable protocol for the question spec 10 leaves open: on a small vault with authored edges, does an agent answer better with `related` than with `search` alone? Results are captured as `experiment` entries; nothing graph-related ships without them.

## Freeze before the first run

Record all of these in the experiment entry's body:

- Vault snapshot: the vault's git commit, or the `sha256` of `.vault-manifest.json` with `generated` removed.
- Question set (below), with gold supporting ids and gold answer points written before any run.
- Model id, system prompt, the AGENTS.md revision, and the token budget per question.

## Question set

Pilot of 20 drawn from the vault: 10 single-fact ("what version does X pin", "what does source Y say about Z") and 10 multi-hop or provenance ("what evidence supports synthesis S", "what depends on source Z", "is note N still current"). Each question has:

- `gold_ids`: the entry ids a correct answer must cite.
- `gold_points`: the 1–3 facts a complete answer states.
- `gold_stale`: the ids among `gold_ids` that are stale or superseded at the snapshot (may be empty).

## Conditions

- **A, search only.** The agent may run `search` (any flags) and read bodies.
- **B, search plus traversal.** The agent may also run `related`, following AGENTS.md §5.2. Not `advise`: it prints transitive stale-evidence paths directly and would confound the staleness-honesty metric, which is meant to measure whether traversal output (status, `superseded_by`, `last_verified` on nodes) is enough.

One independent session per question per condition. Counterbalance: half the questions run A first, half run B first. The agent never sees the other condition's transcript.

## Metrics per answer

| metric | how |
|---|---|
| answer correctness | gold points stated correctly / gold points |
| citation correctness | cited ids that exist and support the stated claim / cited ids |
| citation recall | gold ids cited / gold ids |
| staleness honesty | 1 if every id in `gold_stale` was flagged as stale or superseded, else 0 |
| tokens read | sum of tool-output tokens |
| tool calls | count |

Report means per condition and per question class (single-fact, multi-hop). Twenty questions are a pilot; a difference under the per-question spread is "not measurable at 20", and that is a result.

## Offline companion checks (no agent)

1. **Ranking.** For each question's search hits as seeds, compute a personalized PageRank over `edges[]` and compare its top-10 against `related --depth 2` ordered by distance then id. Count questions where the sets differ. Answers `2026-10-12-does-personalized-pagerank-order-traversal-results`.
2. **Link candidates.** List pairs of notes citing the same source with no edge between them. A human reviews the first 50 and records accept/reject per pair. Answers `2026-10-12-which-lexical-candidate-generator-gives-precise`.

## Output

Start from `docs/evaluation-template.json` (a `capture --batch` plan with one experiment entry and placeholders for the frozen inputs, the question table and the metric table). One `experiment` per run: `provider`, `model_id`, `date_run`, `task` (the condition and snapshot), `outcome`, and the metric table in the body; link the questions above via `contributing` on each question once answered. Move `2026-10-12-evidence-typed-edge-traversal-small-curated` to `answered` only with results in hand.

## What the results gate

Ranking or truncation in `related`; link suggestions or a graph-health section in `advise`; a `check --transitive` flag. The paired run does not measure transitive CI gating; that needs its own observation period (spec 04).

# Claims gate: does the reviewer agree with gold, run to run?

A frozen, repeatable protocol for the `claims-reviewer` agent. Results are captured as `experiment` entries; the agent prompt changes only with a run.

## Freeze before the first run

Record all of these in the experiment entry's body:

- Fixture vault: the one built by `fixtureVault()` in `test/helpers.mjs` at the commit of the run: `2026-01-01-fx-doc` (a source with a stored body), `2026-01-01-fx-doc-nobody` (a source without one), `2026-01-01-fx-snippet` (a snippet), `2026-01-01-fx-experiment` (an experiment that probes one value, 7 prints 42) and `2026-01-01-old` (a stale note). Materialise it from the repo root with `node --input-type=module -e "import { fixtureVault } from './test/helpers.mjs'; console.log(fixtureVault())"`, which prints the temp vault path. `gate evidence` refuses a draft outside a bound repo, so copy the two drafts into a fresh directory holding `.research-vault.json` with `{"vault": "<that path>"}` and run against the copies.
- Drafts: `test/fixtures/gate/lesson-ok.html` and `test/fixtures/gate/lesson-overclaim.html`, with the gold verdict per draft in `test/fixtures/gate/gold.json`, written before any run.
- Agent file: the git revision of `agents/claims-reviewer.md`, its `model` and `effort`, and the model id the dispatch reports.

## Procedure

For each draft, run `gate evidence --extra 2026-01-01-fx-snippet,2026-01-01-fx-experiment` against the fixture vault and dispatch one fresh `claims-reviewer` with the draft path, the vault path and that output verbatim. Five independent dispatches per draft; no dispatch sees another's transcript.

## Metrics

| metric | how |
|---|---|
| agreement with gold | dispatches whose final `VERDICT:` line equals the draft's `gold.json` value / dispatches |
| verdict stability across the five runs | for each draft, the count of the most common verdict / 5 |

Report both per draft. For `lesson-overclaim.html`, also record whether each `FAIL-as-sent` names the generalised claim, so a fail for the wrong reason is visible.

## Output

One `experiment` per run: `provider`, `model_id`, `date_run`, `task` (the agent revision and fixture commit), `outcome`, and the metric table plus each dispatch's verdict line in the body.

## The rule

A change to `agents/claims-reviewer.md` (prompt, `model`, `effort` or `tools`) ships only with a run of this protocol against the changed file, captured as above. A change that lowers agreement with gold or stability does not ship without a written reason in the experiment entry.
