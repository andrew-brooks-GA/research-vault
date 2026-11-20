# PATH.md Format

`PATH.md` lives at the workspace root. It is the curriculum: the lessons planned from the mission interview, in order, one line each. `teach next` prints the fringe, every untaken line whose `after:` lines are all built (or `floor`), in file order, the first being the default, and the inner fringe, the built non-review lines that no other built non-review line names in `after:`, highest lesson number first. A `Project:` line counts as a review line here, so a built project leaves the lessons it names in the inner fringe. The learner confirms the path before lesson one and may reorder it at any time.

## Template

```md
# Path: {Topic}

1. {The win, as a short title} | terms: {a, b} | after: floor
2. {The win} | terms: {c} | after: 1
3. {The win} | tool: {x} | after: 1, 2
4. Project: {the capability 1 to 3 build} | after: 1, 2, 3
5. Review of 1 to 3 | after: 4
```

## Fields

- The number and title are required. The title is the win in a few words.
- `terms:` names the terms the lesson introduces, at most three, matching the lesson's `data-introduces`.
- `tool:` names the one tool the lesson teaches, matching the lesson's `data-teaches`.
- `after:` lists prerequisite line numbers, or `floor`. Numbers name earlier lines only; a line with no `after:` is ready from the start, as `floor` is. `teach lint` reports `PATH_AFTER_FORWARD` for a value naming a later, missing or own line and `PATH_AFTER_CYCLE` for a loop. `teach path edges` proposes an `after:` value when a built lesson's prose uses a term, or its commands run a tool, that an earlier line introduces or teaches and this line's `after:` does not reach, and when an untaken line's title names one; it skips `Project:` lines, which use every term they integrate; it writes nothing.
- `lesson:` is added when the lesson is built, with the lesson id. `teach lint` checks the built lesson against its line.

## Rules

- **One new thing per line.** A line with both `terms:` and `tool:` is two lessons.
- **Every "New to me" term appears on a line** before any line that needs it. The Floor is the only other source of allowed terms. `teach lint` warns `WARN_PATH_TERM_UNPLANNED` for a "New to me" term on no line's `terms:`; when no line's `terms:`, `tool:` or title carries the term either, `teach path candidates` prints it as `term "...": no path line covers it` with the matching entries from its pool (the `--topic` or `defaults.topics` topics, plus any mission or path term whose slug is a vault topic), or `(no entry)`.
- **Reviews are lines too** when the Constraints section of `MISSION.md` says `Path reviews: yes`: every six or seven lessons, named `Review of N to M`. With `Path reviews: no`, or no valid `Path reviews:` bullet, the path plans no review lines.
- **Projects close groups.** A title starting `Project:` is a project line: one whole task at the end of each group of two to five lines that together build one capability, with `after:` naming at least two lines (`teach lint` reports `PATH_PROJECT_AFTER` otherwise). Later projects integrate more lines, so projects run simple to complex across the mission. The lesson index groups lessons under the `Project:` line that closes their group.
- **Reorder freely; never delete a built line.** A built lesson that no longer fits moves to `parked/` and its line keeps `lesson:` with `parked` appended. Renumbering changes what `after:` means, so run `teach lint` after a reorder.
- **Cut a profile's path after the Floor is known.** Write a profile's path with every term and tool taken as new. After the Floor is known, propose to remove each line all of whose terms the learner showed, or whose tool the learner uses daily, and take a shown term out of a line that keeps other terms. Renumber the lines and their `after:` values. Join a `Project:` line left with fewer than two lines in `after:` into the next `Project:` line (in the one trial, `teach lint` reported `PATH_PROJECT_AFTER` for a project left with one line). Then run `teach lint`. Read the whole cut path to the learner and ask them to confirm it.
