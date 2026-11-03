# Spec 45: a README section for a learner who is not a developer (issue #54)

Round 1 (2026-11-03), on master at 14be4fb. The repo lines this spec names are quoted in snippet 2026-11-03-lines-behind-specs-43-45-at at 14be4fb; the issue is #54 per the quoted `CHANGELOG.md` line ("a README section for a learner who is not a developer (#54)"). This spec decides the section's text and where it goes, and is judgment where it says so.

## What exists, in one paragraph

The README's Install section is four Claude Code commands, a clone-and-run pair and a paragraph on binding a repo (README.md lines 53 to 71); the Day to day section opens "In Claude Code you mostly just talk" and its table has one row for "teach me X" (lines 73 to 88), followed by "Each of these is also a slash command." (line 88) and the "How a vault is organized" heading (line 90). The page says "Nothing to install beyond Node." (line 24) and carries a Node 22 badge (line 7). `research-init` runs `init` and tells the user the printed `RESEARCH_VAULT_PATH` profile line (commands/research-init.md line 5); the teach skill runs `init --project` first when the repo is not vault-bound (SKILL.md line 13), asks the interview as dialog questions, one per term or tool, up to four per call (lines 41 to 46), serves the lessons with an index at `/` and a navigation bar on each (line 86), records the quiz attempt itself when the page is served (line 102), and reminds the learner in every lesson that follow-up questions go to the terminal (line 74; reading.html line 73). The REFERENCE row describes the pipeline (docs/REFERENCE.md line 32).

## Design

### D1. Where

One section, `## Learning something`, between the Day to day table's closing line (line 88) and `## How a vault is organized` (line 90), landing after spec 43 (issue #52), whose Issue B (quoted) removes the terminal assumptions in the interview, the step and the reader persona. Judgment: it sits where a reader who skimmed the table's "teach me X" row looks next, and it does not touch the Install section, which is for every reader.

### D2. The text

> ## Learning something
>
> This section is for someone learning a topic rather than building software, and it assumes Claude Code. You need Node 22 or newer; the four install lines above are typed into Claude Code, and the last of them prints a `RESEARCH_VAULT_PATH` line to add to your shell profile so later sessions find your vault.
>
> Start Claude Code in a project folder (a repo) you want the lessons kept in and say "teach me X". The agent binds the folder to your vault itself, then asks an interview as multiple-choice questions in its dialog, one per term or tool it needs to know about, in groups of up to four, and writes a mission and a path of lessons from your answers. Each lesson is a web page served on your own machine, with an index of every lesson and a navigation bar. Concept, diagnose and review lessons carry a quiz; answered on the served page, it records your score. Every lesson reminds you that questions about the page go back to the terminal, where the agent answers them.
>
> Claude Code runs in a terminal (our framing of the install steps, not a rule the tool states), so opening one and starting Claude Code is the first step for everyone.

The first sentence states the section's audience and assumption, not a fact about the plugin. The statements about what the plugin does are the quoted lines: Node (README line 24 and the badge at line 7), the install lines typed into Claude Code (line 55 "In Claude Code:" and the four commands at lines 58 to 61), the profile line (commands/research-init.md line 5), binding a repo (SKILL.md line 13), the dialog questions (line 39, one to four per call) one per term or tool (lines 44 and 45), the mission and path (lines 37 and 39), the served index and navigation bar (line 86), the quiz in the `concept` and `diagnose` middles (LESSON-FORMAT.md lines 47 and 49) and in a review lesson (lines 130 to 132), optional in `tool` and absent from `project` (lines 48 and 50), recording the attempt on the served page (SKILL.md line 102), and the terminal reminder (line 74). The third paragraph is the author's framing, and its parenthesis is the clause Issue D asks for.

### D3. The check

The binding gates `docs/**/*.md` (AGENTS.md line 11), which README.md does not match, so the Stop hook's check (docs/REFERENCE.md line 44) does not reach it. The section is still run through the claims gate by hand, with this spec's snippet as evidence, and the verdict goes in the gate log; that is the issue's Done-when read for a file the binding does not cover. The quoted `grep -rln README test/` matched test/gate.test.mjs and test/init.test.mjs, so `npm test` is run after the edit; the encoding script at AGENTS.md line 10 checks tracked `.md` files.

### D4. Not done here

No change to Install, to the Day to day table or to REFERENCE. No GUI or hosted front end.
