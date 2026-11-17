# Plan: the orchestrate reference script stops losing page slots (issues 74, 75 and 76) (2026-11-17)

<!-- evidence: 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-probe-orchestrate-reference-script-stub-hooks 2026-11-17-probe-orchestrate-skill-s-gate-state 2026-11-17-second-probe-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot -->

A research-orchestrate run reads at most a fixed number of pages. Issues 74, 75 and 76 each report pages that a lane returned and the run could not check, so the slot was lost. This plan changes the reference script of `skills/research-orchestrate/SKILL.md` so that it no longer hands the Write step an `http://` address that has an https form, or a version on a floating address, and it steers the lanes away from the third case. Nothing in it is built yet. This is the plan as revised after an adversarial review of its first draft, which made eight findings, A1 to A8. By its author's own statement, the revision has had no adversarial review.

The plan rests on five vault entries:

- The snippet 2026-11-17-lines-behind-orchestrate-page-slot-plan ("the snippet") quotes repo lines at commit 237720a, the text of issues 74, 75 and 76, item 8 of issue 72, and the session record.
- The snippet 2026-11-17-second-lines-behind-orchestrate-page-slot ("the second snippet") quotes further repo lines, issue 73 and item 12 of issue 72.
- The experiment 2026-11-17-probe-orchestrate-reference-script-stub-hooks ("the script probe") runs the reference script with stub Workflow hooks, as it stands and with the lines of this plan's first draft.
- The experiment 2026-11-17-second-probe-orchestrate-page-slot-plan ("the second probe") holds the review's findings one line each, a run of the script with the revised lines, and a count of the bound vault's sources by address form.
- The experiment 2026-11-17-probe-orchestrate-skill-s-gate-state ("the gate probe") shows the claims verdict state of the skill file in this checkout and the account's permission on the upstream repo.

A sentence about the code cites the snippet. A sentence about behaviour cites a probe. A sentence marked "Judgment" is this plan's choice, not a fact. No Workflow run and no research-orchestrate run was made for this plan (the snippet, session record).

## What exists

<!-- evidence: 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-probe-orchestrate-reference-script-stub-hooks 2026-11-17-second-probe-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot -->

- **The lane prompt.** One prompt, at line 68 of the skill, asks each lane for page objects. It says "For a file on a code host give the address of the raw file" and asks for "subjectName and subjectVersion if the page is about one version of a tool". It does not name https, and the skill file does not hold the word "pdf" in any case (the snippet, SKILL.md line 68 and the first grep).
- **The script keeps a page once per exact URL.** Lines 71 to 73 build a `Map` keyed on `p.url` and join the claims of two pages with the same key (the snippet). Between the lanes' return at line 69 and that step the script changes no field of a page.
- **The fill refuses an address that is not https.** `bin/lib/fill.mjs` line 73 returns a refusal with the reason `source_url is not https`, and `bin/lib/quotes.mjs` line 52 returns the same error (the snippet). `verify --quotes` calls `checkQuotes` of that file (the second snippet, `verify.mjs` lines 10, 94 and 95).
- **The fill answers `version-floating` for a version on a floating address.** Line 74 of `fill.mjs` tests two things together: the source has a `subject.version`, and a segment of the address's path, in lower case, is in `FLOATING`. Line 15 defines `FLOATING` as nine words: latest, master, main, stable, current, head, nightly, dev and trunk. The name `FLOATING` occurs only on those two lines of the files searched, and `fill.mjs` does not export it (the snippet, the second and third greps).
- **A source can hold a subject name with no version.** `bin/commands/capture.mjs` line 80 writes `subject` when a name is given and stores the version as an empty string when none is (the snippet). An empty string does not meet the test at `fill.mjs` line 74.
- **A PDF whose bytes hold a zero byte gives no text; issue 75 reports three that did.** `extractText` returns null for bytes that, once any gzip layer is removed, hold a zero byte (`bin/lib/extract.mjs` lines 63 and 64), and the fill answers `no-text` for a text shorter than `MIN_BODY_CHARS` (`fill.mjs` lines 87 and 88; the snippet). `--content-file` takes only a .html, .htm, .txt or .md file (lines 16 and 66).
- **The capture dedupes on address and version together.** `capture.mjs` line 51 treats an existing source as the same when its normalised address and its version key both match (the snippet). The skill says so at line 113: the same URL "with none where one was recorded, is captured as a new entry".
- **The Write prompt gives the two subject flags in one bracket.** Line 84 of the skill ends the capture command with `[--subject-name <subjectName> --subject-version <subjectVersion>]` (the snippet). It does not say what to pass for a page with a name and no version (A1).
- **For the one pair of addresses probed, the http and https forms do not normalise to one value.** `normalizeUrl`, which `capture.mjs` line 46 calls, gave two different values for them (the snippet; the second probe, last output line of the script run; A3).
- **What the issues report.** Issue 74: four ESLint pages at `/docs/latest/` and `/main/` addresses, each with a `subjectVersion` such as "main branch docs (latest)", all answered `version-floating`. Issue 76: one page at an `http://` address, captured, then refused by the fill and by the quote check; four claims dropped. Issue 75: three papers at PDF addresses, 21 quotes unchecked (the snippet, issue texts). These are the issues' own reports; this plan did not repeat those runs.
- **The script can be run without the Workflow tool.** With stub hooks and the script as it stands, six lane pages reach the Write prompt as six pages. The `http://` page and its `https://` twin are two pages, and the `/docs/latest/` page keeps its `subjectVersion` (the script probe, first run).

## Decisions

<!-- evidence: 2026-11-17-second-trial-planned-skill-edits-widened 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-probe-orchestrate-reference-script-stub-hooks 2026-11-17-second-probe-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot -->

**D1. The script, not the lane prompt, repairs an address (issues 74 and 76).** Judgment: a prompt sentence holds only when the lane obeys it, and a line of script holds every time. The script gains these lines between line 69 and the comment at line 70:

```javascript
// Issue 76: the fetcher is https-only, so an http address is tried in its https form.
// Issue 74: capture --fill answers version-floating for a version on a floating address, so the version is dropped.
// The words are FLOATING in bin/lib/fill.mjs.
const FLOATING = /\/(latest|master|main|stable|current|head|nightly|dev|trunk)(\/|$)/i
for (const p of researched) {
  p.url = p.url.replace(/^http:\/\/(?=[^/?#:]*([/?#]|$))/i, 'https://')
  if (FLOATING.test(p.url.replace(/[?#].*$/, '').replace(/^https:\/\/[^/]*/i, ''))) delete p.subjectVersion
}
```

With these lines in place, ten lane pages reach the Write prompt as nine (the second probe; the first draft's lines are in the script probe, and A4 and A5 changed them):

- The `http://` page becomes its `https://` form and joins its twin, with the claims of both.
- The `/docs/latest/` page keeps its `subjectName` and has no `subjectVersion`. So does a page given as `HTTP://Example.com/Docs/Main/x`.
- A page at a tagged address (`/v10.15.0/`) keeps its version. So do a page with `main` only in its query string, a page with the segment `mainline`, and a page with no path and `/main/` in its query string (A4).
- An `http://` address with a port, or with a user name and password, is left as it is (A5). `fill.mjs` line 73 returns a refusal for an address that is not https (the snippet).

Judgment on each line:

- **https form.** The rewrite is for an address with no port (A5). Judgment: a port on an http address is not a safe guess for the port of its https form. The Write step passes the https address as `--url`, and the fill and the quote check read the source's `source_url`. `fill.mjs` lines 79 and 80 return `unreachable` when the fetch throws or answers 400 or above. Judgment: the page's claims are then lost, as issue 76 reports they are today. The fetcher's https-only rule is not touched. The cost: the stored address is not, letter for letter, the one the lane read.
- **Version dropped.** Issue 74 calls the refusal "right for a pinned version". Judgment: a version on a floating address says more than the address can hold. Without the version the source says only what was read. The subject name stays, because line 80 of `capture.mjs` accepts a name alone.
- **Regular expression, not `new URL`.** The script must stay a Workflow script, and the test at `test/skills.test.mjs` lines 121 and 122 parses it. This plan did not check whether a Workflow script may call `new URL`, so the lines use a regular expression and string methods, not `new URL`.
- **No log line.** The return value at line 99 lists each page's `url`. Nothing more is added.

**D1b. The Write prompt takes each subject flag by itself (A1).** The bracket at line 84 becomes `[--subject-name <subjectName>] [--subject-version <subjectVersion>]`, followed by: "Pass each of the two only when the page has that field; never make up a version." Judgment: without this the writer could drop the name too, or put a version back, and a version put back brings `version-floating` back. This also puts part of the answer in the Write step, which is one of the two places issue 74 names (A8).

**D2. The lane prompt steers away from a PDF (issue 75).** The prompt at line 68 gains one sentence after the code-host sentence: "A PDF cannot be checked: where a paper or a report has an HTML page of its full text, read that page and give its address; give a PDF address only when there is none, and its quotes will then stay unchecked." Judgment: only the lane can do this, because only the lane searches, so this one is a prompt sentence and holds only as far as the lane obeys it.

**D3. No PDF reader is built (issue 75's decision).** The project has no dependencies (the snippet, `AGENTS.md` line 17). Judgment: a PDF reader is a large piece of code for one kind of source, and this plan read nothing about the PDF format to size it. `fill.mjs` takes a .txt file with `--content-file` (line 66), so a person who needs a paper's text converts it to a .txt file and runs `capture --fill <id> --content-file <file> --ack-data-egress`. No run of that command on a source that answered `no-text` was made. `fill.mjs` line 57 throws without that flag (the experiment 2026-11-17-second-trial-planned-skill-edits-widened). Section 2 of the skill gains one sentence that says so, after the sentence on `--discard` at line 102 (A6; the second snippet).

**D4. Degraded mode says the same in words.** Section 3 of the skill says "With no Workflow tool, run the same three steps inline and sequentially" (the second snippet, line 106). Judgment: D1's lines are part of the script, so a session that follows section 3 does not run them. Its first paragraph gains one sentence: give an `http://` address with no port in its `https://` form, and pass no `--subject-version` for an address with a floating segment.

**D5. Nothing changes in `bin/`.** `fill.mjs`, `quotes.mjs` and `capture.mjs` stay as they are. The Write prompt keeps `version-floating` in its list of fill results.

## Left out, and why

<!-- evidence: 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-second-probe-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot -->

- **A prompt sentence that asks for a tagged address on a code host** (an option in issue 74). Judgment: D1 already drops the version that makes the fill answer `version-floating`. A tagged address is better evidence, and it can be added when a run shows the need.
- **A retry in the Write step** (an option in issues 74 and 76). Judgment: D1 acts before the capture, so there is nothing to retry.
- **Second sources for addresses the vault already holds (item 8 of issue 72; A2 and A3).** The capture dedupes on address and version together (the snippet, `capture.mjs` line 51 and SKILL.md line 113). So when a run reads a floating address that the vault holds with a version, the script hands the Write step no version. Judgment: the capture then makes a new entry, and the vault has two sources for that address. Of the 890 sources with a `source_url` in the bound vault, 90 have a floating path segment and 54 of those hold a version (the second probe, count). Each of the 54 gets a second source only if a later run reads that address again. Judgment from that one pair: an earlier source at an `http://` address is not reused either. The bound vault holds none (the same count). Judgment: accepted. The older source keeps its version and its history, the new one is the one that can be filled, and `advise` or issue 72 is the place to pair them.
- **Issue 73** ("one page read at two addresses is captured as two sources": a raw file and its rendered page; the second snippet). D1 joins only the http and https forms of one address.

## The commit

<!-- evidence: 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-probe-orchestrate-skill-s-gate-state 2026-11-17-second-probe-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot -->

One commit, on a branch from `master`.

1. `skills/research-orchestrate/SKILL.md`: D1's lines, D1b's bracket and sentence, D2's sentence, D3's sentence, D4's sentence.
2. `test/skills.test.mjs`, one new test with three parts:
   - It runs the reference script with stub hooks and the ten pages of the second probe, and asserts what that probe's second run shows. One page is in upper case in its scheme and in its path, so the test is meant to fail when the `i` flag of the rewrite or of `FLOATING` is removed (A7). No run has shown that yet.
   - It reads the nine words from the text of `bin/lib/fill.mjs` and from the script's `FLOATING` line and asserts that the two lists are equal.
   - It asserts that the script holds D1b's bracket and sentence and D2's sentence, and that the skill holds D3's and D4's sentences (A7).
3. `scripts/deps.mjs`: the row at line 200 already couples `fill.mjs` and the skill on `version-floating`. One new row couples them on the copied word list, since `AGENTS.md` asks for a row when two files share a copied value.
4. `CHANGELOG.md`: one line under `## [Unreleased]`, naming issues 74, 75 and 76 and the decision of D3.
5. This plan, added with `git add -f`.

**The cost that is not code.** `skills/**/*.md` is a gated path in this repo's binding. In this checkout the skill file has no verdict: `gate status` reports `none` and lists every section as changed, and the two ids on its `evidence:` comment are not in the bound vault (the gate probe). `AGENTS.md` line 11 says every staged gated file must carry a verdict for its current content. Judgment: `gate staged --check` will refuse the commit until the whole skill file has a verdict here, not only the five edited places. No run of it on a staged edit of the skill was made. Judgment: gate the whole file once, against evidence rebuilt in this vault (line snippets for what the skill says about the CLI, and the script probe), two rounds and then a merit decision. This is the larger part of the work, and it is the condition item 12 of issue 72 describes (the second snippet).

**Checks before the commit** (the snippet, `AGENTS.md` lines 7 to 11): `npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`.

## Done when

<!-- evidence: 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-probe-orchestrate-skill-s-gate-state -->

- The new test passes, and fails when any of D1's code lines is removed.
- The five checks pass on the commit.
- Each issue's own condition is met as far as a test can show it. Issue 74's condition is "the reference script's lane prompt or Write step handles it, with the wording pinned by a test". D1's lines sit in neither place; they run between the two. D1b is in the Write step, and the test pins its wording. Whether that meets the condition is for the issue's owner to accept. Issue 76 asks that the script cover it with a test and that the https-only rule is not weakened. Issue 75 asks that "a decision is recorded, and at least the lane prompt steers away from PDF-only addresses".
- The three issues are closed by their owner. The account this session runs as has read permission only on the upstream repo and could not close an issue written by `andrew-brooks-GA` (the gate probe).

## Not shown by this plan

- No lane was run. Whether a lane obeys D2's sentence, and how often an http page has an https form with the same words, are not measured.
- An `http://` address with a port is still refused, and its slot is still lost.
- The nine words are also ordinary directory names. A page under a directory named `dev` or `current` loses its version with no need. The cost is one field of one source and, for an address the vault holds with a version, a second source (see "Left out, and why").
- The first live run after the commit is the first real test of D1 and D2.
