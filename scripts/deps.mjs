#!/usr/bin/env node
// Derived dependency graph of this repo (spec 14): computed from the working tree on every run, never
// stored. Who imports, reads, tests, documents or invokes a file, plus the couplings no path connects.
//   node scripts/deps.mjs          print every broken edge as `<kind> <from> -> <to>`, exit 1 if any
//   node scripts/deps.mjs <id>     distance-1 dependents of a file, cli:<cmd> or npm:<script>
//   node scripts/deps.mjs --hook   PostToolUse: additionalContext naming the edited file's dependents
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../bin/lib/git.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_EXT = 'mjs|js|md|json|yml|css|html';
// Every extension in the tree must be in one of these two sets (test/deps.test.mjs). '' is the
// extensionless bin/research-vault shim; dotfiles and LICENSE share it and yield nothing.
export const EXTRACTED = new Set(['.mjs', '.js', '.md', '.yml', '.json', '']);
export const IGNORED = new Set(['.cast', '.css', '.html', '.sh']);
// Files no extractor reads: release history legitimately names removed files; the other two quote
// every syntax (COUPLINGS rows are couples edges, the sample table is test input).
const UNSCANNED = new Set(['CHANGELOG.md', 'scripts/deps.mjs', 'test/deps.test.mjs']);

// Pairs that depend on each other through something other than a path: a copied value, a printed
// string, a name, a format. Add a row with the change that creates one (AGENTS.md); the test fails
// when either end leaves the tree. Seeded from the 2026-10-27 seven-agent inventory. A row is
// [from, to, why] or [from, to, why, literal]: the optional literal, a string or regex, is the shared
// text itself, and the test fails when either file stops containing it. Give one only when the
// literal really is in both files; a row about two values being equal stays prose.
export const COUPLINGS = [
  ['bin/lib/args.mjs', 'docs/REFERENCE.md', 'the strict-option error lines', 'unknown option --'],
  ['bin/lib/args.mjs', 'docs/REFERENCE.md', 'the strict-option error lines', 'needs a value'],
  ['bin/lib/args.mjs', 'docs/REFERENCE.md', 'the strict-option error lines', 'takes no value'],
  ['bin/lib/args.mjs', 'test/args.test.mjs', 'the strict-option error lines', 'unknown option --'],
  ['bin/lib/args.mjs', 'test/args.test.mjs', 'the strict-option error lines', 'needs a value'],
  ['bin/lib/args.mjs', 'test/args.test.mjs', 'the strict-option error lines', 'takes no value'],
  ['bin/lib/args.mjs', 'test/gate.test.mjs', 'the strict-option error lines', 'needs a value'],
  ['bin/lib/screen.mjs', 'test/screen.test.mjs', "screenText's cut mark is quoted in the expected values", '\\u2026'],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', 'residual and loaded-script unit names and review scope', 'script:'],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', 'residual, repeated-block and loaded-script unit contract', '`rest`'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'repeated block lint code for lessons and reference pages', 'LESSON_BLOCK_REPEATED'],
  ['bin/lib/lesson.mjs', 'docs/REFERENCE.md', 'repeated block lint code', 'LESSON_BLOCK_REPEATED'],
  ['bin/commands/init.mjs', 'README.md', 'environment hint is printed only when later discovery would not find the initialized vault', 'RESEARCH_VAULT_PATH'],
  ['bin/commands/init.mjs', 'commands/research-init.md', 'environment hint is printed only when later discovery would not find the initialized vault', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/fsutil.mjs', 'vault-template/.gitignore', 'Random atomic-write leftovers use .rv-atomic-*.tmp', '.rv-atomic-'],
  ['bin/lib/validate.mjs', 'schema/frontmatter.schema.json', 'collection containers, edge members and verification row maps validated at the entry boundary', 'verifications'],
  ['bin/lib/resolve.mjs', 'README.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'SECURITY.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'docs/REFERENCE.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'docs/ADOPTING.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'docs/CODEX.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'commands/research-init.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'skills/research-teach/SKILL.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'skills/research-orchestrate/SKILL.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'skills/research-vault-usage/SKILL.md', 'acknowledgement permits the bound vault anywhere', 'research-vault trust'],
  ['bin/lib/resolve.mjs', 'test/resolve.test.mjs', 'refusal offers project acknowledgement', 'Run research-vault trust in that project to approve the binding.'],
  ['bin/lib/resolve.mjs', 'test/gate-precommit.test.mjs', 'staged gate preserves the acknowledgement remedy', 'Run research-vault trust in that project to approve the binding.'],
  ['hooks/session-start.mjs', 'test/sessionstart.test.mjs', 'summary includes escaped vault path and origin after the stale count'],
  ['hooks/session-start.mjs', 'test/resolve.test.mjs', 'acknowledged binding summary identifies the selected vault and project origin'],
  ['hooks/session-start.mjs', 'test/codex-hooks.test.mjs', 'Codex preserves the summary path and origin'],
  ['hooks/session-start.mjs', 'docs/REFERENCE.md', 'session summary format and four origin words'],
  ['bin/lib/trust.mjs', 'SECURITY.md', 'acknowledgement storage and byte matching limits', 'trusted-bindings.json'],
  ['bin/lib/trust.mjs', 'test/preweb.test.mjs', 'a config record alone does not make a vault', 'trusted-bindings.json'],
  ['hooks/codex.mjs', 'test/codex-hooks.test.mjs', 'Dependencies invokes the script in hook mode', '--hook'],
  ['bin/commands/trust.mjs', 'test/trust.test.mjs', 'linked-folder alternate vault label and fixed notice are asserted', 'Binding-folder vault: '],
  ['bin/commands/trust.mjs', 'docs/REFERENCE.md', 'found-folder and real-folder vault labels and linked-folder notice', 'Linked folder: vault locations differ depending on the path.'],
  ['bin/commands/trust.mjs', 'test/trust.test.mjs', 'binding display pieces and reconstruction use fixed prefixes and a 76-character total line limit', '76'],
  ['bin/commands/trust.mjs', 'docs/REFERENCE.md', 'network-like vault values skip real-location lookup', 'Vault location was not looked up.'],
  ['bin/commands/trust.mjs', 'test/trust.test.mjs', 'network-like vault lookup notice is asserted verbatim', 'Vault location was not looked up.'],
  ['bin/commands/trust.mjs', 'bin/lib/resolve.mjs', 'two leading slash or backslash characters must not trigger network or device real-location lookup', 'vault'],
  ['bin/commands/trust.mjs', 'docs/REFERENCE.md', 'trust display escapes non-ASCII and backslashes and wraps lines including prefixes at 76 characters', '76'],
  ['bin/commands/trust.mjs', 'test/trust.test.mjs', 'non-object JSON refusal is asserted verbatim', 'binding JSON must be an object'],
  ['bin/commands/trust.mjs', 'test/trust.test.mjs', 'UTF-8 refusal is asserted verbatim', 'binding must be valid UTF-8'],
  ['bin/lib/trust.mjs', 'test/trust.test.mjs', 'linked binding refusal is asserted verbatim', 'binding must be a regular file'],
  ['bin/lib/trust.mjs', 'test/projectscaffold.test.mjs', 'project init tests protect the acknowledgement record destination', 'trusted-bindings.json'],
  ['bin/commands/init.mjs', 'test/projectscaffold.test.mjs', 'failed acknowledgement leaves the binding and prints the trust remedy', 'Could not record the acknowledgement; run research-vault trust to record it.'],
  ['bin/commands/trust.mjs', 'test/trust.test.mjs', 'trust status and display labels are asserted', 'Acknowledged: '],
  ['bin/lib/trust.mjs', 'docs/REFERENCE.md', 'the acknowledgement record filename and format', 'trusted-bindings.json'],
  ['bin/lib/trust.mjs', 'test/trust.test.mjs', 'the acknowledgement record filename and format', 'trusted-bindings.json'],
  ['bin/research-vault.mjs', 'docs/REFERENCE.md', 'trust in the usage line and command reference row', 'trust'],
  ['bin/commands/init.mjs', 'bin/commands/trust.mjs', 'the acknowledgement remedy names research-vault trust', 'research-vault trust'],
  ['scripts/coverage.mjs', 'docs/REFERENCE.md', 'coverage percentages, exclusions and partial-run policy'],
  ['scripts/coverage.mjs', 'AGENTS.md', 'new code must be loaded by a test'],
  ['scripts/check-agentsmd-drift.mjs', 'test/coverage.test.mjs', 'command fixture checks the drift diagnostic and leaves the golden unchanged', 'AGENTS.md drift: generator output differs'],
  ['scripts/check-encoding.mjs', 'test/coverage.test.mjs', 'command fixture checks the BOM diagnostic and leaves the file unchanged', 'BOM: '],
  ['scripts/coverage.mjs', 'test/coverage.test.mjs', 'lcov table and missing-file and partial-run diagnostics'],
  ['.github/workflows/ci.yml', 'docs/REFERENCE.md', 'Linux coverage step', 'npm run coverage'],
  ['package.json', '.github/workflows/ci.yml', 'CI invokes npm:coverage'],
  ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'release subscribes to the ci workflow name and requires successful master push runs', /^(?:name: ci|    workflows: \[ci\])$/m],
  ['.github/workflows/release.yml', 'test/workflow-config.test.mjs', 'configuration scans guard release triggers, job eligibility and CI commit identity', 'head_sha'],
  ['.github/workflows/release.yml', 'test/workflow-config.test.mjs', 'the extracted version step and its diagnostics are exercised with fixture manifests', 'Check release versions'],
  ['package.json', '.claude-plugin/marketplace.json', 'manifests.test.mjs requires an entry matching the package name and, when present, its version'],
  ['.github/workflows/release.yml', 'docs/REFERENCE.md', 'release eligibility, manifest versions, existing-release no-op and CI commit identity', 'head_sha'],
  ['bin/commands/gate.mjs', 'test/gate-precommit.test.mjs', 'the unreadable binding entry diagnostic', 'binding exists but cannot be read'],
  ['bin/commands/gate.mjs', 'test/gate-precommit.test.mjs', 'the unbound staged gate diagnostic', 'staged gated files: none (no .research-vault.json binding here, so nothing is gated)'],
  ['bin/commands/gate.mjs', 'docs/REFERENCE.md', 'the unbound staged gate diagnostic', 'staged gated files: none (no .research-vault.json binding here, so nothing is gated)'],
  ['bin/commands/gate.mjs', 'docs/REFERENCE.md', "the 'staged and working copies differ' reason gate staged prints for a page's image, script or requirements file", 'staged and working copies differ'],
  ['bin/commands/gate.mjs', 'AGENTS.md', 'an unbound clone gates nothing and passes'],
  ['bin/lib/gate.mjs', 'test/gate-precommit.test.mjs', 'the git command gate staged names when it cannot list the staged files', '--ignore-submodules=all'],
  ['.github/workflows/ci.yml', 'AGENTS.md', 'CI does not run the staged gate check'],
  ['bin/lib/projectconfig.mjs', 'test/gate-precommit.test.mjs', 'malformed binding JSON remains an error with the binding filename'],
  ['bin/lib/resolve.mjs', 'test/gate-precommit.test.mjs', 'an unapproved binding vault remains an error', 'a vault outside its repository that is not one of your own'],
  ['package.json', 'AGENTS.md', 'the supported Node floor is repeated in contributor instructions', '>=24'],
  ['package.json', 'README.md', 'the supported Node floor is repeated in installation instructions and the badge; workflow-config.test.mjs compares the values'],
  ['package.json', 'docs/CODEX.md', 'the supported Node floor is repeated in Codex installation instructions; workflow-config.test.mjs compares the values'],
  ['skills/research-teach/assets/quiz.js', 'test/teach-export.test.mjs', 'the delivered classic script emits the attempts-file protocol', 'research-vault-attempts'],
  ['scripts/run-tests.mjs', 'test/npm-test.test.mjs', 'runner timeout options, defaults and whole-run timeout diagnostic'],
  ['scripts/run-tests.mjs', '.github/workflows/ci.yml', 'CI job limit must exceed the default whole-run limit'],
  ['scripts/run-tests.mjs', 'AGENTS.md', 'npm test environment isolation and default test, test-file and whole-run limits'],
  ['scripts/run-tests.mjs', 'docs/REFERENCE.md', 'npm test environment isolation and default test, test-file and whole-run limits'],
  ['bin/lib/resolve.mjs', 'README.md', 'the outside binding vault rule names the user choice', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'docs/ADOPTING.md', 'the outside binding vault rule names the user choice', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'docs/CODEX.md', 'the outside binding vault rule names the user choice', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'skills/research-teach/SKILL.md', 'the outside binding vault rule names the user choice', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/embed.mjs', 'README.md', 'the third embedding gate requires endpoint approval', 'RESEARCH_VAULT_EMBED_URL'],
  ['bin/lib/embed.mjs', 'docs/REFERENCE.md', 'the third embedding gate requires endpoint approval', 'RESEARCH_VAULT_EMBED_URL'],
  ['bin/lib/embed.mjs', 'skills/research-vault-usage/SKILL.md', 'the third embedding gate requires endpoint approval', 'RESEARCH_VAULT_EMBED_URL'],
  ['bin/lib/embed.mjs', 'README.md', 'the README names the network opt-in the embedding gate checks', 'RESEARCH_VAULT_ALLOW_NETWORK'],
  ['bin/lib/embed.mjs', 'docs/REFERENCE.md', "the Embedding endpoint text lists the gate's refusals in the gate's order", 'no embedding endpoint in .research-vault.json'],
  ['bin/lib/codelinks.mjs', 'docs/REFERENCE.md', 'the versions file containment diagnostic is quoted', 'resolves outside the repository'],
  ['bin/lib/lintrules.mjs', 'docs/REFERENCE.md', 'the skipped entry link warning is quoted', 'WARN_ENTRY_LINK_SKIPPED'],
  ['bin/lib/lintrules.mjs', 'docs/RELIABILITY.md', 'the skipped entry link warning is quoted', 'WARN_ENTRY_LINK_SKIPPED'],
  ['bin/lib/lintrules.mjs', 'commands/research-lint.md', 'the skipped entry link warning is quoted', 'WARN_ENTRY_LINK_SKIPPED'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', 'the certification state refusal is quoted', 'cannot use as a regular workspace state file. Remove it by hand.'],
  ['bin/lib/task.mjs', 'skills/research-teach/SKILL.md', 'both certification state names must be regular files', '.teach-certify.ending.json'],
  ['bin/research-vault.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'state and attempt refusals use the CLI error prefix', 'error: '],
  ['bin/research-vault.mjs', 'skills/research-teach/SKILL.md', 'state and attempt refusals use the CLI error prefix', 'error: '],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', 'the best-effort checker announcement is quoted', /check: evidence\/(?:\$\{nnnn\}|NNNN)\/check\.sh/],
  ['bin/lib/task.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'the best-effort checker announcement is quoted', /check: evidence\/(?:\$\{nnnn\}|NNNN)\/check\.sh/],
  ['bin/lib/task.mjs', 'skills/research-teach/SKILL.md', 'the checker announcement must be retained in the run log', /check: evidence\/(?:\$\{nnnn\}|NNNN)\/check\.sh/],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', 'the export input path finding is quoted', 'unservable '],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', 'the export input path refusal is quoted', 'teach export: paths resolve outside their allowed locations or cannot be resolved; nothing written'],
  ['bin/lib/teach.mjs', 'skills/research-teach/SKILL.md', 'the export input path finding is quoted', 'unservable '],
  ['bin/lib/teach.mjs', 'skills/research-teach/BRAND-FORMAT.md', 'the export walk path finding is quoted', 'unservable '],
  ['bin/lib/terminal.mjs', 'docs/REFERENCE.md', 'the isolated Python preflight command is quoted', /(?:python3|<python>) -I -c "import pty"/],
  ['bin/lib/terminal.mjs', 'skills/research-teach/SKILL.md', 'the isolated Python preflight command is quoted', /(?:python3|<python>) -I -c "import pty"/],
  ['bin/lib/terminal.mjs', 'docs/REFERENCE.md', 'the Python version requirement names the helper API', 'os.set_blocking'],
  ['bin/lib/terminal.mjs', 'docs/REFERENCE.md', 'Python starts withhold the executable override', 'PYTHONEXECUTABLE'],
  ['bin/lib/terminal.mjs', 'docs/REFERENCE.md', 'the shell never receives the launcher variable', '__PYVENV_LAUNCHER__'],
  ['bin/commands/obsidian.mjs', 'docs/REFERENCE.md', 'the output segment and per-destination checks are described', 'output directory'],
  ['bin/commands/obsidian.mjs', 'commands/research-obsidian.md', 'the output segment and per-destination checks are described', 'output directory'],
  ['skills/research-teach/SKILL.md', 'skills/research-teach/MISSION-FORMAT.md', 'profile search/capture topic and draft/depth bullet markers shared by the interview and format', /--topics? teach-profile|- Draft:|- Depth:/],
  ['bin/lib/capture-operation.mjs', 'bin/commands/capture.mjs', 'opt-in key syntax and structured validation error protocol', 'INPUT_INVALID'],
  ['bin/lib/capture-operation.mjs', 'docs/RELIABILITY.md', 'receipt v1, replay and lock recovery protocol', 'historical'],
  ['bin/commands/capture.mjs', 'docs/REFERENCE.md', 'opt-in operation-id and receipt output contract', 'operation-id'],
  ['bin/lib/capture-operation.mjs', 'skills/research-orchestrate/SKILL.md', 'the Write step runs capture --batch with --operation-id and branches on recoveryStateCreated, LOCK_BUSY, RECEIPT_IO and INPUT_CHANGED', 'recoveryStateCreated'],
  ['bin/lib/ids.mjs', 'skills/research-orchestrate/SKILL.md', 'the Write prompt restates slugify: the stopword list, the six-word limit and the t- slug of a title with no word left'],
  ['bin/commands/verify.mjs', 'skills/research-orchestrate/SKILL.md', 'the Write step runs verify --quotes with --by-id so a row is recorded as an agent\'s and reads found, foundIn and context from its output; section 4 closes questions with --answered-by', '--quotes'],
  ['bin/lib/capture-entry.mjs', 'skills/research-orchestrate/SKILL.md', 'the Write step reads a repeated URL by the duplicate message', 'existing entry with same url'],
  ['bin/lib/capture-entry.mjs', 'skills/research-orchestrate/SKILL.md', 'the Write step reads a title clash by the id-taken error', 'id taken'],
  ['bin/lib/capture-entry.mjs', 'docs/RELIABILITY.md', 'a title clash is described by the id-taken error', 'id taken'],
  ['bin/commands/capture.mjs', 'docs/REFERENCE.md', 'the unresolved-reference refusal of capture and --batch is quoted', 'unresolved reference: '],
  ['bin/lib/capture-entry.mjs', 'docs/REFERENCE.md', 'the unresolved-reference refusal of capture and --batch is quoted', 'unresolved reference: '],
  ['bin/lib/ids.mjs', 'docs/REFERENCE.md', 'the empty-slug id rule is restated: t- and the first 8 hex characters of the title\'s SHA-256'],
  ['skills/research-orchestrate/SKILL.md', 'docs/RELIABILITY.md', 'the run directory, the retry rule and the quote-matched row are restated', 'quote-matched'],

  ['bin/lib/codex-review.mjs', 'agents/claims-reviewer.md', 'the shared policy and PASS/FAIL-as-sent review protocol'],
  ['bin/lib/codex-review.mjs', 'agents/lesson-reader.md', 'the shared reader policy and READS/REVISE protocol'],
  ['bin/lib/codex-review.mjs', 'bin/lib/host-install.mjs', 'the generated review command and default model/effort'],
  ['bin/lib/codex-review.mjs', 'SECURITY.md', 'the Codex CLI handoff and absence of a plugin network gate'],
  ['SECURITY.md', 'test/codex-review.test.mjs', 'the inventory states that the Codex review has no plugin network gate', 'does not gate the review'],
  ['bin/commands/host.mjs', 'docs/CODEX.md', 'the installation and review CLI contract'],
  ['bin/commands/host.mjs', 'docs/REFERENCE.md', 'the host command reference'],
  ['bin/lib/host-install.mjs', 'hooks/codex.mjs', 'the generated Codex hook event names and adapter command'],
  ['bin/lib/host-install.mjs', 'agents/claims-reviewer.md', 'the shared reviewer body and generated Codex dispatch identity'],
  ['bin/lib/host-install.mjs', 'agents/lesson-reader.md', 'the shared reader body and generated Codex dispatch identity'],
  ['bin/lib/host-install.mjs', 'skills/research-claims-gate/SKILL.md', 'the exact Claude dispatch and plugin-root forms translated for Codex'],
  ['bin/lib/host-install.mjs', 'skills/research-teach/SKILL.md', 'the exact reader dispatch and plugin-root forms translated for Codex'],
  ['bin/lib/host-install.mjs', 'skills/research-orchestrate/SKILL.md', 'the plugin-root form translated for Codex'],
  ['bin/lib/host-install.mjs', 'skills/research-orchestrate/SKILL.md', 'the Codex copy pins the script\'s CLI line to the launcher', 'const CLI = `node "${args.cli}" `'],
  ['bin/lib/host-install.mjs', 'skills/research-orchestrate/SKILL.md', 'the Codex copy rewrites the script\'s args comment', 'cli = absolute path to research-vault.mjs'],
  ['hooks/codex.mjs', 'hooks/hooks.json', 'the four lifecycle event names and shared handler selection'],
  ['hooks/codex.mjs', 'scripts/deps.mjs', 'Dependencies maps to the development PostToolUse --hook protocol'],
  ['bin/research-vault', 'bin/research-vault.mjs', 'the shim execs ./research-vault.mjs by name'],
  ['bin/research-vault.mjs', 'docs/REFERENCE.md', 'the command table restates the commands map, and <command> --help prints the command\'s row'],
  ['bin/research-vault.mjs', 'test/smoke.test.mjs', 'the --help usage line is asserted in order, and the test reads the command list from it', '--help'],
  ['test/smoke.test.mjs', 'docs/REFERENCE.md', 'the --help test finds each command\'s row of the command table by its start'],
  ['bin/lib/fsutil.mjs', 'schema/taxonomy.json', 'TYPE_FOLDER keys and folders equal artifact_type and stage_by_folder keys'],
  ['bin/lib/fsutil.mjs', 'agents/claims-reviewer.md', 'the {sources,notes,...} folder list is TYPE_FOLDER'],
  ['bin/lib/validate.mjs', 'bin/lib/lintrules.mjs', 'ENUM_META needs an entry for every CONTROLLED_FIELDS field', 'CONTROLLED_FIELDS'],
  ['bin/lib/manifest.mjs', 'bin/lib/lintrules.mjs', "the '.vault-manifest.json' literal is written in both", '.vault-manifest.json'],
  ['bin/lib/manifest.mjs', 'schema/taxonomy.json', 'CONFIRMING_RESULTS is a subset of verification_result'],
  ['bin/lib/ids.mjs', 'bin/lib/citations.mjs', 'makeId output must match ID_RE'],
  ['bin/lib/ids.mjs', 'bin/lib/agentsmd.mjs', 'the filename-is-the-id rule is restated in the generated AGENTS.md'],
  ['bin/lib/ids.mjs', 'bin/lib/gate.mjs', "sha256 formats differ: 'sha256:<hex>' stored, bare hex in the ledger", 'sha256:'],
  ['bin/lib/stale.mjs', 'vault-template/meta/freshness-policy.md', 'the last_verified rule and the volatility windows are restated in §2-3', 'last_verified'],
  ['bin/lib/stale.mjs', 'vault-template/meta/prompt-templates/verify-entry.md', 'steps 1-2 restate the last_verified rule and the windows', 'last_verified'],
  ['bin/lib/stale.mjs', 'skills/research-vault-usage/SKILL.md', 'the 90-day window and the last_verified rule are written out', 'last_verified'],
  ['bin/commands/search.mjs', 'docs/REFERENCE.md', 'the --sort values and the no tier / fresh / stale annotation words', 'no tier'],
  ['schema/taxonomy.json', 'vault-template/meta/freshness-policy.md', 'refresh_after_days are hand-copied into the §2 table; method and result lists into §5', 'tool-probe'],
  ['schema/taxonomy.json', 'vault-template/meta/prompt-templates/verify-entry.md', 'windows in step 2, method and result lists in steps 3-4', 'tool-probe'],
  ['schema/taxonomy.json', 'vault-template/meta/prompt-templates/probe-tool.md', 'verification method names', 'tool-probe'],
  ['schema/taxonomy.json', 'skills/research-verify/SKILL.md', 'method and result lists', 'tool-probe'],
  ['schema/taxonomy.json', 'skills/research-capture/SKILL.md', 'the enum lists under Optional fields (authority_basis among them)', 'community-report'],
  ['schema/taxonomy.json', 'docs/REFERENCE.md', 'volatility windows, domain values and the extensible fields are hand-listed', 'llm-assisted-dev'],
  ['schema/taxonomy.json', 'README.md', 'the volatility windows are written as prose', /\b90\b/],
  ['schema/taxonomy.json', 'test/helpers.mjs', 'put() hardcodes domain, method, by_type, result and volatility values', 'by_type'],
  ['schema/taxonomy.json', 'bin/lib/capture-entry.mjs', 'the default domain, volatility, source_type, confidence, outcome, state and language values', 'source_type'],
  ['test/helpers.mjs', 'test/isolation.test.mjs', 'the source guard matches the testEnv helper by name', 'testEnv'],
  ['bin/lib/git.mjs', 'test/git.test.mjs', 'the invocation test checks the fixed Git overrides and their order', /['"]-c['"]\s*,\s*['"]hook\.post-index-change\.enabled=false['"]/],
  ['bin/lib/git.mjs', 'SECURITY.md', 'the Git overrides, supported versions and limits are restated', 'safe.bareRepository=explicit'],
  ['bin/lib/git.mjs', 'test/teach-labs.test.mjs', 'the process guard checks the child_process import and sole Git launch', 'execFileSync'],
  ['schema/teach-taxonomy.json', 'skills/research-teach/LEARNING-RECORD-FORMAT.md', 'kind values, types and the learning-records folder are hand-copied', 'learning-records'],
  ['schema/frontmatter.schema.json', 'bin/lib/graph.mjs', 'DEPENDENCY_RELS must be a subset of edge_fields.backlink'],
  ['schema/frontmatter.schema.json', 'hooks/pre-web.mjs', 'title, topics, summary, source_url, status and type are read by name', 'source_url'],
  ['bin/commands/init.mjs', 'vault-template/README.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'vault-template/CLAUDE.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'vault-template/GEMINI.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'commands/research-init.md', 'the non-clobber and --refresh-docs behaviour is described', 'refresh-docs'],
  ['bin/commands/init.mjs', 'bin/lib/resolve.mjs', 'init derives home from HOME||USERPROFILE, resolve from os.homedir()'],
  ['bin/lib/resolve.mjs', 'bin/commands/check.mjs', 'the vault refusal names the command-line override', '--vault'],
  ['bin/lib/resolve.mjs', 'test/resolve.test.mjs', 'the vault refusal names the environment override', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'test/resolve.test.mjs', 'the vault refusal names the command-line override', '--vault'],
  ['bin/lib/resolve.mjs', 'test/search.test.mjs', 'search reports the outside-vault refusal', 'vault outside its repository'],
  ['bin/lib/resolve.mjs', 'test/teach.test.mjs', 'teach reports the outside-vault refusal', 'vault outside its repository'],
  ['bin/lib/resolve.mjs', 'test/stopgate.test.mjs', 'the stop gate reports the outside-vault refusal', 'vault outside its repository'],
  ['bin/lib/resolve.mjs', 'test/codex-hooks.test.mjs', 'Codex hooks report the outside-vault refusal', 'vault outside its repository'],
  ['bin/lib/resolve.mjs', 'test/projectscaffold.test.mjs', 'failed acknowledgement leaves discovery refused', 'The binding at'],
  ['bin/commands/init.mjs', 'test/projectscaffold.test.mjs', 'project init warns about a refused outside vault binding only after acknowledgement failure', 'Warning: this binding names a vault outside the repository.'],
  ['bin/lib/resolve.mjs', 'docs/REFERENCE.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'commands/research-init.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'SECURITY.md', 'the outside vault rule is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'skills/research-vault-usage/SKILL.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'skills/research-orchestrate/SKILL.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'skills/research-claims-gate/SKILL.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'hooks/session-start.mjs', "the source label 'project' gates the workspace briefs"],
  ['bin/lib/projectconfig.mjs', 'docs/REFERENCE.md', 'EXTENSIBLE_TAXONOMY_FIELDS, topic_aliases, usage.text, the embedding block, the lab block and the non-extensible list'],
  ['bin/lib/embed.mjs', 'SECURITY.md', 'the third embedding gate, the request shape, the bearer key and the index file', 'RESEARCH_VAULT_EMBED_KEY'],
  ['bin/lib/embed.mjs', 'docs/REFERENCE.md', 'the index file path', 'embeddings.jsonl'],
  ['bin/lib/embed.mjs', 'SECURITY.md', 'the endpoint mismatch and request failure lines are quoted', /to allow this embedding endpoint|embedding endpoint request failed/],
  ['bin/lib/embed.mjs', 'test/embed.test.mjs', 'the embedding approval variable and refusal messages', 'RESEARCH_VAULT_EMBED_URL'],
  ['bin/lib/embed.mjs', 'test/search.test.mjs', 'the embedding approval variable and refusal messages', 'RESEARCH_VAULT_EMBED_URL'],
  ['bin/lib/embed.mjs', 'SECURITY.md', 'the three gates', 'RESEARCH_VAULT_ALLOW_NETWORK'],
  ['bin/commands/embed.mjs', 'SECURITY.md', 'the batch size', /BATCH = 64;|in batches of 64,/],
  ['bin/commands/embed.mjs', 'SECURITY.md', 'the window destination line before the first request is quoted', 'embed: sending '],
  ['bin/commands/search.mjs', 'SECURITY.md', 'the query destination line before the request is quoted', 'search: sending the query to '],
  ['bin/commands/embed.mjs', 'test/embed.test.mjs', 'the destination line before sending windows', 'embed: sending '],
  ['bin/commands/search.mjs', 'docs/REFERENCE.md', '--semantic, the stale weight and the refusals', 'semantic'],
  ['bin/commands/search.mjs', 'test/search.test.mjs', 'the destination line before sending a query', 'search: sending the query to '],
  ['bin/lib/usagelog.mjs', 'docs/REFERENCE.md', 'the usage log path and the event kinds and fields', 'usage.jsonl'],
  ['bin/lib/usagelog.mjs', 'SECURITY.md', 'the usage log path and the usage.text flag', 'usage.jsonl'],
  ['bin/lib/usagelog.mjs', 'vault-template/.gitignore', 'the log lives under _index/, which the template ignores', '_index'],
  ['bin/lib/projectconfig.mjs', 'commands/research-init.md', "the config keys and 'volatility defaults to fast'"],
  ['bin/commands/obsidian.mjs', 'commands/research-obsidian.md', "the '_obsidian' default", '_obsidian'],
  ['bin/commands/obsidian.mjs', 'SECURITY.md', 'the Obsidian view checks every destination against the resolved output directory', 'outside the output directory or cannot be resolved'],
  ['bin/lib/files.mjs', 'vault-template/.gitignore', 'SKIP_DIRS and the ignore list both name _index and _obsidian', '_obsidian'],
  ['bin/lib/capture-operation.mjs', 'vault-template/.gitignore', 'the receipt and lock directory the opt-in path writes is ignored', '.capture-operations'],
  ['skills/research-orchestrate/SKILL.md', 'vault-template/.gitignore', 'the run directory the Write step writes plans to is ignored', '.research-tasks'],
  ['bin/lib/files.mjs', '.gitignore', 'SKIP_DIRS and the ignore list both name _index and _obsidian', '_obsidian'],
  ['bin/lib/citations.mjs', 'bin/lib/gate.mjs', "checkCitations status values 'ok', 'stale', 'uncovered'"],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', 'VERDICTS, LEDGER_FILENAME and the fact:N/quiz:N unit names', '.research-vault-ledger.jsonl'],
  ['bin/lib/gate.mjs', 'agents/claims-reviewer.md', 'the renderEvidence line format, unit names and verdict tokens; recordVerdict hashes this file into the reviewer field'],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', "the 'image: <workspace-relative path> sha256:<hash>' evidence line and the img:<src> unit name are copied", 'image: '],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', "the 'image: <workspace-relative path> sha256:<hash>' evidence line and the img:<src> unit name are copied", 'image: '],
  ['bin/lib/gate.mjs', 'bin/lib/task.mjs', "taskFile builds the evidence/NNNN/requirements.json path that readRequirements reads", 'requirements.json'],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', "the Gate rule states that a checked task's step unit hashes evidence/NNNN/requirements.json, and that gate staged and the Stop hook take a lesson from that file", 'evidence/NNNN/requirements.json'],
  ['bin/lib/gate.mjs', 'agents/claims-reviewer.md', "the 'image: <path> sha256:<hash>' evidence line the reviewer may open", 'image: '],
  ['bin/lib/gate.mjs', 'hooks/stop-gate.mjs', 'the PASS|MERIT text the hook prints', 'MERIT'],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', 'the ledger filename and the verdicts', '.research-vault-ledger.jsonl'],
  ['bin/lib/gate.mjs', 'bin/lib/lesson.mjs', "unitHashes depends on the data-block names 'fact' and 'quiz'"],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', "changedCites's rules are restated: the changed units' citations, a changed row's section, the whole file's when none"],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', "changedCites's rules are restated: the changed units' citations, a changed row's section, the whole file's when none"],
  ['bin/commands/gate.mjs', 'agents/claims-reviewer.md', "the 'changed units:' line the gate prints is the line the agent keys on", 'changed units:'],
  ['bin/commands/gate.mjs', 'test/agent.test.mjs', 'the agent contract test runs gate evidence --changed and checks its printed prefix', 'changed units:'],
  ['bin/lib/codelinks.mjs', 'agents/claims-reviewer.md', "the sym: unit name and the 'unit sym:<name> <file>:<start>-<end> <status>' line format", 'sym:'],
  ['bin/lib/codelinks.mjs', 'skills/research-authoring/SKILL.md', 'the <id>@<key>=<version> link form and the stale reason tag', '<id>@<key>=<version>'],
  ['bin/lib/codelinks.mjs', 'docs/REFERENCE.md', 'the Lua row of LANGS is quoted as the language example'],
  ['bin/lib/projectconfig.mjs', 'test/projectconfig.test.mjs', 'the versions file validation message', 'must be a relative path inside the repository with no .. segment'],
  ['bin/lib/projectconfig.mjs', 'test/check.test.mjs', 'the versions file validation message', 'must be a relative path inside the repository with no .. segment'],
  ['bin/commands/check.mjs', 'test/check.test.mjs', 'the warning for a glob that matches no file', 'matched no file'],
  ['bin/commands/check.mjs', 'test/check.test.mjs', 'the unverified mark on an ok row and the summary', ', unverified'],
  ['bin/commands/check.mjs', 'docs/REFERENCE.md', 'the unverified mark on an ok row, the summary and the --json flag', ', unverified'],
  ['bin/commands/check.mjs', 'test/check.test.mjs', 'the ambiguous mark on a URL row held by more than one active entry', 'ambiguous: '],
  ['bin/commands/check.mjs', 'docs/REFERENCE.md', 'the ambiguous mark on a URL row held by more than one active entry', 'ambiguous: '],
  ['bin/commands/check.mjs', 'test/check.test.mjs', 'the --json candidates field of an ambiguous URL row', 'candidates'],
  ['bin/commands/check.mjs', 'docs/REFERENCE.md', 'the --json candidates field of an ambiguous URL row', 'candidates'],
  ['bin/lib/citations.mjs', 'bin/commands/check.mjs', 'the row fields unverified and candidates that checkCitations sets and check renders', 'candidates'],
  ['bin/lib/projectconfig.mjs', 'test/check.test.mjs', 'check prints the quoted-glob refusal', 'looks quoted; remove the quotes'],
  ['bin/lib/projectconfig.mjs', 'test/projectscaffold.test.mjs', 'init --project prints the quoted-glob refusal', 'looks quoted; remove the quotes'],
  ['bin/lib/codelinks.mjs', 'test/codelinks.test.mjs', 'the versions file path validation message', 'must be relative and contain no .. segment'],
  ['bin/lib/codelinks.mjs', 'test/codelinks.test.mjs', 'the versions file containment message', 'resolves outside the repository'],
  ['bin/lib/manifest.mjs', 'docs/REFERENCE.md', 'the manifest keys and entry fields listed under "Reading the graph from outside"'],
  ['bin/commands/check.mjs', 'docs/REFERENCE.md', 'the check --json keys and row fields listed under "Reading the graph from outside"', '--json'],
  ['bin/commands/gate.mjs', 'skills/research-claims-gate/SKILL.md', "the 'changed units:' line gate evidence prints is quoted", 'changed units:'],
  ['bin/commands/gate.mjs', 'skills/research-claims-gate/SKILL.md', "the 'review hash:' line gate evidence prints is kept for gate record --expect", 'review hash:'],
  ['bin/commands/gate.mjs', 'skills/research-claims-gate/SKILL.md', 'gate record takes the review hash with --expect', '--expect'],
  ['bin/commands/gate.mjs', 'docs/REFERENCE.md', "the 'review hash:' line gate evidence prints and its --json field are described", 'review hash:'],
  ['bin/commands/gate.mjs', 'docs/REFERENCE.md', 'the --expect flag of gate record and its exit codes are described', '--expect'],
  ['bin/commands/gate.mjs', 'docs/CODEX.md', "the 'review hash:' value is passed to gate record --expect after a Codex review", 'review hash:'],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', "a row recorded without --expect carries the 'manual' field, which no verdict check reads", 'manual'],
  ['bin/lib/fill.mjs', 'skills/research-claims-gate/SKILL.md', 'the seven fill results and the --fill/--ack-data-egress form are written out', 'version-floating'],
  ['bin/lib/fill.mjs', 'skills/research-verify/SKILL.md', "the 'filled:' note prefix of a fill's row is named", 'filled:'],
  ['bin/lib/fill.mjs', 'SECURITY.md', 'the file types --content-file takes and the 200-character floor are restated', '--content-file'],
  ['hooks/stop-gate.mjs', 'skills/research-claims-gate/SKILL.md', "the hook names the skill and the 'gate record <file> PASS|MERIT' form", 'gate record'],
  ['hooks/hooks.json', 'docs/REFERENCE.md', "'four Claude Code hooks' and their names", 'pre-web'],
  ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'the plugin name'],
  ['.claude-plugin/plugin.json', 'package.json', 'the version (test/manifests.test.mjs)'],
  ['.claude-plugin/plugin.json', 'skills/research-claims-gate/SKILL.md', 'the research-vault: dispatch prefix is the plugin name'],
  ['.claude-plugin/plugin.json', 'skills/research-teach/SKILL.md', 'the research-vault: dispatch prefix is the plugin name'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', 'the navigation bar: navHtml builds the same nav.lesson-nav and its three links for pages that do not load quiz.js, and renderNav builds it on a lesson page; given the index and a lesson id, navHtml also builds the previous, line N of M and next entries renderNav builds (classes, arrows, pathPosition), for an exported lesson', 'lesson-nav'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', 'the /lessons.json and POST /attempt routes, the {id,score,total} shape and the lines, line fields read by pathPosition; the results file resultsFile writes and importAttempts reads: format research-vault-attempts, version 1, workspace, and the attempt keys lesson, answers, at, total, wrong; exportPage writes data-export (workspaceKey, which quiz.js reads as the storage key and resultsFile workspace) and data-lesson on <body>, and ships quiz.js with each line-initial export removed, so quiz.js must hold no import and no other export form; with the brand dividers key, each divider entry in the lessons of /lessons.json carries the id that neighbours reads and the title and path that renderNav and navHtml read', '/lessons.json'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', 'the results file format name', 'research-vault-attempts'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/lesson.mjs', 'one attempt order: mergeQuizzes and lessonItems both put the predict item first (item 0), then the quiz items', 'lessonItems'],
  ['skills/research-teach/assets/quiz.js', 'skills/research-teach/LESSON-FORMAT.md', "the 'recorded <id>: <score>/<total>' and terminal strings, the Correct and Not this one marks, the role and aria-disabled attributes and the predict item 0 merge are quoted", 'Not this one'],
  ['bin/lib/cast.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Replays section restates PLAYER_FILES's two sha256 values and the version, and TOKEN_SHAPES' kinds", '752c9b528b664f5b16f27c68ba22fc7973d1d6063a1c3e4795a4c8015943acf6'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'block names (with complete, predict, connect and scaffold), MAX_INTRODUCES, QUIZ_MIN_ITEMS, QUIZ_SPREAD_MAX, FOLLOWUP and CONNECT_LEAD as prose, and WARN_CONNECT_LEAD named'],
  ['bin/lib/teach.mjs', 'skills/research-teach/LESSON-FORMAT.md', "EXPORT_TEXT's two replacements for FOLLOWUP and CONNECT_LEAD and MENTION_RE's three phrases are quoted in the connect rules", 'You can ask your instructor follow-up questions.'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/assets/lesson.css', 'the [data-block=...] selectors name the same blocks, complete, predict, connect and scaffold among them, each in the two-column span list', 'data-block'],
  ['skills/research-teach/LESSON-FORMAT.md', 'bin/lib/lesson.mjs', 'the shape table: the Shapes section is SHAPES (shape names, required middle blocks in order, the frame; the scaffold of a project is optional and not in SHAPES) and states the LESSON_SHAPE_UNKNOWN, LESSON_SHAPE_BLOCK_MISSING, LESSON_SHAPE_MISMATCH, LESSON_COMPLETE_NOT_WORKED, LESSON_PREDICT_INVALID and LESSON_PLAN_NO_ELEMENTS rules', 'SHAPES'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Checked task section's three scripts, requirements.json, ./check N step line, quoted requirement texts and experiment citation are what LESSON_TASK_INCOMPLETE checks, and what makes a project lesson a checked task", 'step does not hold the text of requirement'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'the TASK_REQUIREMENTS_INVALID code, on the requirements file, for its problems, an unknown record and a read that names nothing', 'TASK_REQUIREMENTS_INVALID'],
  ['bin/lib/lesson.mjs', 'docs/REFERENCE.md', 'the TASK_REQUIREMENTS_INVALID code of teach lint', 'TASK_REQUIREMENTS_INVALID'],
  ['bin/lib/task.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Checked task section states readRequirements's keys and limits, parseChecker's line forms and problems and reportLines's lines; the literal matches reportLines's FAIL line in the code and FAIL <id>: in the format", /FAIL (?:\$\{r\.id\}|<id>): /],
  ['bin/lib/task.mjs', 'skills/research-teach/LESSON-FORMAT.md', "reportLines's last line with hints held back", 'hints: ./check --hints'],
  ['bin/lib/task.mjs', 'SECURITY.md', "Local writers names teach check's scripts and the certification run's state file", '.teach-certify.json'],
  ['bin/lib/task.mjs', 'skills/research-teach/LESSON-FORMAT.md', "readRequirements's and parseChecker's words for LAB_TEXT_BAD_RE", 'control, line-separator or bidi character'],
  ['bin/lib/task.mjs', 'skills/research-teach/SKILL.md', "section 3 states the checker's output form and run.sh's ./check --dry-run --hints N; section 1 writes the ./check wrapper that runs teach check", './check'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "the teach check section quotes reportLines's lines and runChecker's and parseChecker's problems", 'output past 1 MiB'],
  ['bin/lib/task.mjs', 'SECURITY.md', 'the certification state refusal is quoted', 'cannot use as a regular workspace state file. Remove it by hand.'],
  ['bin/lib/task.mjs', 'SECURITY.md', 'the checker announcement is quoted', /check: evidence\/(?:\$\{nnnn\}|NNNN)\/check\.sh/],
  ['bin/lib/task.mjs', 'test/teach-task.test.mjs', 'the checker announcement on standard error', 'check: evidence/${nnnn}/check.sh'],
  ['bin/lib/task.mjs', 'bin/commands/teach.mjs', 'endRun passes the environment to the command checker that writes the announcement synchronously', /checker\(ws, t, env\)|checker: checkWithAnnouncement/],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', 'the teach check usage', 'check [--dry-run] [--hints] <N> [workspace]'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "next's answered: line, after review-failed:", 'answered:'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', "next's answered: line, which section 4 names", 'answered:'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "teach attempt add's --answered flag and its all value", '--answered'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'the skill records an answer with teach attempt add --answered', '--answered'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "taskSummary's answered form: the code's template and the docs' <ids> form", /answered (?:\$\{a\.answered|<ids>)/],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "taskSummary's certification form: the code's template and the docs' <ok> form", /certification (?:\$\{passed\.length\}|<ok>) of /],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "taskSummary's not reached part, also teach check's word for an unreached requirement", 'not reached'],
  ['bin/lib/task.mjs', 'schema/teach.schema.json', "checkAttempt's and answeredAttempt's fields are the attempt fields the schema orders", 'unreached'],
  ['bin/lib/teach.mjs', 'schema/teach.schema.json', 'isTaskAttempt reads the tested list the schema orders', 'tested'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "teach check's problem line on stderr: the code's template and the docs' NNNN form", /teach check: (?:\$\{nnnn\}|NNNN): /],
  ['bin/lib/task.mjs', 'skills/research-teach/SKILL.md', "D8's state file: the run's start creates it and the skill adds it to .gitignore and the workspace table", '.teach-certify.json'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "D8's state file and its keys, and the file an end renames it to", '.teach-certify.ending.json'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "openLine, teach next's line for an open run", 'certification: open'],
  ['bin/lib/task.mjs', 'skills/research-teach/SKILL.md', "openLine, teach next's line for an open run, which the skill reads", 'certification: open'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "teach next's grade line for the latest run: the code's template and the docs' <run id> form", /certification: (?:\$\{g\.id\}|<run id>) /],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "endRun's grade line: the code's template and the docs' <ok> form", /grade: (?:\$\{ok\}|<ok>) of (?:\$\{total\}|<total>) requirements/],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "endRun's pass line: the code's template and the docs' <P> form", /pass line (?:\$\{s\.pass\}|<P>)%: /],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "endRun's time line over a limit", 'over the limit of'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "the open run's tail, on runLine, the start's refusal and the end's problem line", 'end: ./check --certify; drop: ./check --cancel'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "startRun's line for a setup that does not exit 0", 'no run started; scopes already reset:'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "endRun's refusal of a run dropped or replaced during its checks", 'was dropped or replaced while it was being checked; nothing recorded'],
  ['bin/lib/task.mjs', 'test/teach-task.test.mjs', "endRun's refusal of a run dropped or replaced during its checks", 'was dropped or replaced while it was being checked; nothing recorded'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "the refusal of --hints while a run holds them back", 'hints are held back in certification run'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "cancelRun's line for an end that did not finish", 'attempts of the run may be recorded'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "cancelRun's line for a dropped run", 'nothing was recorded'],
  ['bin/lib/task.mjs', 'docs/REFERENCE.md', "startRun's lines on the ways to end", 'drop, recording nothing: ./check --cancel'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', 'the certification run usage', 'check --start <N>... [--minutes <M>] [--pass <P>] [--no-hints] [workspace]'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'the --start flag the skill gives the learner', 'check --start <N>'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'the --certify flag the skill names', 'check --certify'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'the --cancel flag the skill names', 'check --cancel'],
  ['skills/research-teach/SKILL.md', 'docs/REFERENCE.md', "the ./check wrapper's second line, which the skill writes and the teach check section gives a learner with no agent", 'exec node "<absolute plugin root>/bin/research-vault.mjs" teach check "$@"'],
  ['bin/commands/teach.mjs', 'skills/research-teach/LESSON-FORMAT.md', "teach check's problem line on stderr: the code's template and the format's NNNN form", /teach check: (?:\$\{nnnn\}|NNNN): /],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', "teach check's problem line on stderr, named for run.sh's check code 2: the code's template and the skill's NNNN form", /teach check: (?:\$\{nnnn\}|NNNN): /],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the read-only allowlist, deny list and redirection rule of the Checked task section's safety rule 2 are TASK_READ_ONLY, TASK_DENY and the redirect test WARN_TASK_CHECK_MUTATES checks", 'api-resources'],
  ['bin/lib/lesson.mjs', 'test/fixtures/teach/lessons/0004-tool-fxctl.html', 'the shape table: the tool fixture (data-shape, data-teaches, complete) lints clean against SHAPES; its plan has an Elements part', 'data-shape'],
  ['test/fixtures/teach/assets/fxctl.cast', 'test/fixtures/teach/lessons/0004-tool-fxctl.html', 'the example block replays the cast, and the <pre> after its data-cast element is teach cast transcript of the cast: record the cast again and paste its transcript again', '$ fxctl run 7'],
  ['bin/lib/lesson.mjs', 'test/fixtures/teach/lessons/0005-diagnose-fx.html', 'the shape table: the diagnose fixture (predict with one item) lints clean against SHAPES; its plan has an Elements part', 'data-shape'],
  ['bin/lib/lesson.mjs', 'test/fixtures/teach/lessons/0006-project-fx.html', 'the shape table: the project fixture (an optional scaffold, then step) lints clean against SHAPES; its plan has an Elements part', 'data-shape'],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/assets/lesson.css', "the block label list: the Blocks table's Label column is each block's ::before content"],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/assets/lesson.css', 'fact and example span from 1100px, so the format may say below and above between them', '1100px'],
  ['skills/research-teach/assets/reading.html', 'skills/research-teach/LESSON-FORMAT.md', 'the reading page explains every label of the Blocks table, one data-block section per label', 'say it back'],
  ['bin/lib/teach.mjs', 'skills/research-teach/assets/reading.html', 'indexHtml links the reading page at /assets/reading.html by its title; teach export ships this page, so it must name no place to answer or ask that MENTION_RE matches', 'How to read a lesson'],
  ['skills/research-teach/assets/quiz.js', 'skills/research-teach/assets/reading.html', 'the navigation bar links the reading page at /assets/reading.html as How to read', 'How to read'],
  ['skills/research-teach/LESSON-FORMAT.md', 'bin/lib/lesson.mjs', 'the figure constants: a 440-unit viewBox, 14-unit labels and 40-character labels are FIGURE_VIEWBOX_MAX, FIGURE_LABEL_MIN and FIGURE_LABEL_MAX', /\b440\b/],
  ['bin/lib/lesson.mjs', 'skills/research-teach/assets/lesson.css', 'the figure constants: FIGURE_VIEWBOX_MAX 440 units draws at scale 1 at the figure svg min-width 27.5rem (440px)', /\b440\b/],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'TIME_WORDS is written out in the Prose section', 'nowadays'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/MISSION-FORMAT.md', 'the Floor, Known tools, Known terms and New to me headings are parsed', 'New to me'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/README-FORMAT.md', 'README_SECTIONS are the five ## headings of the template, in order, and the lint reads them case-insensitively', 'Before you start'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/README-FORMAT.md', 'What lint checks names README_TERM_NOT_INTRODUCED, WARN_README_EVIDENCE_LINK and WARN_README_SECTION_MISSING and what each reads', 'WARN_README_EVIDENCE_LINK'],
  ['bin/lib/lesson.mjs', 'docs/REFERENCE.md', 'the teach section names the README lint codes and WARN_CONNECT_LEAD with CONNECT_LEAD', 'README_TERM_NOT_INTRODUCED'],
  ['bin/lib/teach.mjs', 'skills/research-teach/README-FORMAT.md', "readmeDraft's output is stated: the two tables' columns, (no Project: line), (review), the lessons/files/<directory>/ cell and the no-lab line; EXPORT_TEXT.howToTake, the How to take it body in an exported index.html, is quoted", '(no Project: line)'],
  ['agents/lesson-reader.md', 'skills/research-teach/SKILL.md', 'section 5 dispatches the reader with the README path for its README mode', 'README mode'],
  ['agents/lesson-reader.md', 'skills/research-teach/README-FORMAT.md', 'the Gated like a lesson rule names the reader in README mode', 'README mode'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "the teach section restates readmeDraft's output: (no Project: line), (review), the lab rows and the no-lab line, and states what markdownHtml renders on / and its escaping and link rule, and importAttempts's results file keys, checks and file:, attempt <n>:, skipped, changed and recorded lines, and exportWorkspace's file set, exportPage's rewrites, EXPORT_TEXT, MENTION_RE (what pageText and markdownText leave for it) and the not gated, ungated, skipped, mention, unknown-source, case-collision and source lines", '(no Project: line)'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/PATH-FORMAT.md', 'the PATH.md line grammar is parsed; PATH_AFTER_FORWARD, PATH_AFTER_CYCLE, PATH_PROJECT_AFTER and WARN_PATH_TERM_UNPLANNED are named; the after: proposal rule of teach path edges, which skips Project: lines, and the inner fringe that counts a Project: line as a review are stated', 'PATH_PROJECT_AFTER'],
  ['bin/commands/teach.mjs', 'skills/research-teach/PATH-FORMAT.md', 'the PATH.md line grammar is parsed by next, which prints the fringe: and inner: lines (a built Project: line keeps the lines it names inner)'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', "the teach verbs, the serving line, .teach-serve.json, the line N of M nav and the index grouped by Project: line with each shape, the fringe: and inner: lines, teach attempt add with --answers, --result pass|fail and --answered, teach attempt import, teach path candidates with its no line and term groups, teach path edges, and teach export with its mention and source lines and --skip-ungated are quoted; next's readme: missing | ungated | ok line after fringe: complete is named in section 4, quoted in section 6; next's preferences: and preferences-unset: lines, and its review-due: line only with reminders, are named in section 4", '.teach-serve.json'],
  ['bin/lib/lesson.mjs', 'bin/commands/related.mjs', 'path candidates prints `related <id> --depth 2` as the query behind a linked candidate'],
  ['bin/lib/lesson.mjs', 'docs/REFERENCE.md', 'the prose line shape: paragraphs, sentences, avg words, longest', 'longest'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'the --prose flag of teach lint', 'prose'],
  ['skills/research-teach/SKILL.md', 'skills/research-teach/MISSION-FORMAT.md', 'the term check, the tool question and the environment question of the interview are restated in both; the option order (the lab tooling of the repo first when it has one, then `Docker or kind on this machine`) is in SKILL.md only', 'Task environment'],
  ['bin/commands/teach.mjs', 'SECURITY.md', ".teach-serve.json and its { port, pid }, the listen(0, '127.0.0.1') binding and the serving line", '127.0.0.1'],
  ['bin/lib/teach.mjs', 'skills/research-teach/SKILL.md', "the lesson URL's /lessons/<id>.html path", '/lessons/'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "next's preferences: line, after review-failed:", 'preferences:'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "next's preferences-unset: line, naming each preference with no bullet read", 'preferences-unset:'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', "next's preferences: line, which the skill reads for the learner's answers", 'preferences:'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', "next's preferences-unset: line, on which the skill asks the preferences dialog", 'preferences-unset:'],
  ['bin/lib/lesson.mjs', 'docs/REFERENCE.md', 'the MISSION_PREF_INVALID code of teach lint', 'MISSION_PREF_INVALID'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/MISSION-FORMAT.md', 'the MISSION_PREF_INVALID code for a preference bullet that is not read', 'MISSION_PREF_INVALID'],
  ['bin/lib/teach.mjs', 'skills/research-teach/MISSION-FORMAT.md', 'missionPrefs reads the Hints:, Path reviews: and Reminders: bullets under the Constraints heading in the forms the template and the Rules state, and the absent values always, no and none', 'Reminders:'],
  ['bin/lib/teach.mjs', 'SECURITY.md', 'ATTEMPT_BODY_MAX, the allowlisted dirs, the exact Host 127.0.0.1:<port> check, and what GET / and /lessons.json read and return; what importAttempts checks and writes, RESULTS_MAX as 1 MiB; what exportWorkspace copies and leaves out, serveFile not following a symlinked GLOSSARY.md, what sources.html carries and escapes, the wx flag, containment check and cleanup of writeExport, and what an exported page loads', 'ATTEMPT_BODY_MAX'],
  ['bin/commands/teach.mjs', 'SECURITY.md', 'the serve state refusal is quoted', 'cannot use as a regular workspace state file'],
  ['bin/commands/teach.mjs', 'SECURITY.md', 'the serve startup warning for an invalid brand is quoted', 'brand: brand/brand.json is invalid; run teach lint'],
  ['bin/lib/teach.mjs', 'SECURITY.md', 'the export path finding and refusal lines are quoted', /unservable |paths resolve outside their allowed locations or cannot be resolved; nothing written/],
  ['bin/commands/refresh.mjs', 'SECURITY.md', 'RESEARCH_VAULT_ALLOW_NETWORK and --dry-run', 'RESEARCH_VAULT_ALLOW_NETWORK'],
  ['bin/commands/refresh.mjs', 'skills/research-verify/SKILL.md', 'the --json result keys, storedBody among them', 'storedBody'],
  ['bin/commands/refresh.mjs', 'docs/REFERENCE.md', 'the --json result keys, storedBody among them', 'storedBody'],
  ['bin/commands/export.mjs', 'SECURITY.md', 'the export flag semantics'],
  ['bin/lib/exportjsonl.mjs', 'docs/FINETUNING.md', 'the record shape, the meta fields and the chunk window rule', 'last_verified'],
  ['bin/commands/export.mjs', 'docs/REFERENCE.md', 'the chunk, overlap, fresh-only and min-authority flags', 'min-authority'],
  ['bin/commands/export.mjs', 'docs/FINETUNING.md', 'the chunk, overlap, fresh-only and min-authority flags', 'min-authority'],
  ['skills/research-teach/LESSON-FORMAT.md', 'test/fixtures/teach/lessons/0001-good.html', 'the single ```html example is byte-identical to the fixture'],
  ['bin/lib/lintrules.mjs', 'scripts/check-encoding.mjs', 'the mojibake regex and the BOM/CR checks are duplicated', '\\u00C3\\u00A2\\u00E2\\u201A\\u00AC'],
  ['bin/lib/lintrules.mjs', 'docs/REFERENCE.md', 'lint codes are documented by name'],
  ['bin/lib/lintrules.mjs', 'docs/ORCHESTRATOR-INTEGRATION.md', 'WARN_SYNTHESIS_* codes and the 1500-word limit', 'WARN_SYNTHESIS_'],
  ['bin/lib/lintrules.mjs', 'bin/lib/agentsmd.mjs', 'WARN_MISSING_SUMMARY and WARN_SOURCE_UNVERIFIED are named in the generated AGENTS.md', 'WARN_SOURCE_UNVERIFIED'],
  ['bin/lib/lintrules.mjs', 'SECURITY.md', 'the warning code for a skipped entry link', 'WARN_ENTRY_LINK_SKIPPED'],
  ['bin/lib/lintrules.mjs', 'test/vault-links.test.mjs', 'the warning code for a skipped entry link', 'WARN_ENTRY_LINK_SKIPPED'],
  ['bin/lib/capture-operation.mjs', 'test/vault-links.test.mjs', 'the linked destination refusal message', 'destination is not a regular file'],
  ['bin/commands/search.mjs', 'test/vault-links.test.mjs', 'the warning for an outside usage log', 'usage log was not written because it resolves outside the vault'],
  ['bin/lib/projectconfig.mjs', 'test/vault-links.test.mjs', 'the existing binding refusal message', 'already exists at'],
  ['bin/lib/lintrules.mjs', 'skills/research-authoring/SKILL.md', 'lint codes are named in prose', 'WARN_SOURCE_UNVERIFIED'],
  ['bin/lib/lintrules.mjs', 'skills/research-capture/SKILL.md', 'lint codes are named in prose', 'WARN_MISSING_SUMMARY'],
  ['bin/lib/lintrules.mjs', 'skills/research-review/SKILL.md', 'lint codes are named in prose', 'WARN_SOURCE_UNVERIFIED'],
  ['bin/lib/lintrules.mjs', 'skills/research-orchestrate/SKILL.md', 'lint codes are named in prose', 'WARN_SYNTHESIS_MONOLITHIC'],
  ['bin/lib/advise.mjs', 'skills/research-librarian/SKILL.md', "'thirteen sections', their list and OPEN_QUESTION_DAYS as 60 days", /\b60\b/],
  ['bin/lib/advise.mjs', 'skills/research-librarian/SKILL.md', 'the field of a pair at one source_url with one version absent', 'source_url-unversioned'],
  ['bin/lib/advise.mjs', 'docs/REFERENCE.md', 'OPEN_QUESTION_DAYS is written as 60 days in the advise row', /\b60\b/],
  ['bin/lib/advise.mjs', 'bin/commands/search.mjs', 'the queried event fields kind, ids, topic and outcome that the usage report counts', 'no-match'],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/SKILL.md', "the mission block's sentence list (the win, the idea, the activity) is restated in step 5; the checked task's setup.sh, check.sh, solution.sh and requirements.json, the checker's ok <id> and FAIL <id>: <hint> lines, and the run.sh sequence (setup, ./check --dry-run --hints N, solution, check, setup, check, exit 0 on 1, 0, 1) are stated in section 3, and the file's rules, the output and the step form in Checked task", 'the idea'],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/SKILL.md', "run.sh's check line, which the experiment's Result quotes and the step's ./check N line does not", './check --dry-run --hints'],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/MISSION-FORMAT.md', "the Checked task paragraph scopes setup.sh and solution.sh to the environment MISSION.md's Task environment: bullet names", 'Task environment'],
  ['bin/lib/advise.mjs', 'hooks/pre-web.mjs', "the queried event's kind and ids that the usage report counts", "'queried'"],
  ['bin/lib/advise.mjs', 'hooks/post-tool-use.mjs', "the cited event's kind and id that the usage report counts", "'cited'"],
  ['bin/commands/capture.mjs', 'skills/research-orchestrate/SKILL.md', 'the --batch camelCase keys', 'contributingIds'],
  ['bin/lib/fetchsource.mjs', 'test/fetchsource.test.mjs', 'the fetch deadline diagnostic is asserted', 'fetch deadline exceeded'],
  ['bin/lib/fetchsource.mjs', 'test/fetchsource.test.mjs', 'the default fetch deadline is asserted in milliseconds', '60000'],
  ['bin/lib/fetchsource.mjs', 'test/fetchsource.test.mjs', 'the malformed redirect diagnostic is asserted', 'malformed redirect Location'],
  ['bin/lib/quotes.mjs', 'skills/research-orchestrate/SKILL.md', 'the Write prompt names the fields verify --quotes prints', 'foundIn'],
  ['bin/lib/quotes.mjs', 'docs/REFERENCE.md', 'the verify row states the rule of a found quote: one line, or adjacent lines with no blank line between them', 'quote-matched'],
  ['bin/lib/quotes.mjs', 'docs/RELIABILITY.md', 'research task recovery states the rule of a found quote: one line, or adjacent lines with no blank line between them', 'quote-matched'],
  ['bin/lib/packet.mjs', 'bin/lib/quotes.mjs', 'the note form of a quote-matched body row: quotes writes it, packet parses it; the run key pattern is shared', 'RUN_KEY'],
  ['bin/lib/packet.mjs', 'skills/research-claims-gate/SKILL.md', 'step 1b states the packet rules: lines within three of a quote, refused for another run\'s rows, cannot pass a draft', 'cannot pass'],
  ['bin/commands/gate.mjs', 'skills/research-claims-gate/SKILL.md', 'step 1b names --packet and --run and the packet: line', '--packet'],
  ['bin/lib/fill.mjs', 'skills/research-orchestrate/SKILL.md', 'the Write prompt lists the fill results and the flags it must not pass', 'version-floating'],
  ['bin/lib/fill.mjs', 'skills/research-orchestrate/SKILL.md', 'the script\'s FLOATING regular expression and the list in section 3 copy the nine words of FLOATING in fill.mjs; test/skills.test.mjs compares the three lists', 'nightly'],
  ['bin/commands/capture.mjs', 'skills/research-capture/SKILL.md', 'the --batch camelCase keys', 'contributingIds'],
  ['bin/commands/capture.mjs', 'SECURITY.md', 'the network gate of the URL-list ingest', 'RESEARCH_VAULT_ALLOW_NETWORK'],
  ['bin/commands/capture.mjs', 'docs/REFERENCE.md', 'the three --batch inputs and --continue', 'continue'],
  ['bin/commands/capture.mjs', 'skills/research-capture/SKILL.md', 'the three --batch inputs and --continue', 'continue'],
  ['bin/lib/blocklist.mjs', 'docs/REFERENCE.md', 'the blocklist path, its row shape and the two scopes', 'source-blocklist.json'],
  ['bin/lib/blocklist.mjs', 'skills/research-capture/SKILL.md', 'the blocklist path and its row shape', 'source-blocklist.json'],
  ['hooks/pre-web.mjs', 'docs/REFERENCE.md', 'the blocklist warning before a fetch', 'blocklist'],
  ['hooks/pre-web.mjs', 'test/preweb.test.mjs', 'the line for a URL held by more than one active entry', 'captured as more than one entry'],
  ['hooks/pre-web.mjs', 'docs/REFERENCE.md', 'the line for a URL held by more than one active entry', 'captured as more than one entry'],
  ['hooks/pre-web.mjs', 'test/preweb.test.mjs', 'the line for a captured URL', 'Cite it; do not capture a duplicate.'],
  ['bin/lib/agentsmd.mjs', 'docs/ORCHESTRATOR-INTEGRATION.md', 'AGENTS.md §2.6 is cited by number', '§2.6'],
  ['bin/lib/agentsmd.mjs', 'docs/REFERENCE.md', 'AGENTS.md §5 and §5.2 are cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-vault-usage/SKILL.md', 'AGENTS.md §2.7 and §5.2 are cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-capture/SKILL.md', 'AGENTS.md §2.5 and §2.6 are cited by number', '§2.5'],
  ['bin/lib/agentsmd.mjs', 'skills/research-orchestrate/SKILL.md', 'AGENTS.md §2.6 is cited by number', '§2.6'],
  ['bin/lib/agentsmd.mjs', 'skills/research-review/SKILL.md', 'AGENTS.md §2.6 is cited by number', '§2.6'],
  ['bin/lib/agentsmd.mjs', 'vault-template/meta/freshness-policy.md', 'freshness-policy §8 is cited by number', '§8'],
  ['vault-template/meta/freshness-policy.md', 'vault-template/meta/prompt-templates/probe-tool.md', 'freshness-policy §8 is cited by number', '§8'],
  ['.github/workflows/ci.yml', 'docs/ADOPTING.md', 'the adopter CI example repeats the CI Node line (26)', /node: \[26\]|node-version: 26/],
  ['.github/workflows/ci.yml', 'docs/REFERENCE.md', 'the CI matrix Node line (26), operating systems and steps are restated', /node: \[26\]|Node 26/],
  ['.gitattributes', 'scripts/check-encoding.mjs', 'eol=lf keeps the CR gate green on Windows'],
  ['scripts/check-encoding.mjs', 'test/git.test.mjs', 'the encoding regression asserts the CRLF diagnostic and encoding ok output'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "the teach section states next's readme: line, its three values and when each is printed, and teach attempt import's exit 2 lines, cannot read and over 1 MiB, and teach export's exit 2 lines (no vault, inside the vault or a workspace directory, not an empty directory), its stderr refusal line, its cannot write line and its wrote line", 'readme: ungated'],
  ['bin/commands/teach.mjs', 'skills/research-teach/README-FORMAT.md', "the Gated like a lesson rule states next's readme: line and its three values", 'readme: ungated'],
  ['bin/lib/labs.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Labs section states readLabs's manifest keys, limits (cost 200, timeout 7200, checks 10), LAB_TEXT_BAD_RE as words, the three roots, the id, env and path patterns, and labPin's key order", '^[A-Za-z0-9._/-]+$'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'the Labs section names the eight LAB_* codes and quotes their messages', 'read the change, then copy sha256'],
  ['bin/lib/teach.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Labs section quotes labStepsHtml's elements and LAB_OPEN_LINE", 'To run this lab from the page, open the lab address teach serve printed when it started.'],
  ['bin/lib/teach.mjs', 'skills/research-teach/README-FORMAT.md', "readmeDraft's manifest row (labs/labs.json: <id>, <cost>; env: <names or none>, an escaped |) is stated", 'labs/labs.json: '],
  ['bin/lib/labs.mjs', 'SECURITY.md', 'the Lab runs section states LAB_BODY_MAX, the cookie name, LAB_ID_RE, the scripts each action hashes and every labRefusal body', 'rv-labs-'],
  ['bin/lib/labs.mjs', 'docs/REFERENCE.md', "the teach section quotes labRefusal's busy and not running bodies, the runner's final lines, the redaction marker and the limits (5 s, 10 s, 1 MiB)", 'lab: verify pass'],
  ['bin/lib/labs.mjs', 'SECURITY.md', 'the Lab runs section states STOP_GRACE, KILL_WAIT, CHECK_TIMEOUT, LAB_OUTPUT_MAX, the 65536-character line rule, LAB_ENV_ALLOW by name, the spawn options, the 503 while stopping and every final line', 'LAB_ENV_ALLOW'],
  ['bin/lib/labs.mjs', 'SECURITY.md', "the What runs bullet states launch()'s refusal of a script whose first two bytes are not #!", 'could not start: ENOEXEC'],
  ['bin/lib/lesson.mjs', 'bin/lib/labs.mjs', "launch() repeats LAB_SCRIPT_NOT_RUNNABLE's test of the first two bytes for #!", 'LAB_SCRIPT_NOT_RUNNABLE'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', "renderLab acts on data-lab-live and data-lab-verify, which withLabSteps adds under --labs on a request with the cookie, and posts {\"lab\": \"<id>\"} to the /lab/<action> routes", 'data-lab-live'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/labs.mjs', "labStatus takes the status from a final line starting 'lab: ', which only the runner writes: lineRedactor puts '> ' before a script piece starting lab:", "startsWith('lab:"],
  ['skills/research-teach/assets/quiz.js', 'skills/research-teach/LESSON-FORMAT.md', "the Labs section names renderLab's buttons, its output pre and its status line", 'Check my work'],
  ['bin/commands/teach.mjs', 'SECURITY.md', "serve's start warning line and its SIGINT, SIGTERM and SIGHUP handlers under --labs are stated", 'holds the value of'],
  ['bin/lib/teach.mjs', 'SECURITY.md', "exportWorkspace's secret and lab-manifest refusals are quoted", 'lab-manifest labs/labs.json: invalid; run teach lint'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "exportWorkspace's secret and lab-manifest refusals are quoted", 'lab-manifest labs/labs.json: invalid; run teach lint'],
  ['bin/lib/teach.mjs', 'test/teach-containment.test.mjs', 'the export tests check the path refusal', 'teach export: paths resolve outside their allowed locations or cannot be resolved; nothing written'],
  ['bin/lib/teach.mjs', 'test/teach-export.test.mjs', 'the glossary export test checks the unservable line and path refusal', 'teach export: paths resolve outside their allowed locations or cannot be resolved; nothing written'],
  ['bin/lib/labs.mjs', 'test/teach-containment.test.mjs', 'the lab refusal test checks the response for a missing pin', "no lesson stores this lab's current pin"],
  ['bin/lib/teach.mjs', 'SECURITY.md', "createServer's lab address flow (303, the Set-Cookie attributes, next, reusable for the life of the server), the two framing headers under --labs and the lab POST checks 1 to 5 are stated", 'HttpOnly; SameSite=Strict; Path=/'],
  ['bin/commands/teach.mjs', 'SECURITY.md', 'the labs: open line and the exit 2 on an invalid labs.json are quoted', '/labs/open?t='],
  ['bin/lib/brand.mjs', 'skills/research-teach/assets/lesson.css', "BRAND_TOKENS is read from lesson.css's first :root block, and brandCss copies its two dark selectors", ':root:not([data-theme="light"])'],
  ['bin/lib/brand.mjs', 'skills/research-teach/BRAND-FORMAT.md', "the format states readBrand's keys (dividers among them), its path, colour, family and audience rules and the eight-alias limit, and withBrand's link, style, header and footer", 'brand-footer'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "serve's start line for an invalid brand.json is quoted", 'brand: brand/brand.json is invalid; run teach lint'],
  ['bin/commands/teach.mjs', 'test/teach-containment.test.mjs', 'the server test checks the invalid brand startup line', 'brand: brand/brand.json is invalid; run teach lint'],
  ['bin/commands/teach.mjs', 'test/teach-containment.test.mjs', 'the mission link test checks the CLI usage line', 'usage: research-vault teach record add|supersede ...'],
  ['bin/commands/teach.mjs', 'test/teach-containment.test.mjs', 'the next test checks the README status after a complete path', 'readme: ungated'],
  ['bin/commands/teach.mjs', 'test/teach-write-containment.test.mjs', 'the serve tests check the state file refusal', 'cannot use as a regular workspace state file'],
  ['bin/commands/teach.mjs', 'test/teach-write-containment.test.mjs', 'the serve tests read the workspace and the port from the serving line', 'serving '],
  ['bin/lib/containment.mjs', 'SECURITY.md', 'the threat model states the limits of comparing resolved path names'],
  ['bin/lib/containment.mjs', 'test/teach-write-containment.test.mjs', 'the teach write tests check the workspace folder refusal', 'path is outside its workspace folder or cannot be resolved'],
  ['bin/commands/teach.mjs', 'test/teach-write-containment.test.mjs', 'the check test uses the dry-run flag to verify it does not require the attempts folder', "'dry-run'"],
  ['bin/lib/task.mjs', 'test/teach-write-containment.test.mjs', 'the certification tests check the state file refusal', 'Remove it by hand.'],
  ['bin/lib/teach.mjs', 'test/teach-write-containment.test.mjs', 'the attempt import test checks the recorded line', 'recorded '],
  ['bin/lib/teach.mjs', 'test/teach-write-containment.test.mjs', 'the serve test checks the attempt refusal when the workspace location changes', 'workspace location changed or cannot be resolved'],
  ['bin/research-vault.mjs', 'test/teach-write-containment.test.mjs', 'the attempt CLI tests check the dispatcher error prefix', 'error: '],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "exportWorkspace's brand refusal is quoted", 'brand brand/brand.json: invalid; run teach lint'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/BRAND-FORMAT.md', "the Lint section names lintWorkspace's BRAND_ codes (dividers.image under BRAND_FILE_MISSING, dividers under BRAND_ALT_MISSING), the contrast pairs and threshold, the style-colour forms and BRAND_VOICE's prose", 'BRAND_OFF_PALETTE'],
  ['bin/lib/teach.mjs', 'skills/research-teach/BRAND-FORMAT.md', "the Dividers section states the divider address createServer serves and exportWorkspace writes, the reading order withDividers builds and the page dividerHtml writes", '/dividers/'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', 'the teach section states the divider address createServer serves and exportWorkspace writes', '/dividers/'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', 'the terminal: open line serve prints under --terminal without --labs is quoted', 'terminal: open http://127.0.0.1:'],
  ['bin/commands/teach.mjs', 'SECURITY.md', 'the terminal: open line serve prints under --terminal without --labs is quoted', 'terminal: open http://127.0.0.1:'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'section 5 quotes the terminal: open line serve prints under --terminal without --labs', 'terminal: open http://127.0.0.1:'],
  ['bin/lib/teach.mjs', 'skills/research-teach/SKILL.md', "section 5 opens the address with next=/term/lessons/<id>.html, which createServer's /labs/open accepts under --terminal", '/term/lessons/'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "serve's refusal of --terminal without python3 and its pty module is quoted", 'teach serve: --terminal needs python3 with its pty module'],
  ['bin/commands/teach.mjs', 'SECURITY.md', "serve's refusal of --terminal without python3 and its pty module is quoted", 'teach serve: --terminal needs python3 with its pty module'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "the teach serve section states createServer's /term/ routes, their bodies and refusals, next=/term/lessons/ and the --terminal framing headers", '/term/stream'],
  ['bin/lib/teach.mjs', 'SECURITY.md', "the Terminal section states createServer's /term/ routes, their checks, bodies and refusals, next=/term/lessons/ and the --terminal framing headers", 'no terminal cookie; open the address teach serve printed'],
  ['bin/lib/teach.mjs', 'SECURITY.md', "the Terminal section states createServer's GET /term/lessons/<lesson id>.html (termPage) and GET /terminal/<file> (TERMINAL_FILES by name)", '/terminal/'],
  ['bin/lib/terminal.mjs', 'SECURITY.md', "the Terminal section states the helper's pty, the shell's environment, KEPT_MAX, UNSENT_MAX and the SIGHUP and SIGKILL to the helper's group", 'xterm-256color'],
  ['bin/lib/terminal.mjs', 'SECURITY.md', 'the Python preflight command is quoted', '-I -c "import pty"'],
  ['bin/lib/terminal.mjs', 'test/teach-labs.test.mjs', 'the serve source scan checks Python argument and spawn option tokens', 'import pty'],
  ['bin/lib/terminal.mjs', 'test/terminal.test.mjs', 'the terminal tests pin both isolated starts at the file-system root, the workspace and launcher arguments, and the shell environment for both launcher variables', /PYTHONEXECUTABLE|__PYVENV_LAUNCHER__/],
  ['bin/lib/teach.mjs', 'skills/research-teach/terminal/terminal.mjs', 'the page reads the shell\'s output on the route createServer answers', '/term/stream'],
  ['bin/lib/teach.mjs', 'skills/research-teach/terminal/terminal.mjs', 'the page posts what is typed to the route createServer answers', '/term/input'],
  ['bin/lib/teach.mjs', 'skills/research-teach/terminal/terminal.mjs', 'the page posts its size to the route createServer answers', '/term/resize'],
  ['bin/lib/teach.mjs', 'skills/research-teach/terminal/terminal.mjs', 'INPUT_MAX, the body size the input queue splits at, is TERM_BODY_MAX', '65536'],
  ['bin/lib/teach.mjs', 'skills/research-teach/terminal/terminal.mjs', 'the script opens the terminal in the .term-screen element and finds the frame of the page termPage builds', 'term-screen'],
  ['bin/lib/terminal.mjs', 'docs/REFERENCE.md', "the teach serve section states the shell's environment, KEPT_MAX, UNSENT_MAX and the SIGHUP and SIGKILL to the helper's group", 'xterm-256color'],
  ['bin/lib/node-floor.mjs', 'test/smoke.test.mjs', 'the old-Node refusal line', 'or newer is required'],
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ext = f => posix.extname(f);
const read = f => readFileSync(join(REPO_ROOT, f), 'utf8');
const lsFiles = (...flags) => runGit(['ls-files', '-z', '--exclude-standard', ...flags], { processCwd: REPO_ROOT, timeout: 0, stderr: 'inherit' }).split('\0').filter(Boolean);
const fmName = text => text.match(/^---\n[\s\S]*?^name:\s*(\S+)/m)?.[1];
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
const imports = (file, text) => [...text.matchAll(IMPORT_RE)].map(m => posix.normalize(posix.join(posix.dirname(file), m[1])));

// The flags a command accepts: every args.<flag> and args['<flag>'] read in its module and in the
// bin/lib modules it imports directly.
// ponytail: a flag read by a shared lib module is accepted for every command importing it, and a
// boolean flag missing from BOOL in bin/lib/args.mjs is not detected.
function flagsOf(file) {
  if (!existsSync(join(REPO_ROOT, file))) return new Set();
  const text = read(file);
  const libs = imports(file, text).filter(t => t.startsWith('bin/lib/') && existsSync(join(REPO_ROOT, t)));
  return new Set([text, ...libs.map(read)].flatMap(t => [...t.matchAll(/\bargs(?:\.([\w$]+)|\['([^']+)'\])/g)].map(m => m[1] ?? m[2]).filter(f => f !== 'mjs')));
}

// The universe: tracked and untracked files that are not ignored and still exist (a tracked file
// that .gitignore lists, such as a force-added spec, is ignored too). Names resolve from files.
export function context() {
  const ignored = new Set(lsFiles('--cached', '--ignored'));
  const files = lsFiles('--cached', '--others').filter(f => !ignored.has(f) && existsSync(join(REPO_ROOT, f))).sort();
  const commands = [...read('bin/research-vault.mjs').matchAll(/^\s+(\w+): \(\) => import\(/gm)].map(m => m[1]);
  const scripts = Object.keys(JSON.parse(read('package.json')).scripts ?? {});
  const names = {};
  for (const f of files) {
    if (/^agents\/[^/]+\.md$/.test(f)) names[fmName(read(f))] = { kind: 'invokes-agent', file: f };
    else if (/^skills\/[^/]+\/SKILL\.md$/.test(f)) names[fmName(read(f))] = { kind: 'invokes-skill', file: f };
    else if (/^commands\/[^/]+\.md$/.test(f)) names[posix.basename(f, '.md')] = { kind: 'invokes-command', file: f };
  }
  const topDirs = [...new Set(files.filter(f => f.includes('/')).map(f => f.split('/')[0]))];
  const rootFiles = files.filter(f => !f.includes('/'));
  const flags = Object.fromEntries(commands.map(c => [c, flagsOf(`bin/commands/${c}.mjs`)]));
  return { files, commands, scripts, names, topDirs, rootFiles, flags };
}

// A quoted top-level directory as a call argument followed by further quoted segments (the join(root,
// 'schema', 'x.json') form), or a single-quoted path literal. A directory expands to every file under it.
function reads(text, ctx) {
  // ponytail: docs/ is also the layout test/gate.test.mjs gives its temp repos, so literals under it
  // are skipped; a test that reads docs/ would go unseen.
  const dirs = ctx.topDirs.filter(d => d !== 'docs').map(esc).join('|');
  const out = [...text.matchAll(new RegExp(`(?<=[(,]\\s*)'(${dirs})'((?:,\\s*'[^']+')*)`, 'g'))]
    .map(m => posix.join(m[1], ...[...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])));
  out.push(...[...text.matchAll(new RegExp(`'((?:${dirs})/[^'\\n*]*\\.(?:mjs|js|md|json|yml))'`, 'g'))].map(m => m[1]));
  return out.flatMap(p => { const under = ctx.files.filter(f => f.startsWith(p + '/')); return under.length ? under : [p]; });
}

function documents(file, text, ctx) {
  const t = text.replaceAll('${CLAUDE_PLUGIN_ROOT}/', ' ').replaceAll('${CLAUDE_PROJECT_DIR}/', ' ');
  const dirs = ctx.topDirs.map(esc).join('|');
  const out = [...t.matchAll(new RegExp(`(?<![\\w./-])(?:${dirs})/[\\w./-]*\\.(?:${DOC_EXT})(?![\\w-])`, 'g'))].map(m => m[0]);
  out.push(...[...t.matchAll(new RegExp(`(?<![\\w./-])(?:${ctx.rootFiles.map(esc).join('|')})(?![\\w-])`, 'g'))].map(m => m[0]));
  out.push(...[...t.matchAll(/(?<![\w./-])meta\/[\w./-]*\.(?:md|json|yml)(?![\w-])/g)].map(m => 'vault-template/' + m[0]));
  out.push(...[...t.matchAll(/\]\(([^)\s#]+)/g)].map(m => m[1]).filter(l => !/^[a-z]+:/.test(l))
    .map(l => posix.normalize(posix.join(posix.dirname(file), l))));
  return out;
}

// Code regions: inline spans and fenced lines in markdown, lines (minus the key) in YAML, string
// values in JSON. Running prose is never an invocation.
function codeRegions(file, text) {
  const e = ext(file);
  // A JSON string is code when it is a command line; titles and descriptions are prose.
  if (e === '.json') return [...text.matchAll(/"((?:\$|node)\s(?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
  if (e === '.yml') return text.split('\n').map(l => l.replace(/^\s*(?:-\s*)?[\w-]+:\s*/, ''));
  const out = [];
  const prose = text.replace(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm, (_, body) => { out.push(...body.split('\n')); return ''; });
  out.push(...[...prose.matchAll(/`([^`\n]+)`/g)].map(m => m[1]));
  return out;
}

// An invocation starts its region: `research-vault <cmd>`, `research-vault.mjs <cmd>`,
// `research-vault.mjs" <cmd>` after an optional `$`, `node` and path, or a bare command word.
const CLI_RE = /^(?:\$\s+)?(?:node\s+)?(?:"?[^\s"]*\/)?research-vault(?:\.mjs"?)?\s+(\S+)(.*)$/;
function invocation(region, ctx) {
  const m = region.trim().match(CLI_RE);
  if (m) return /^[<[-]/.test(m[1]) ? null : [m[1], m[2]]; // <command>, [options] and --help are not command words
  const [first, ...rest] = region.trim().split(/\s+/);
  return ctx.commands.includes(first) ? [first, rest.join(' ')] : null;
}

// Every edge one file contributes. Exported so test/deps.test.mjs can feed it one syntax at a time.
export function extract(file, text, ctx = context()) {
  const e = ext(file), edges = [];
  const add = (kind, to) => edges.push({ from: file, kind, to });
  if (UNSCANNED.has(file)) return edges;
  if (e === '.mjs' || e === '.js') {
    for (const to of imports(file, text)) add(file.startsWith('test/') ? 'tests' : 'import', to);
    if (e === '.mjs') for (const to of reads(text, ctx)) add('reads', to);
    return edges;
  }
  if (file === 'hooks/hooks.json') {
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)) add('registers', m[1]);
    return edges;
  }
  if (!['.md', '.yml', '.json'].includes(e) && file !== 'bin/research-vault') return edges;
  for (const to of documents(file, text, ctx)) add('documents', to);
  if (e === '.md') {
    const names = [...text.matchAll(/research-vault:([a-z-]+)/g)].map(m => m[1]);
    names.push(...[...text.matchAll(/`\/?(research-[a-z-]+)`/g)].map(m => m[1]).filter(n => n !== 'research-vault'));
    for (const n of names) ctx.names[n] ? add(ctx.names[n].kind, ctx.names[n].file) : add('invokes-unknown', n);
  }
  if (e === '.md' || e === '.yml') for (const m of text.matchAll(/npm (?:run ([\w:-]+)|(test)\b)/g)) add('npm', `npm:${m[1] ?? m[2]}`);
  for (const region of codeRegions(file, text)) {
    const hit = invocation(region, ctx);
    if (!hit) continue;
    const [cmd, rest] = hit;
    add('invokes-cli', `cli:${cmd}`);
    if (ctx.flags[cmd]) for (const m of rest.matchAll(/--([a-z][\w-]*)/g)) if (!ctx.flags[cmd].has(m[1])) add('invokes-cli', `cli:${cmd} --${m[1]}`);
  }
  return edges;
}

export function build(ctx = context()) {
  const nodes = new Set([...ctx.files, ...ctx.commands.map(c => `cli:${c}`), ...ctx.scripts.map(s => `npm:${s}`)]);
  const seen = new Set(), edges = [];
  const add = e => { const k = `${e.from}\0${e.kind}\0${e.to}`; if (!seen.has(k)) { seen.add(k); edges.push(e); } };
  for (const f of ctx.files) if (EXTRACTED.has(ext(f))) for (const e of extract(f, read(f), ctx)) add(e);
  for (const c of ctx.commands) add({ from: `cli:${c}`, kind: 'dispatches', to: `bin/commands/${c}.mjs` });
  for (const [a, b, why] of COUPLINGS) { add({ from: a, kind: 'couples', to: b, why }); add({ from: b, kind: 'couples', to: a, why }); }
  const broken = edges.filter(e => !nodes.has(e.to));
  return { nodes, edges, broken };
}

// Distance-1 dependents of an id, one line each: `<kinds> <from>`, with the reason for a coupling.
export function dependents(id, { edges }) {
  const by = new Map();
  for (const e of edges.filter(e => e.to === id)) {
    const d = by.get(e.from) ?? { kinds: new Set(), why: undefined };
    d.kinds.add(e.kind); d.why ??= e.why; by.set(e.from, d);
  }
  return [...by].sort(([a], [b]) => a < b ? -1 : 1).map(([from, d]) => `${[...d.kinds].sort().join(',')} ${from}${d.why ? `: ${d.why}` : ''}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const arg = process.argv[2];
  if (arg === '--hook') {
    let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      try {
        const edited = JSON.parse(input || '{}').tool_input?.file_path || '';
        const rel = relative(REPO_ROOT, edited).replace(/\\/g, '/');
        const deps = edited && !rel.startsWith('..') ? dependents(rel, build()) : [];
        if (deps.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Files that depend on ${rel}: ${deps.join('; ')}` } }) + '\n');
      } catch { /* never block edits */ }
      process.exit(0);
    });
  } else if (arg) {
    for (const line of dependents(arg, build())) console.log(line);
  } else {
    const { broken } = build();
    for (const e of broken) console.log(`${e.kind} ${e.from} -> ${e.to}`);
    process.exit(broken.length ? 1 : 0);
  }
}
