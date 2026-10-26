# PATH.md Format

`PATH.md` lives at the workspace root. It is the curriculum: the lessons planned from the mission interview, in order, one line each. `teach next` prints the first line no lesson has taken. The learner confirms the path before lesson one and may reorder it at any time.

## Template

```md
# Path: {Topic}

1. {The win, as a short title} | terms: {a, b} | after: floor
2. {The win} | terms: {c} | after: 1
3. {The win} | tool: {x} | after: 1, 2
4. Review of 1 to 3 | after: 3
```

## Fields

- The number and title are required. The title is the win in a few words.
- `terms:` names the terms the lesson introduces, at most three, matching the lesson's `data-introduces`.
- `tool:` names the one tool the lesson teaches, matching the lesson's `data-teaches`.
- `after:` lists prerequisite line numbers, or `floor`.
- `lesson:` is added when the lesson is built, with the lesson id. `teach lint` checks the built lesson against its line.

## Rules

- **One new thing per line.** A line with both `terms:` and `tool:` is two lessons.
- **Every "New to me" term appears on a line** before any line that needs it. The Floor is the only other source of allowed terms.
- **Reviews are lines too**, every six or seven lessons, named `Review of N to M`.
- **Reorder freely; never delete a built line.** A built lesson that no longer fits moves to `parked/` and its line keeps `lesson:` with `parked` appended.
