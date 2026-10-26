<!-- Adapted from the `teach` skill in mattpocock/skills (MIT, (c) 2026 Matt Pocock). -->

# Learning Record Format

Learning records live in `./learning-records/`, one file per record. The id is the file name without `.md`, of the form `NNNN-slug` (`0001-fx-multiplies-by-six`); the slug starts with a letter. The directory is created with the first record.

They are the teaching equivalent of ADRs: they capture non-obvious lessons, key insights, and stated prior knowledge that will steer future sessions. They are used to calculate the zone of proximal development.

## Writing one

Never write a record by hand. Put the body in a file and run:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" teach record add --title "<title>" --kind <kind> [--lesson <lesson id>] [--body-file <path>]
```

It takes the next number, writes the frontmatter, validates it against the teach schema, and prints the new id. An invalid value is an error and nothing is written.

## Template

```md
---
title: {Short title of what was learned or established}
type: learning-record
date: {YYYY-MM-DD, UTC}
status: active
lesson: {lesson id, optional}
kind: {understanding | prior-knowledge | misconception | mission-shift}
---
# {Short title of what was learned or established}

{1-3 sentences: what was learned (or what prior knowledge was established), and why it matters for future sessions.}
```

- `status` is `active` or `superseded`. `superseded_by: <record id>` appears only when superseded.
- `lesson` names the lesson the evidence came from, when there is one.
- `kind` names the trigger that justified the record (below).

That is the whole format. The body can be a single paragraph. The value is recording _that_ this is now known and _why_ it changes what to teach next, not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most records won't need them.

- **Evidence**: how the user demonstrated the understanding (a question answered, an exercise completed, prior experience cited). Useful when the claim might be revisited.
- **Implications**: what this unlocks or rules out for future sessions. Worth recording when non-obvious.

## When to write a learning record

Write one when any of these is true, with the matching `kind`:

1. `understanding`: **the user demonstrated genuine understanding of something non-trivial**: not just exposure, but evidence they can use the concept correctly. This sets a new floor for what to teach next.
2. `prior-knowledge`: **the user disclosed prior knowledge**: "I already know X." Record it so future sessions don't re-teach it. Also record the _depth_ claimed.
3. `misconception`: **a misconception was corrected**: the user previously believed something wrong and now sees why. These are high-value: they predict future stumbling blocks for related topics.
4. `mission-shift`: **the mission shifted in response to learning**: the user discovered they cared about something different than they thought. Cross-link to [[MISSION.md]] and update it.

### What does _not_ qualify

- Material that was merely covered. Coverage is not learning. Wait for evidence.
- Anything already captured tersely in [[GLOSSARY.md]] as a term definition. Don't duplicate.
- Session-by-session activity logs. Learning records are not a journal: they are decision-grade insights.

## Supersession

A record is superseded, never rewritten or deleted. When a later record contradicts an earlier one, write the new record first, then run:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" teach record supersede <old id> --by <new id> [--reason "<text>"]
```

It sets `status: superseded` and `superseded_by` on the old record and appends `Superseded by <new id>: <reason>` to its body. After `teach lint --fix`'s one-off migration, that is the only edit a record receives. The history of how understanding evolved is itself useful signal.

## Upgrading older records

Records written before this format have no frontmatter and may carry a `Status: superseded by LR-NNNN` line. Run `teach lint --fix` once in the workspace: it adds the frontmatter (`kind: understanding`, `date` from the file's modification time) and, when the record numbered `LR-NNNN` exists, sets `status: superseded` and `superseded_by`; otherwise the record stays `active` and the old line stays in the body. A second run changes nothing.
