# Plan: a research-orchestrate run captures one source for one document read at two addresses (issue 73) (2026-11-17)

<!-- evidence: 2026-11-17-lines-behind-plan-issue-73-at 2026-11-17-probe-issue-73-sentences-raw-file 2026-11-17-second-probe-issue-73-review-findings 2026-11-17-trial-issue-73-one-agent-runs 2026-11-17-second-trial-issue-73-one-agent -->

Issue 73 reports a research-orchestrate run that captured four sources for two documents: each ESLint rule doc came back once at its raw file address and once at its rendered page address. This plan changes the reference script and the prompts of `skills/research-orchestrate/SKILL.md`. The script marks a page that may be a second address of an earlier page, and the Write step tests the mark with the quote check before it captures that page. Nothing in it is built yet. This is the plan as revised after an adversarial review of its first draft, which made nine findings, B1 to B9. No review of this revision is recorded in the entries below.

The plan rests on five vault entries:

- The snippet 2026-11-17-lines-behind-plan-issue-73-at ("the snippet") quotes repo lines at commit c46a73f, the text of issue 73 and the output of five commands.
- The experiment 2026-11-17-probe-issue-73-sentences-raw-file ("the page probe") checks the sentences of six real pages against each other with `verify --quotes`, in a throwaway vault.
- The experiment 2026-11-17-second-probe-issue-73-review-findings ("the second probe") holds the review's findings one line each, the planned edits as a diff, and a run of the planned script with stub Workflow hooks.
- The experiment 2026-11-17-trial-issue-73-one-agent-runs ("the first trial") is one run of a real agent on the Write prompt of the first draft.
- The experiment 2026-11-17-second-trial-issue-73-one-agent ("the second trial") is one run of a real agent on the Write prompt of this revision.

A sentence about the code cites the snippet. A sentence about behaviour cites a probe or a trial. A sentence marked "Judgment" is this plan's choice, not a fact. No research-orchestrate run and no lane agent was run for this plan.

## What exists

<!-- evidence: 2026-11-17-lines-behind-plan-issue-73-at 2026-11-17-probe-issue-73-sentences-raw-file 2026-11-17-second-probe-issue-73-review-findings -->

- **What the issue reports.** On 2026-11-15 a run returned two ESLint rule docs twice, once as `raw.githubusercontent.com/eslint/eslint/main/docs/src/rules/<rule>.md` and once as `eslint.org/docs/latest/rules/<rule>`. Four sources were captured for two documents (the snippet, issue text). This is the issue's own report. The bound vault holds no source with an ESLint address, so this plan could not read those four entries (the snippet, last command).
- **The script keeps a page once per exact URL.** Lines 82 to 84 of the skill build a `Map` keyed on `p.url` and join the claims of two pages with the same key (the snippet).
- **The capture dedupes on address and version.** `bin/commands/capture.mjs` lines 51 to 57 treat an existing source as the same when its normalised address and its version key both match (the snippet).
- **The Write step captures every page first.** Step 1 of the Write prompt, at line 94, says "For each page below, one after another, run" the capture command. The quote check is step 3, at line 98 (the snippet).
- **`verify` passes the id it is given to `checkQuotes`.** That is `bin/commands/verify.mjs` lines 94 to 96 (the snippet). Each trial ran the check with one page's quotes and another page's source id.
- **A match ignores code marks, quote mark forms, dash forms and white space.** That is `soft` at `bin/lib/quotes.mjs` line 19 (the snippet).
- **A quote found adds a row to the source that was checked.** Lines 96 to 104 of `quotes.mjs` add one `quote-matched` row for a found quote whose hash the source does not hold yet (the snippet).
- **A raw file's sentences were all found in its rendered page.** In the page probe, 9 of 9 sentences of the eqeqeq raw file were found in the stored text of the eqeqeq rendered page, and 4 of 4 for no-var.
- **Most of a rendered page's sentences were found in its raw file.** 9 of 12 and 5 of 8 were found. The six that were not found are the same three sentences on both pages, and each is about the site's version, search or language controls (the page probe, the `not found` lines).
- **Sentences of a different document were found seldom or never.** Between two rendered pages of eslint.org, 3 of 8, 3 of 12 and 3 of 44 sentences were found. For every pair of different documents on two hosts the count was 0. Of the sentences the rule picked from the two pages named `no-unused-vars` on eslint.org and on typescript-eslint.io, none was found in the other page: 0 of 44 and 0 of 32 (the page probe).
- **The sentences of the page probe were picked by a rule, not by a lane.** The rule is in the probe's script. A lane picks "the claims on the page that bear on the question" (the snippet, SKILL.md line 71).
- **A lane's quotes have missed in real runs.** The changelog records a run in which "five of 29 quotes were not found", and issue 77 records 13 of 18 and 9 of 14 found. Both causes have been changed in the code since (the second probe, the two records).
- **`advise` pairs sources by address and by title.** `listNearDuplicates` at `bin/lib/advise.mjs` lines 115 to 133 pairs two live sources on one host that share more than half of their path segments, or whose titles share at least two terms and more than half of the longer title's terms (the snippet). It reads no quote row.
- **The skill file has a verdict.** `gate status` reports `MERIT` for it and `gate changed` reports no changed unit (the snippet, commands).

## Decisions

<!-- evidence: 2026-11-17-lines-behind-plan-issue-73-at 2026-11-17-probe-issue-73-sentences-raw-file 2026-11-17-second-probe-issue-73-review-findings -->

The exact text of every edit is the diff in the second probe. The lines below are copied from it.

**D1. The script marks a page that may be a second address of an earlier page.** After `const pages = [...byUrl.values()]` the script gains:

```javascript
// Issue 73: a raw file and its rendered page are one document at two addresses. A page with claims is marked when an
// earlier, unmarked page on another host has the same last path segment, less its extension, and the same version.
// The Write step tests the mark.
const stem = u => u.replace(/[?#].*$/, '').replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/\/+$/, '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase()
const host = u => u.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].toLowerCase()
pages.forEach((p, j) => {
  const s = stem(p.url)
  const i = pages.findIndex((q, k) => k < j && q.maybeSameAs === undefined && stem(q.url) === s && host(q.url) !== host(p.url) && (q.subjectVersion || '') === (p.subjectVersion || ''))
  if (i >= 0 && p.claims.length && s && s !== 'index' && s !== 'readme') p.maybeSameAs = i
})
```

The last line of the script also returns the mark: each row of `pages` gains `maybeSameAs: p.maybeSameAs` (B9).

With these lines, of nineteen stub pages five are marked (the second probe, stub output):

- The rendered page `eslint.org/docs/latest/rules/max-lines` is marked with the number of the raw file `.../rules/max-lines.md`. So is a page on a third host whose address has upper-case letters and a query string.
- A page of version 9.0 on eslint.org is not marked with the raw file, which has no version. A page of version 9.0 on a third host is marked with the eslint.org page of version 9.0 (B2).
- The second of two pages named `faq` on two hosts is marked with the first (B4).
- Two pages named `README.md` and `readme`, two named `index`, two addresses with no path, a page with another name and a page with no claims are not marked.
- A page is not marked with an earlier page on its own host, or with an earlier page that is marked.

Judgment on each part:

- **A mark, not a merge.** The script cannot read a page, so it cannot know that two pages are one document. The mark only says which pair the Write step tests.
- **Last path segment.** The two addresses in the issue end in `<rule>.md` and `<rule>` (the snippet, issue text). Judgment: a file and the page made from it often keep the file's name. A pair with different names is not marked and is captured twice, as today.
- **Another host, and the same version.** Judgment: two addresses on one host with one name are more often two versions of a document than one document, and versions are not this issue. For the same reason a page is not marked when the lane gave the two pages different versions.
- **Not `index` or `readme`.** Judgment: these two names say nothing about the document. A wrong mark costs one quote check, and a `quote-matched` row on the first page's source for each quote found whose hash that source does not hold yet, so the list is short.
- **An unmarked earlier page.** A marked page may get no source, so a later page is never tested against it.
- **No bare call outside the allowed list.** By the comment and the list at `test/skills.test.mjs` lines 123 to 127, a bare call in the script is to a Workflow hook, a keyword, a name the script defines, or `Map`, `Set`, `String`, `Number` or `Boolean` (the snippet). The three existing tests that the pattern `orchestrate` selects pass on the planned copy (the second probe).

**D2. The Write step tests the mark before it captures the page.** Step 1 of the Write prompt begins: "Leave out every page that has maybeSameAs: step 3 decides whether it gets a source." Step 3 ends with:

> Then take each page that has maybeSameAs, one after another: it may be the document of page <maybeSameAs>, read at another address. If page <maybeSameAs> has no source, or its status is failed, do steps 1 to 3 for this page as for any other page. Otherwise write this page's quotes file and run the same verify command on it with the sourceId of page <maybeSameAs>; this check gives that source no "text unusable" reason. If more than half of this page's quotes are found, the two pages are one document: run no capture and no fill for this page; its row has status reused, the sourceId of page <maybeSameAs>, the reason "same document as page <maybeSameAs>", no fill result, and quotesChecked and quotesFound from this check; judge its claims from this output, and a claim whose quote was not found is not verified. Otherwise they are two documents: do steps 1 to 3 for this page as for any other page.

Judgment on each part:

- **The test is "more than half" (B1).** In the page probe one document at two addresses had 5 of 8 sentences found at the least, and two documents on two hosts had none. Judgment: more than half lies between the two with room on each side. It lets a lane's quote miss, as the two records show quotes have missed, and it lets a quote of the site's own text miss when the raw file is the first page. The first draft's test was "every quote", which one miss defeats.
- **A claim whose quote was not found stays unverified.** That is the rule the Write prompt already has for any claim (the snippet, line 98). So a claim that rests on a sentence the first page does not hold is not filed as verified under that page's source.
- **No new status.** The row uses `reused`, which the `WRITTEN` schema at line 60 already has, and says the rest in `reason` (the snippet). `reused` then has two meanings, and the reason tells them apart (B6).
- **No change to the CLI.** The check is the `verify --quotes` command the Write step already runs (D5).
- **Rows on the first page's source.** A quote found in the test that the first page's source does not hold yet adds a `quote-matched` row to that source, also when the pages turn out to be two documents. Judgment: accepted. The row says the words are on that page, and that is true.

**D3. The phase table and the paragraph under the script say what a mark does.** In the table row for Write, "capture each `source`" becomes "capture each `source`, a page marked `maybeSameAs` only when the quote check says it is another document" (B8). After the sentence on `--discard` at line 113: "A page marked `maybeSameAs` gets no source of its own when more than half of its quotes are found in the text of the page the mark names: the Write step files its claims under that page's source, and a source row with the reason "same document as page ..." says so."

**D4. Degraded mode says the same in words.** Section 3 runs the Write step's steps with no script (the snippet, line 118), so the mark does not exist there. Its first paragraph gains: "The script's mark for one document at two addresses does not run here either: when two kept pages on different hosts have the same last path segment, less its extension, and that name is not "index" or "readme", check the second page's quotes against the first page's source before you capture the second. If more than half are found, capture no second source, judge the second page's claims from that output and file them under the first source; otherwise capture the second page as usual." The two names are in quotation marks, not code marks: an existing test reads every lower-case word in code marks on that line as one of the nine floating words (the second probe, the note under the test output).

**D5. Nothing changes in `bin/`.** `quotes.mjs`, `verify.mjs`, `capture.mjs` and `advise.mjs` stay as they are.

## The two trials

<!-- evidence: 2026-11-17-trial-issue-73-one-agent-runs 2026-11-17-second-trial-issue-73-one-agent -->

In each trial one agent was given the Write prompt of the planned skill for real pages, in a new throwaway vault. The pages were built by a lane stub, with quotes this session took from the pages' stored text; no lane agent ran. The agent was told nothing about the mark or the result looked for. In each trial the command log is the agent's report of what it ran, and the list of files and addresses is what this session read in the vault after the run.

**The first trial** used the first draft's wording, whose test was "every quote is found".

- Page 1, the rendered page of the rule doc no-var, was marked with page 0, its raw file. The agent checked the three quotes of page 1 against the source of page 0. All three were found. It ran no capture command for page 1, and its row for page 1 reads status `reused`, the source id of page 0 and the reason "same document as page 0".
- Page 3, the page `no-unused-vars` on typescript-eslint.io, was marked with page 2, the page of that name on eslint.org. Neither of its two quotes was found in the source of page 2. The agent then captured page 3, filled it and checked its quotes there, and both were found.
- The vault held three sources for the four pages after the run, and none had the address of page 1.

**The second trial** used the wording of D2.

- **Three of four found: one source.** Page 1, the rendered page of no-var, had four quotes, one of them a sentence about the site's version control. The agent checked them against the source of page 0, the raw file. Three were found. It ran no capture and no fill for page 1. Its row for page 1 reads status `reused`, the source id of page 0, the reason "same document as page 0", no fill result, 4 quotes checked and 3 found. It reported the claim whose quote was not found as not verified and filed it as a question.
- **None of two found: two sources.** Page 3, on typescript-eslint.io, was marked with page 2. Neither quote was found, and the agent captured page 3.
- **One of two found: two sources.** Page 5, the rendered page of eqeqeq, had one sentence of the document and one about the site's search control. It was marked with page 4, the raw file. One quote was found. The agent's reason reads "1 of 2 found, which is not more than half, so two documents", and it captured page 5.
- **The vault after the run.** It holds five sources for the six pages, and none has the address of page 1. The capture of the plan made seven entries with no error, and `lint` was clean.
- **One departure from the prompt, by the agent's own report.** Two capture commands ran at the same time, where the prompt says one command at a time. That rule is not in the lines this plan adds.

## Left out, and why

<!-- evidence: 2026-11-17-lines-behind-plan-issue-73-at 2026-11-17-probe-issue-73-sentences-raw-file 2026-11-17-second-probe-issue-73-review-findings -->

- **Telling each lane which addresses the other lanes took** (the issue's first option). The issue says this "needs a second pass", because lanes run in parallel (the snippet, issue text). Judgment: a second pass of lane agents costs more than the two page slots it would save. So the slot is still spent: the lane has read the second page before the script sees it. This plan stops the second source, not the second read.
- **A test of every pair of pages.** Judgment: without the mark the Write step would check each page's quotes against every earlier source, one command a pair. A flag that checks one file against several sources would be new CLI code and a new line of `docs/REFERENCE.md`. Build it when a run shows a pair of one document with two different file names.
- **A test of a page against a second earlier page (B5).** A page is tested against the first unmarked page of its name only. In the order site A, site B, raw file of B, the raw file is tested against A and never against B.
- **A pair marked by a shared quote.** Judgment: two lanes need not pick the same sentence, and the script would need a copy of `soft` to compare them.
- **Quote hashes in `advise`** (the issue's third option). It would list the pair after both sources exist. The issue's condition is that the run "captures one source" (the snippet, issue text).
- **A rule for which address is kept.** The first page of a pair keeps its address, raw or rendered.
- **`docs/RELIABILITY.md` and `docs/REFERENCE.md`.** Neither file names the mark (the snippet, the grep), and the CLI does not change. Judgment: `docs/RELIABILITY.md` restates the run directory, the retry rule and the quote row (`scripts/deps.mjs` line 36), and the mark is none of these.
- **A `COUPLINGS` row.** `AGENTS.md` line 18 asks for a row when two files depend on each other through a copied value, a printed string, a name or a format (the snippet). The name `maybeSameAs` is in the skill file and its test only. The fields of `verify --quotes` that the new sentences read are covered by the rows at lines 34 and 196.

## The commit

<!-- evidence: 2026-11-17-lines-behind-plan-issue-73-at 2026-11-17-second-probe-issue-73-review-findings -->

One commit, on a branch from `master`.

1. `test/skills.test.mjs`, one new test with two parts. Write it first and see it fail on the skill as it stands.
   - It runs the reference script with stub hooks and the nineteen pages of the second probe. It asserts the `maybeSameAs` value of each page in the Write prompt, and in the script's return value, as the probe's output shows them. In the probe, the marks change when any one of twelve conditions of D1's lines is removed, so this part fails for each of them.
   - It asserts that the script holds the two passages of D2, and that the skill holds the sentences of D3 and D4.
2. `skills/research-orchestrate/SKILL.md`: the seven edits of D1 to D4, as the diff in the second probe gives them. `planned.mjs` in that entry applies them and stops if a place is not found exactly once.
3. `CHANGELOG.md`: one line under `## [Unreleased]` that names issue 73, says what the mark is and what the Write step does with it, and gives the limits under "Not shown by this plan".
4. This plan, added with `git add -f`: `docs/specs/` is in `.gitignore` (the snippet, line 12).

**The gate on the skill file.** The skill file has a `MERIT` verdict now (the snippet, commands). The edits are at lines 43, 84 to 110, 113 and 118 of the skill. Judgment: the sections that hold those lines need a new verdict and the others keep theirs. Add this plan's five entry ids to the `evidence:` comments of those sections, then run the `research-claims-gate` skill on the file: two rounds, then a merit decision. No run of `gate changed` on the edited file was made for this plan.

**Checks before the commit** (the snippet, `AGENTS.md` lines 7 to 11): `npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`.

## Done when

<!-- evidence: 2026-11-17-lines-behind-plan-issue-73-at -->

- The new test passes, and fails when any code line of D1 is removed.
- The five checks pass on the commit.
- The issue's condition is "a run that is offered a raw file and its rendered page captures one source, with a test" (the snippet). The test shows the mark and pins the wording. A test cannot show what the Write agent does; each trial shows it once, with quotes a lane did not pick. Whether that meets the condition is for the issue's owner to accept.
- The issue is closed by its owner. The account this session runs as has read permission only on the upstream repo (the snippet, commands).

## Not shown by this plan

- No lane was run. How many of a lane's quotes from one address of a document are found in the text of the other address is not measured.
- A document at two addresses with two different last path segments is not marked, and is captured twice.
- Two documents on two hosts with one name are joined when more than half of the second page's quotes are also in the first, for example a page that quotes the other at length. The page probe saw no such pair.
- When a lane gives no version for either page, two versions of one document on two hosts with the same sentences quoted become one source at the first page's address.
- Each trial is one run of one agent. The first live run after the commit is the first real test.
