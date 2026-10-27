# Spec 13: scaffolding, writing and code fixes from the 2026-10-26 review

Round 5 (2026-10-26). A review of the plugin at 08c39b6 against the Claude Code docs captured the same day (vault note 2026-10-26-claude-code-plugin-best-practices-hooks: 47 numbered claims, each a quote or close paraphrase tagged with its source page; the hooks page itself is 2026-10-26-claude-code-hooks-reference), a code pass whose cited lines are quoted in the snippet 2026-10-27-research-vault-code-lines-cited-by, and a research pass on why "speak like you're talking to a human" may improve generated documents (vault synthesis 2026-10-26-why-talking-human-framing-improves-generated and its notes 2026-10-26-anthropic-prompting-guidance-give-reason-name and 2026-10-26-length-density-pressures-rlhf-length-bias). The repo lines this spec relies on are quoted verbatim at 08c39b6 in the snippets 2026-10-26-research-vault-plugin-scaffolding-lines-reviewed, 2026-10-26-research-vault-plugin-wording-that-sets and 2026-10-27-research-vault-code-lines-cited-by; the CLI behaviour in problem 11 was reproduced in the experiment 2026-10-27-capture-export-comma-list-by-id. This spec is the executable list.

## Problems

1. Four names ship as both `commands/<name>.md` and `skills/<name>/SKILL.md` (capture, claims-gate, teach, verify). In a session on 2026-10-26 the listing showed one description per colliding name, the command's summary for capture, claims-gate and verify; for capture and claims-gate that is not the skill's "Use when" text (vault experiment 2026-10-26-claude-code-skill-listing-shows-command). The captured docs note records that custom commands in `.claude/commands/` "have been merged into skills" (claim 26) and, for plugins, "Prefer `skills/` for new plugins" (claim 37). The Codex manifest's `skills` entry points at `skills/` and it names no commands directory, so a command body is not among the files that manifest lists.
2. `vault-template/CLAUDE.md` is one line, a prose pointer to AGENTS.md. The captured memory docs record that Claude reads AGENTS.md only when no CLAUDE.md is present and name this pattern: "replace the sentence with an `@AGENTS.md` import" (claims 44, 45).
3. Six skills call a bare `research-vault`; `bin/` holds no executable of that name, only `bin/research-vault.mjs`, and package.json's `bin` field is what maps the name to that file, so the bare call would resolve only where that mapping has been installed on the PATH. The captured docs record that a plugin's `bin/` is on the Bash tool's PATH while the plugin is enabled (claim 37).
4. The pre-fetch hook joins the tool input's `query`, `prompt` and `url` (WebSearch or WebFetch), strips URLs and splits the rest into search terms; when the URL is already captured, the code does not stop after the URL line, so a term-match or no-match line follows it. Its injected strings are imperative ("Read these before fetching; answer from them if they are fresh"), where the captured docs ask for "factual statements rather than imperative system instructions" (claim 11).
5. The Stop hook's catch block writes "stop-gate skipped" to stderr and then calls `process.exit(0)`. The captured docs record that "Claude never sees stderr from a hook that exits 0" (claim 10) and describe `systemMessage` as a warning message shown to the user (2026-10-26-claude-code-hooks-reference).
6. No handler in hooks.json sets a `timeout`; the captured docs record a default of 600 s for command hooks (claim 4). `pre-web.mjs` and `post-tool-use.mjs` call `resolveVault({})` without the event's `cwd`, and `resolveVault` defaults `cwd` to `process.cwd()`; `session-start.mjs` and `stop-gate.mjs` pass `evt.cwd`.
7. `.claude-plugin/plugin.json` carries only `name`, `description` and `author`; the captured docs record that `claude plugin validate` warns on a missing `version` (claim 36).
8. The two agent files set no `omitClaudeMd`, while their prompts insist on a reader with no session context; the captured docs record that a non-fork subagent loads the CLAUDE.md and AGENTS.md hierarchy unless `omitClaudeMd: true` (claim 33).
9. The repo root has no CLAUDE.md or AGENTS.md.
10. The writer-side lines quoted from the teach, orchestrate, vault-usage and review skills mostly do not describe the reader, and several pair a length instruction with required content ("ONE short synthesis", "Short.", "three to six sentences"). The captured Anthropic prompting pages record that a role "focuses Claude's behavior and tone" and that "Claude can generalize from the explanation"; in one study (GPT-4 news summaries) packing more content into a fixed length made the summaries denser and, past a middle step, less preferred by the raters.
11. `capture` splits `--domain`, `--topics`, `--related`, `--sources` and `--contributing-ids` on commas without trimming, and `export` does the same to `--scope`. Reproduced at 08c39b6: `--topics "tdd, go"` stores `[test-driven-development, " go"]` and `search --topic go` prints nothing; `--sources "<id>, other-id"` stores `" other-id"` and `lint` reports `DANGLING_REF`; `export --scope "question, note"` prints 0 records where `"question,note"` prints 1. `--by-id reviewer-1` stores `by_id: ""`, because the CLI flag map never forwards it. A malformed `.research-vault.json` in the working directory with `--vault` given produces a normal capture and exit 0 with no message, because `captureDefaults` catches every error.
12. The manifest is written by the same inline `writeFileSync(join(vaultPath, '.vault-manifest.json'), ...)` line at each quoted site (capture twice, verify twice, init, lint, manifest), while `writeEntry` writes tmp-then-rename. The data-block scanner exists in both `lesson.mjs` and `gate.mjs`. `missionFloor` computes `knownTools` that only a test reads; the lint's tool rule calls `missionKnownTools`.

## Design

### Commands and skills (1)

- Compare each colliding command body with its skill and move into the SKILL.md whatever the skill lacks (the verify command's `verify --stale --json` step, and whatever else the comparison turns up), plus the `argument-hint` lines of capture, claims-gate and teach (verify has none) into the SKILL.md frontmatter. The skills reference documents `argument-hint` as a SKILL.md field and says a claude.ai upload rejects it (2026-10-26-claude-code-skills-reference-extend-claude); that surface is already closed to this plugin by `bin/` (claim 37). Then delete `commands/research-capture.md`, `commands/research-claims-gate.md`, `commands/research-teach.md`, `commands/research-verify.md`.
- `test/skills.test.mjs`: drop the command half of the first test (the regex read of `commands/research-claims-gate.md` and its three assertions); the skill assertions stay.
- `docs/REFERENCE.md`: the slash-command sentence lists the eight remaining commands and says every skill is also `/research-vault:<name>` (claim 27).
- `commands/research-init.md` gains `disable-model-invocation: true` (command files accept the same fields as skills except `name` and `paths`, claim 26; the docs recommend it for workflows with side effects, claim 25). The other seven commands stay.

### Vault template (2)

- `vault-template/CLAUDE.md` becomes the single line `@AGENTS.md`. `refreshDocs` writes only AGENTS.md and taxonomy.json and is not widened (spec 06 says not to). The CHANGELOG upgrade note tells existing vaults to make the same one-line change. `GEMINI.md` is left as is; Gemini's import syntax was not researched.

### CLI on the PATH (3)

- Add executable `bin/research-vault`: `#!/usr/bin/env sh` then `exec node "$(dirname "$0")/research-vault.mjs" "$@"`. Add `bin/research-vault text eol=lf` to `.gitattributes`.

### Hooks (4, 5, 6)

- `hooks/pre-web.mjs`: add `return`, `full`, `page`, `text`, `summarize`, `paper`, `extract`, `verbatim` to `STOP`; when the URL is already captured, return only that line; the term-match line reads "Vault entries matching this query:" and the no-match line is a statement. `resolveVault({ cwd: evt.cwd })`.
- `hooks/post-tool-use.mjs`: `resolveVault({ cwd: evt.cwd })`.
- `hooks/stop-gate.mjs`: the catch block writes `{"systemMessage": "research-vault: stop-gate skipped (<message>)"}` to stdout; the comments that say stderr change with it. `test/stopgate.test.mjs` asserts empty stderr and the JSON field.
- `hooks/hooks.json`: `"timeout": 30` on every handler, `10` on SessionStart.
- New `test/hooks-config.test.mjs`: parse hooks.json, every handler has `args`, `args[0]` with `${CLAUDE_PLUGIN_ROOT}` replaced by the repo root exists, every handler has a numeric `timeout`.

### Manifests and agents (7, 8, 9)

- `.claude-plugin/plugin.json`: `version` from package.json plus `homepage`, `repository`, `license`, `keywords` matching `.codex-plugin/plugin.json`; descriptions aligned. New test: the three `version` fields agree. The captured docs record that a set `version` "pins the plugin to that version until you change it" (claim 36), so the CHANGELOG says every release tag bumps all three.
- `agents/claims-reviewer.md` and `agents/lesson-reader.md`: `omitClaudeMd: true`; asserted in `test/agent.test.mjs` and `test/lesson-reader.test.mjs`.
- Root `AGENTS.md` (under 40 lines): `npm test`, `npm run lint:self`, `scripts/check-agentsmd-drift.mjs`, `scripts/check-encoding.mjs`, `schema/AGENTS.golden.md` is generated from `schema/` and never hand-edited, every change gets a CHANGELOG `[Unreleased]` line, specs live in `docs/specs/`.

### Writing (10)

- `skills/research-teach/SKILL.md` §4: new bullet "**Talk to the learner.** Write the model, fact and example blocks to the learner MISSION.md describes, the way you would explain them in person. The lesson-reader gate never sees MISSION.md; it reads the page as someone who knows only what the page says they know, so name the Floor terms and tools the page relies on." The "Short." bullet becomes "**Short in scope.** Working memory is small. One tangible win, completable fast, tied to the mission, explained in full sentences."
- `skills/research-teach/LESSON-FORMAT.md`, model block: "says in three to six sentences how they relate and why each exists" becomes "says, in a paragraph or two you would say aloud at a whiteboard, how they relate and why each exists".
- `skills/research-orchestrate/SKILL.md`: in the Plan prompt, "ONE short synthesis" becomes "ONE synthesis"; the line "Synthesis: chain-of-verification claims per research-vault-usage §4." becomes "Synthesis: written for a colleague who reads it once, cold, to decide what to do: the answer first, then the reasoning in paragraphs with each checked claim (research-vault-usage §4) as a sentence, then the recommendation; detail stays in the notes."; §3 degraded mode gains one sentence pointing at the Plan step's wording; the close-out's "present it (short: claims + recommendation, `confidence`, open `question` ids)" becomes "present it to the user the way you would tell a colleague: the answer, why, how confident, and what is still open (question ids)".
- `skills/research-vault-usage/SKILL.md`, after the five chain-of-verification steps: "Write the body as paragraphs a reader can follow, with each checked claim as a sentence in them; the steps above are how you check it."
- `skills/research-review/SKILL.md` §4: append "Open with what the audit found and what to fix first, then the coverage matrix."
- Measuring the effect is deferred to a later spec.

### Code (11, 12)

- `bin/lib/args.mjs` exports `csvList(s)`: split on commas, trim, drop empties. Used at the five split sites in `bin/commands/capture.mjs`, at `bin/commands/export.mjs` for `--scope`, and at the already-trimmed sites in `init.mjs`, `gate.mjs` and `related.mjs`. Tests: `--topics "tdd, go"` stores `go` with the alias applied to the first, `--sources "a, b"` stores `b`, `export --scope "question, note"` matches `"question,note"`.
- The `capture` flag map forwards `byId: args['by-id']`. Test: `by_id` lands in the entry.
- `captureDefaults` prints one stderr line naming the malformed binding file before returning empty defaults.
- `bin/lib/manifest.mjs` exports `writeManifest(vaultPath, manifest = buildManifest(vaultPath))`, written tmp-then-rename like `writeEntry`; the quoted inline writes call it.
- `bin/lib/lesson.mjs` exports `parseBlocks(html)`; `unitHashes` in `bin/lib/gate.mjs` consumes it. A test pins the fixture lesson's unit hashes so existing ledger rows stay valid.
- `missionFloor` drops `knownTools` and its test assertion; `missionList` loses the now-constant `whole` parameter if nothing else passes it.

## Commits

One commit per group, each leaving `node --test` green and `lint --vault vault-template` clean:

1. `fix(capture): trim comma lists, forward --by-id, report a malformed binding file`
2. `refactor(lib): writeManifest, shared parseBlocks, drop dead knownTools`
3. `feat(hooks): timeouts, event cwd, systemMessage on stop-gate skip, quieter pre-web`
4. `feat(plugin): manifest version and fields, omitClaudeMd on agents, bin shim`
5. `feat(skills): fold the four colliding commands into their skills; init is user-invoked only`
6. `docs: @AGENTS.md import in the vault template, root AGENTS.md`
7. `docs(skills): name the reader and say what short limits`
8. `docs(specs): spec 13, changelog`

## Upgrade guidance (CHANGELOG entry)

- Replace the one-line `CLAUDE.md` in an existing vault with `@AGENTS.md`; `--refresh-docs` does not touch it.
- `/research-vault:research-capture`, `research-claims-gate`, `research-teach` and `research-verify` are now the skills of the same name; the slash form still works.
- Marketplace installs follow `version` in `.claude-plugin/plugin.json` from now on and update only when it is bumped.
- A topic, source or scope list with spaces after the commas is now trimmed. An entry captured before this keeps its leading-space value; `lint --fix` is not changed to rewrite it.
