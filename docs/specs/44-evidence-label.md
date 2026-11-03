# Spec 44: the fact label, the reading page's wording, and a way back from the reading page (issue #53)

Round 1 (2026-11-03), on master at 14be4fb. The repo lines this spec names are quoted in snippet 2026-11-03-lines-behind-specs-43-45-at at 14be4fb; the issue is #53 per the quoted `CHANGELOG.md` line ("the fact label and the reading page's lab, run and command wording (#53)"). The example label stays, per the same `CHANGELOG.md` quote of spec 42 ("the `example` block stays a run"). The user added one point while this batch was in progress, as the author's account: on the served reading page the only way back to any other page is the browser's back button. This spec decides the wording, the link and the checks, and is judgment where it says so.

## What exists, in one paragraph

The stylesheet labels the fact block "what the lab showed" (lesson.css line 73) and the example block "the output, read with me" (line 75); the reading page carries the same `aria-label` values (reading.html lines 28 and 32) and explains the fact block as "What the run established, in short" (line 29), the example as "A command and what it printed" (line 33) and the step as "One real action to take unaided: the command to run and what you should see" (line 49); it holds one `href`, its stylesheet link (line 6), and no `<a>` element in its quoted lines 1 to 80 (the whole file, 76 lines). The served index links to it ("How to read a lesson", bin/lib/teach.mjs line 426) and the navigation widget adds a "How to read" link (quiz.js line 75). LESSON-FORMAT.md's block table carries the labels (lines 26 and 27) and its example lesson carries both (lines 180 and 185); every block's `aria-label` equals the stylesheet's label (line 18). Two rows of `COUPLINGS` tie the format's label column to the stylesheet's `::before` content (scripts/deps.mjs line 107) and the reading page's sections to the format's label column (line 109); the `COUPLINGS` row at line 133 says the format's example is byte-identical to `test/fixtures/teach/lessons/0001-good.html`, and test/skills.test.mjs lines 54 to 58 assert it. The reading-page test (test/teach-store.test.mjs lines 357 to 366) asserts `aria-label="<label>"` is in the page for every label of the format's table; the quoted `grep -n "::before" test/*.mjs` matched nothing (exit 1), so no file matching `test/*.mjs` contains `::before`, and neither quoted test compares the stylesheet's labels with the format. The fact label occurs once in 0001-good.html, once in 0005-diagnose-fx.html, twice in the format and once each in the reading page and the stylesheet, and the example label once in 0001-good.html and 0004-tool-fxctl.html (the quoted `grep -c` blocks). The build copies the components with `cp -n`, which "never overwrites a copy the workspace has edited" (SKILL.md lines 83 and 86), and `assets` is among `STATIC_DIRS` (teach.mjs line 320).

## Design

### D1. The fact label

"what the lab showed" becomes "what the evidence shows" in lesson.css line 73, reading.html line 28, LESSON-FORMAT.md lines 26 and 180, 0001-good.html line 25 and 0005-diagnose-fx.html line 32: every file the fact-label `grep -c` block lists with a count above zero. The example label stays (per the quoted `CHANGELOG.md` line, "the `example` block stays a run"), so 0004-tool-fxctl.html and lesson.css line 75 are untouched.

### D2. The reading page's three sentences

Line 29 becomes "What the evidence established, in short: one cited claim per paragraph, read before the example block, which walks through the same run when there is one." Line 33 becomes "A command and what it printed, with a sentence before each saying what to look at. Follow the sentence, then look at the output." (unchanged: the example block stays a run). Line 49 becomes "One real action to take unaided: the command to run, or the thing to produce, and what you should see. Do it; the result is your attempt." These match the `CHANGELOG.md` line for spec 42, LESSON-FORMAT.md line 26's "by the probe or by the passages the plan lists", and the step wording Issue B of the issues file asks for (its What remains, quoted).

### D3. A way back

The reading page gets one navigation line under its heading: `<p class="reading-back"><a href="/">Back to the lessons</a></p>`, the same root the served index renders (`teach serve` "renders an index of every lesson at `/`", SKILL.md line 86). Judgment: a link to `/` rather than to the lesson the learner came from, since the page is reached from the index and from every lesson's navigation bar and has no way to know which. No new stylesheet rule.

### D4. The stylesheet labels get their test

A test in `test/teach-store.test.mjs` beside the reading-page test: for every label in the format's Blocks table, `lesson.css` contains `content: "<label>"`. It gives the `COUPLINGS` row at line 107 the check the row at line 109 already has, and it fails if D1 changes the format and not the stylesheet. The test also asserts the reading page contains `href="/"` (D3).

### D5. Existing workspaces

The build step, item 4 (SKILL.md line 81), gains one sentence after line 86's `cp -n` note: "After a plugin upgrade that changes a component, delete the workspace's copy (`assets/lesson.css`, `assets/reading.html`) before the next build so `cp -n` delivers the new one; built lessons keep their `aria-label` text, which still describes them." Judgment: built lessons are left alone, since their old label is a true description of a probed lesson and none of the quoted lint rules reads the attribute.

### D6. Not done here

The `COUPLINGS` rows stay as they are; D4 adds the test, not a row. No change to `teach serve` or the widget: the link is in the page.
