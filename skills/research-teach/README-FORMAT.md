# README.md Format

`README.md` lives at the workspace root, beside `MISSION.md`. It introduces the program to a learner who has not opened a lesson and says how to take it. `teach readme` drafts its last two sections; the author writes the rest. `teach serve` shows it at `/`, the address it prints, above the lesson index, when it is a regular file the server can read (a symlink is not followed). `teach export` puts it at the top of the copy's `index.html` the same way, with the body of `## How to take it` replaced (Rules).

## Template

```md
# {Program title}

## What this is for
{What the learner will be able to do at the end, and who the program is for, in plain terms.}

## Before you start
- {One bullet per Known tool and Known term of MISSION.md's Floor, said so a newcomer can check themselves against it}

## How to take it
{How to get the plugin, how to start `teach serve` and open the lesson index in a browser, and where attempts are written.}

## Lesson map
| Group | Lessons | What it builds |
|---|---|---|
| {the group} | {its lesson ids, a review lesson marked (review)} | {what the group builds, in Floor words} |

## Labs
| Lesson | Files | Needs on the learner's machine | Fallback |
|---|---|---|---|
| {lesson id} | lessons/files/{folder}/ | {tools, access, and where any credentials come from} | {what to do on a machine that cannot run it} |
```

## Rules

- **Five sections, in this order, under these `##` headings.** A workspace with no lab files says so under `## Labs`.
- **Written for the learner.** Every term is a Known term or is said in plain words; a New to me term, or a term a lesson introduces, is not used. No link into the vault or `evidence/`, and no account of how the lessons were checked; those are for the author.
- **Draft the tables, then write the prose.** `teach readme [workspace]` prints `## Lesson map` with one row per group of built lessons, in the order of each group's first lesson, groups whose `Project:` lines share a title sharing one row: the Group cell is the title of the first `Project:` line at or after the lesson's `PATH.md` line, or `(no Project: line)` for a lesson with none or off the path; the Lessons cell lists the ids, each review lesson's followed by `(review)`; the last cell is empty. Then `## Labs`, with one row per directory under `lessons/files/`: the built lesson whose number begins the directory's name, `lessons/files/<directory>/`, and two empty cells, the Lesson cell empty when no built lesson matches, or the line ``No lesson ships files under `lessons/files/`.`` when there is none. It writes nothing. Redirect it into `README.md`, rewrite a Group cell that uses a lesson's term, and fill the empty cells.
- **How to take it, in an exported copy.** Write the section for a learner using `teach serve`. In a copy written by `teach export`, which has no server, `index.html` shows `Open the lessons below in order. Your quiz answers are kept in this browser; use Export my results on the Progress page and send the file to your instructor.` in place of the section's body; the file itself is unchanged.
- **Gated like a lesson.** `teach lint`, then the `lesson-reader` in README mode, then the claims gate. Once every `PATH.md` line has a lesson, `teach next` prints `readme: missing`, `readme: ungated` or `readme: ok` after `fringe: complete`: no `README.md` file, no `PASS` or `MERIT` for its current content (or no ledger to read), or one.

## What lint checks

`teach lint` reads `README.md` when the workspace has one. Fenced code and the target of an inline Markdown link are not read for terms.

- `README_TERM_NOT_INTRODUCED`, a finding: a term on the Floor's New to me list or in a lesson's `data-introduces` that is not a Known term, with the same term regex as `LESSON_TERM_NOT_INTRODUCED`.
- `WARN_README_EVIDENCE_LINK`, advisory: a vault entry's id outside code, or an inline Markdown link outside code whose target is under `evidence/` or in the vault, once per link target as written; a reference-style link and an `<a href>` are not read. Advisory because `gate evidence` lists the entries a draft cites, so an id may be what one of its claims needs.
- `WARN_README_SECTION_MISSING`, advisory: one of the five `##` headings is absent.
