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

## Known tools
- {One tool per bullet that the learner already runs and reads, e.g. kubectl. A lesson may run only these and the tools earlier lessons taught; see LESSON-FORMAT.md "Commands and tools"}

## Constraints
- {Time, budget, prior commitments, learning preferences, anything that bounds the approach}

## Out of scope
- {Adjacent topics the user explicitly does not want to chase right now, protecting the zone of proximal development}
```

## Rules

- **One mission per workspace.** If the user wants to learn two unrelated things, that is two workspaces.
- **Concrete over abstract.** "Run a half marathon by October" beats "get fitter." "Ship a Rust CLI to my team" beats "learn Rust."
- **Push back on vagueness.** If the user cannot articulate why, interview them before writing anything. A bad mission is worse than no mission.
- **Revise when reality shifts.** Missions change. When the user's goal moves, update this file: don't leave a stale mission steering future sessions.
- **Name the tools the learner has.** `## Known tools` is the floor `teach lint` enforces: a lesson that runs anything else must come after a lesson that taught it. Ask in the interview which tools the learner runs and reads today, not which they have heard of.
- **Keep it short.** If `MISSION.md` runs past a screen, it has stopped being a compass and started being a plan.
