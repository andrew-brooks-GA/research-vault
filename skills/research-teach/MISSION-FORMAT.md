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
- {One tool per bullet the learner runs daily, e.g. kubectl or a spreadsheet. Lessons may run only these and the tools this or an earlier lesson teaches (`data-teaches`)}
### Known terms
- {One term per bullet the learner picked or wrote a correct definition of in the interview, e.g. Service and Endpoints}
### New to me
- {One term per bullet the mission needs and the learner could not define. Every one gets a PATH.md line before any lesson uses it}

## Constraints
- Draft: {the profile entry id; only while awaiting the learner's confirmation}
- Depth: {one of the three answers in SKILL.md section 2, item 3; when set}
- {Time, budget, prior commitments, learning preferences, anything that bounds the approach}
- Task environment: {kind on this machine, a cluster I can reset; written only when the depth answer was "do it unaided" and the learner named one}
- Hints: {always or on request}
- Path reviews: {yes or no}
- Reminders: {none or every <N> days}

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
- **Three preferences, in a fixed form.** The interview's last item (`SKILL.md` section 2, item 7) writes one bullet for each under `## Constraints`: `- Hints: always` or `- Hints: on request`; `- Path reviews: yes` or `- Path reviews: no`; `- Reminders: none` or `- Reminders: every <N> days`, N a whole number from 1 to 3650 (`every 1 day` also). Any spaces may follow the colon. A bullet named `hints`, `path reviews` or `reminders` in any letter case is read only when it is spelled as here, and a second bullet of one name is never read; `teach lint` reports `MISSION_PREF_INVALID` for each such bullet under `## Constraints` that it does not read. With no bullet read, the answer is `always`, `no` or `none`, and `teach next` lists that preference on its `preferences-unset:` line (the default answers are on its `preferences:` line). With `Reminders: every <N> days`, an active record written before the date N days ago is `review-due` when no attempt on or after that date names it or is on a lesson whose quiz tests it (a checked task's attempt counts only for the records its `tested` list names); with `none`, no record is. With `Path reviews: yes`, `PATH.md` plans review lines. To change an answer, edit its bullet; that is not a mission shift.
- **Keep it short.** If `MISSION.md` runs past a screen, it has stopped being a compass and started being a plan.

## Drafts and profiles

A profile is a draft mission with `## Why`, `## Success looks like` and `## Out of scope` filled in, and the three Floor headings with nothing under them. It may be about a topic and name no kind of learner. It is whole and extends no other profile; to make a variant, copy one and edit it.

Keep it as a vault snippet with the topic `teach-profile`, the mission in a fenced block and an optional path in a second fenced block. Write the blocks to a file, with one line of prose above them if wanted, both fenced as `md`. Run `capture --type snippet --language markdown --title "Profile: <subject>" --topics teach-profile --domain <a domain from the vault's taxonomy.json> --summary <one sentence> --body-file <file>`. With no `--domain`, one trial's entry got `software-engineering`. Before capture, write the mission block to `MISSION.md` and the path block, if present, to `PATH.md` in an empty folder and run `teach lint <folder>`. Capture when it prints `lint: clean`. Give that topic to profiles and to no other entry, and give a profile no topic of its subject. In one probe, `search --topic teach-profile` then listed the profile and no other entry, and `search --topic <the subject's topic>` did not list it; `search --text` on a word of its title did. Name the subject in the profile's title. To replace a profile with a newer one, capture the newer one and run `verify --id <old> --method human-spot-check --result outdated --superseded-by <new>`. In one probe, on a profile kept as a snippet, `search` then listed the newer one and not the older.

When a workspace starts from a profile, write `- Draft: <entry id>` under `## Constraints`; remove it when the learner confirms. A profile may set `- Depth: <value>` there. Its three values are defined in `SKILL.md` section 2, item 3.

| Option | Where it is written | When not set, ask the learner |
|---|---|---|
| Depth | `Depth:` under `## Constraints` | Item 3 of the interview in `SKILL.md` |
| Session length and how the learner learns best | Free bullets under `## Constraints` | Item 6: session length and how they learn best |
| Hints | `Hints:` under `## Constraints`, in the form above | Whether to show a hint straight away when a check fails |
| Path reviews | `Path reviews:` under `## Constraints`, in the form above | Whether to plan reviews into the path |
| Reminders | `Reminders:` under `## Constraints`, in the form above | Whether to remind them to come back, and how often |

The Floor and the task environment are never set by a profile; the learner answers them.

For one fixed course, build the workspace and export it. In that workspace put every term of the scope under "New to me", keep the author's options as they are, and do not answer the Floor questions for the learners.

Example profile mission:

```md
# Mission: Paper folding

## Why
Make a small gift by hand.

## Success looks like
- Fold a paper boat from a square sheet without help.

## Floor
### Known tools
### Known terms
### New to me

## Constraints
- Session length: 15 minutes

## Out of scope
- Cutting or gluing paper.
```
