# Plan: `--help` after a command prints usage and runs nothing (issue 72, item 9) (2026-11-17)

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-item 2026-11-17-probe-issue-72-item-9-each 2026-11-17-second-trial-issue-72-item-9 2026-11-17-third-probe-issue-72-item-9 -->

Item 9 of issue 72 reports that `research-vault init --help` runs `init`. This plan makes the CLI answer `--help` or `-h` after any command with that command's row of the command table in `docs/REFERENCE.md`, or a pointer for a command with no row, and run nothing. The plan covers item 9 only. The other twelve numbered items of issue 72 stay open (the third probe). Nothing in it is built yet. This is the plan as revised after an adversarial review of its first draft, which made ten findings, R1 to R10. No adversarial review of this revision is recorded; the third probe answers questions that a claims gate on it asked.

The plan rests on four vault entries:

- The snippet 2026-11-17-lines-behind-plan-issue-72-item ("the snippet") quotes repo lines at commit a9f706f, the state of issue 72 and the text of its item 9.
- The experiment 2026-11-17-probe-issue-72-item-9-each ("the probe") runs each command with `--help` after its name in a scratch directory, counts the files each run changed and names up to three of them.
- The experiment 2026-11-17-second-trial-issue-72-item-9 ("the trial") holds the review's findings one line each, writes the revised edits into a copy of the repo, and runs the probe, the new test, the whole suite and eight changes to the dispatcher on it.
- The experiment 2026-11-17-third-probe-issue-72-item-9 ("the third probe") prints what `parseArgs` returns for each help form, runs the planned copy on other spellings of the flag, on the four commands that print their own usage and on `-h` after each command, and lists the numbered items of issue 72 and the part of line 63 of the orchestrate skill that names `--help`.

A sentence about the code cites the snippet. A sentence about behaviour cites the probe or the trial. A sentence marked "Judgment" is this plan's choice, not a fact.

## What exists

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-item 2026-11-17-probe-issue-72-item-9-each 2026-11-17-third-probe-issue-72-item-9 -->

- **What the issue reports.** Item 9 reads: "`research-vault init --help` runs `init` against the resolved vault (it stops only because the vault is not empty). Reproduced twice by accident. `--help` after a command should print usage." Issue 72 is open (the snippet).
- **The dispatcher checks `--help` only in the place of the command.** Line 9 of `bin/research-vault.mjs` prints the usage line and exits 0 when there is no command or the command is `--help` or `-h`. Otherwise line 30 refuses an unknown command, and lines 31 to 34 import the command's module and run it with the parsed arguments (the snippet).
- **The parser keeps `--help` as a key and `-h` as a word.** `parseArgs` in `bin/lib/args.mjs` gives a flag that is not in `BOOL` the next token as its value, or no value when the next token is absent or starts with `--`. `help` is not in `BOOL`. A token that does not start with `--` is pushed to `_` (the snippet). In the third probe, `init --help` gave the key `help` with no value, `init --help x` gave it the value `x`, and `init -h` gave `_` the words `init` and `-h`.
- **With no vault yet, `init --help` makes one.** In the probe, the vault path named by `RESEARCH_VAULT_PATH` did not exist. `init --help` exited 0 and changed 27 files, among them the config pointer `home/Library/Application Support/research-vault/config.json` under the scratch HOME. `init` writes that pointer when none exists yet (the snippet, `bin/commands/init.mjs` lines 96 to 103).
- **Two other commands write when given `--help`.** In the probe, `search --help` changed `vault/_index/usage.jsonl`, and `obsidian --help` changed two files under `vault/_obsidian/`.
- **The rest run, refuse or print their own usage.** In the probe, `lint`, `verify`, `manifest`, `compile`, `advise` and `export` ran and exited 0 with no file changed. `capture` and `related` exited 2 with an error about a missing value. `refresh` and `embed` exited 1 with a refusal. `check`, `gate`, `teach` and `host` printed a line starting "usage:" and exited 2. On the vault the first run made, `init --help` and `init -h` exited 1 with "target vault is non-empty (use --force to overwrite)".
- **`docs/REFERENCE.md` has a command table.** Lines 181 to 198 are a table with one row per command, each row starting `` | `<command>` | ``. It has rows for sixteen of the seventeen commands in the dispatcher's list; `host` has none and has its own section at line 322. The rows of `capture`, `verify` and `gate` end with an `<!-- evidence: ... -->` comment that lists vault ids (the snippet).
- **The docs file ships with the plugin.** `package.json` has no `files` key, and the installed plugin copy 0.12.1 holds `docs/REFERENCE.md` (the snippet).
- **Two coupling rows join the files this plan touches.** `scripts/deps.mjs` line 52 is `['bin/research-vault.mjs', 'docs/REFERENCE.md', 'the command table restates the commands map']`, and line 53 couples the dispatcher with `test/smoke.test.mjs` on the literal `--help`. By the comment at lines 22 to 27, a row fails the test when either file leaves the tree, and checks shared text only when it gives a literal (the snippet).
- **One test covers `--help`.** `test/smoke.test.mjs` line 7 runs the CLI with `--help` and no command. No test runs a command with `--help` after it (the snippet, the grep).

## Decisions

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-item 2026-11-17-second-trial-issue-72-item-9 2026-11-17-third-probe-issue-72-item-9 -->

The exact text of the edits of D1, D3 and D4 is the script and the diff in the trial.

**D1. The dispatcher answers help before it imports the command.** After the unknown-command check at line 30, `bin/research-vault.mjs` gains:

```javascript
// Issue 72 item 9: --help or -h after a command prints that command's row of the docs/REFERENCE.md command table,
// without its evidence comment, and runs nothing.
if ('help' in args || args._.slice(1).includes('-h')) {
  const doc = new URL('../docs/REFERENCE.md', import.meta.url);
  const head = `| \`${cmd}\` | `;
  const row = existsSync(doc) && readFileSync(doc, 'utf8').split('\n').find(l => l.startsWith(head));
  const text = row ? row.slice(head.length).replace(/\s*<!--[\s\S]*?-->/g, '').replace(/ \|$/, '').replaceAll('\\|', '|') : `see the ${cmd} section of docs/REFERENCE.md`;
  process.stdout.write(`research-vault ${cmd}: ${text}\n`);
  process.exit(0);
}
```

and an import of `readFileSync` and `existsSync` from `node:fs` at the top. With these lines, in the trial each of the seventeen commands given `--help`, and `init -h`, exited 0, printed a first line starting `research-vault <command>:` and changed no file. `init --help` with no vault yet left the vault directory absent. In the third probe, `-h` after each of the seventeen commands did the same. `host --help` printed `research-vault host: see the host section of docs/REFERENCE.md`. `capture --help` printed 2527 bytes.

Judgment on each part:

- **One check in the dispatcher.** Every command goes through lines 31 to 34, so one check covers all seventeen and a command added later. A check in each command would be seventeen edits and could be missed in an eighteenth.
- **After the unknown-command check.** `nosuch --help` still says "unknown command" and exits 1. The test asserts it (D3).
- **`'help' in args`.** `parseArgs` sets the key with no value for `init --help`, so a test of the value would miss it. When `--help` is followed by a word, the word becomes its value and the key is still set (the third probe).
- **`-h` only as a word after the command.** A `-h` given as the value of a flag is that value: for `search --text -h`, `parseArgs` gives `text` the value `-h` and puts nothing after the command in `_` (the third probe), so the help path is not taken. The test asserts that it prints no help (D3).
- **The row of the command table, not a usage string in each module.** Judgment: the table already says what each command takes. Seventeen new usage strings would be a second copy of it. The coupling row at line 52 gives no literal, so it does not check that the rows keep their form. The test of D3 checks that the dispatcher and the table agree on which commands have a row; nothing checks that a row keeps its form (below, "Not shown").
- **The evidence comment removed (R1).** It is for the claims gate, not for a person reading help.
- **A pointer when there is no row.** `host` has no row, and an installed copy without `docs/` would have no file. Judgment: the pointer is enough for one command; a `host` row is left out (below).
- **Exit 0 on stdout.** That is what `--help` with no command does at line 9 (the snippet).
- **`process.exit(0)` after the write.** The comment at line 34 says `process.exit()` truncates piped stdout at 64 KB. One row is far below that, and line 9 already exits this way (the snippet).

**D2. The four commands that print their own usage keep it.** In the third probe, on the planned copy, `check`, `gate`, `teach` and `host` with no argument still printed a line starting "usage:" and exited 2. Only `--help` and `-h` take the new path.

**D3. A test in `test/smoke.test.mjs`.** It reads the command list from the usage line of `bin/research-vault.mjs` and the command table from `docs/REFERENCE.md`. It runs each command with `--help`, and `init` with `-h`, in a new temporary directory, with a timeout of 20 seconds. HOME, `XDG_CONFIG_HOME` and `XDG_DATA_HOME` point into that directory, and `RESEARCH_VAULT_PATH` names a vault there that does not exist. For each run it asserts exit 0, a first line starting `research-vault <command>: `, the pointer exactly when the table has no row for the command, no `<!--` and no `\|` in the output, and an empty directory after the run. Then it asserts that `nosuch --help` exits 1 with "unknown command", and that `search --text -h` prints no help (R4).

In the trial the test passed on the planned copy. It failed with each of eight changes to the dispatcher, one at a time: the dispatcher of commit a9f706f put back, `'help' in args` removed, the `-h` test removed, `-h` matched anywhere in `process.argv`, the help check put before the unknown-command check, the comment not removed, the escaped bar kept, and `process.exit(0)` removed.

**D4. Coupling rows.** In `scripts/deps.mjs`:

- The reason text of the row at line 52 becomes "the command table restates the commands map, and <command> --help prints the command's row".
- The reason text of the row at line 53 becomes "the --help usage line is asserted in order, and the test reads the command list from it".
- A new row joins `test/smoke.test.mjs` and `docs/REFERENCE.md`: "the --help test finds each command's row of the command table by its start" (R5).

**D5. One line under `## [Unreleased]` in `CHANGELOG.md`** that names issue 72 item 9 and says what `<command> --help` and `<command> -h` print. `docs/REFERENCE.md` does not change (R2).

In the trial, with D1, D3 and D4 written into the copy, `npm test` gave 760 of 760, and the encoding and drift checks passed.

## Left out, and why

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-item 2026-11-17-probe-issue-72-item-9-each 2026-11-17-second-trial-issue-72-item-9 2026-11-17-third-probe-issue-72-item-9 -->

- **The other twelve items of issue 72.** The issue groups them under `bin/lib/capture-operation.mjs`, `capture` without `--operation-id`, "Elsewhere" and "Process" (the third probe). Judgment: each needs its own probe. Item 9's case wrote a vault and a config pointer where a person asked for help (the probe).
- **A sentence in `docs/REFERENCE.md` (R2, R3).** The review found (R2) that the section that holds the command table has no `evidence:` comment outside the rows, and that a change to it would reopen the whole section, rows and their citations, for the claims gate (the trial). Judgment: the changelog line is enough for this change.
- **A `host` row in the command table.** Judgment: `host` has its own section, and a row would be a second description of it. Add one if people ask for `host --help` to say more.
- **A usage string in each command module.** Judgment: a second copy of the table (D1).
- **Other spellings of the flag (R7).** On the planned copy, `init --help=1`, `init -help` and `init -H` each ran `init` and made a vault (the third probe). Judgment: the two spellings the issue and line 9 name are covered; a wider match is a change to how flags are read.
- **An error for an unknown flag.** `parseArgs` takes any `--<name>` (the snippet). A wrong flag is a wider problem than `--help`.
- **The warning in the orchestrate skill (R10).** Line 63 of `skills/research-orchestrate/SKILL.md` says a command without `--vault` "may read another vault, so run none without it, --help included" (the third probe). After this change that is stricter than needed, and it does no harm. Judgment: leave it, and leave the skill's claims verdict as it is.

## The commit

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-item 2026-11-17-second-trial-issue-72-item-9 2026-11-17-third-probe-issue-72-item-9 -->

One commit, on a branch from `master`.

1. `test/smoke.test.mjs`: the test of D3. Write it first and see it fail on the CLI as it stands.
2. `bin/research-vault.mjs`: the lines and the import of D1.
3. `scripts/deps.mjs`: the three changes of D4.
4. `CHANGELOG.md`: the line of D5.
5. This plan, added with `git add`, with `-f` when `git check-ignore` reports its path as ignored. It needs a `PASS` or `MERIT` claims verdict for its content (R9): run the `research-claims-gate` skill on it before the commit if it changed after its gate.

The script in the trial writes the edits of steps 1 to 3 into a copy and stops if a place is not found exactly once.

**Checks before the commit** (AGENTS.md lines 7 to 11, the snippet): `npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`.

## Done when

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-item 2026-11-17-second-trial-issue-72-item-9 2026-11-17-third-probe-issue-72-item-9 -->

- The new test passes, and it fails with the dispatcher of commit a9f706f.
- The five checks pass on the commit.
- Item 9's condition is "`--help` after a command should print usage" (the snippet). The test shows each command printing a line that starts `research-vault <command>: ` and contains the pointer's words exactly when the table has no row for the command, and writing nothing in its temporary directory. It does not compare the line with the row's text.
- Issue 72 stays open for its other items. A comment on it says item 9 is done.

## Not shown by this plan

- The trial ran on darwin only. On another platform the config pointer has another path (`bin/lib/resolve.mjs` lines 19 to 24, the snippet); the test checks the whole temporary directory, so it does not name that path.
- No run used an installed copy without `docs/`. The pointer for that case is in D1's code, and only `host` exercised it in the trial.
- Nothing checks that a row keeps the form the dispatcher looks for. By the code of D1 and D3, not run: if a row lost its form, that command would print the pointer, and the test would expect the pointer too.
- A row is printed as written in the table, with its code marks, on one line. No person has read the output in a terminal for clarity.
