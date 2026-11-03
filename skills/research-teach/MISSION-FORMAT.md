<!-- Adapted from the `teach` skill in mattpocock/skills (MIT, (c) 2026 Matt Pocock). -->

# MISSION.md Format

`MISSION.md` lives at the workspace root. It captures the _reason_ the user is learning this topic. Every teaching decision (what to teach next, which resources to surface, which exercises to design) should trace back to this document.

## Template

```md
# Mission: {Topic}

## Why
{1-3 sentences. The concrete real-world goal the user is chasing. What changes in their life or work when they have this skill? Avoid abstract framings like "to understand X"; push for the underlying outcome.}

## Success looks like
- {A specific, observable thing the user will be able to do}
- {Another specific thing}
- {…}

## Floor
### Known tools
- {One tool per bullet the learner runs daily, e.g. kubectl or a spreadsheet. Lessons may run only these and the tools earlier lessons taught}
### Known terms
- {One term per bullet the learner defined correctly in the interview, e.g. Service and Endpoints}
### New to me
- {One term per bullet the mission needs and the learner could not define. Every one gets a PATH.md line before any lesson uses it}

## Constraints
- {Time, budget, prior commitments, learning preferences, anything that bounds the approach}
- Task environment: {kind on this machine, a cluster I can reset; written only when the depth answer was "do it unaided" and the learner named one}

## Out of scope
- {Adjacent topics the user explicitly does not want to chase right now, protecting the zone of proximal development}
```

## Rules

- **One mission per workspace.** If the user wants to learn two unrelated things, that is two workspaces.
- **Concrete over abstract.** "Run a half marathon by October" beats "get fitter." "Ship a Rust CLI to my team" beats "learn Rust."
- **Push back on vagueness.** If the user cannot articulate why, interview them before writing anything. A bad mission is worse than no mission.
- **Revise when reality shifts.** Missions change. When the user's goal moves, update this file: don't leave a stale mission steering future sessions.
- **Scope first, then the floor.** Ask what the sessions should include and leave out before asking about any tool or term; then check only the tools and terms that scope needs. A tool the learner uses daily but no lesson needs stays out of the Floor.
- **The Floor is what the learner showed, not rated.** Check each term the scope needs with one dialog question (`SKILL.md` section 2, item 4); a correct pick or sentence goes to Known terms, anything else to New to me, and the `prior-knowledge` record says whether a Known term was recognised or produced. Ask "daily, have run it, or never" for each tool a lesson will run. `teach lint` enforces both lists.
- **Keep it short.** If `MISSION.md` runs past a screen, it has stopped being a compass and started being a plan.
