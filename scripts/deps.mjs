#!/usr/bin/env node
// Derived dependency graph of this repo (spec 14): computed from the working tree on every run, never
// stored. Who imports, reads, tests, documents or invokes a file, plus the couplings no path connects.
//   node scripts/deps.mjs          print every broken edge as `<kind> <from> -> <to>`, exit 1 if any
//   node scripts/deps.mjs <id>     distance-1 dependents of a file, cli:<cmd> or npm:<script>
//   node scripts/deps.mjs --hook   PostToolUse: additionalContext naming the edited file's dependents
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_EXT = 'mjs|js|md|json|yml|css|html';
// Every extension in the tree must be in one of these two sets (test/deps.test.mjs). '' is the
// extensionless bin/research-vault shim; dotfiles and LICENSE share it and yield nothing.
export const EXTRACTED = new Set(['.mjs', '.js', '.md', '.yml', '.json', '']);
export const IGNORED = new Set(['.css', '.html']);
// Files no extractor reads: release history legitimately names removed files; the other two quote
// every syntax (COUPLINGS rows are couples edges, the sample table is test input).
const UNSCANNED = new Set(['CHANGELOG.md', 'scripts/deps.mjs', 'test/deps.test.mjs']);

// Pairs that depend on each other through something other than a path: a copied value, a printed
// string, a name, a format. Add a row with the change that creates one (AGENTS.md); the test fails
// when either end leaves the tree. Seeded from the 2026-10-27 seven-agent inventory.
export const COUPLINGS = [
  ['bin/research-vault', 'bin/research-vault.mjs', 'the shim execs ./research-vault.mjs by name'],
  ['bin/research-vault.mjs', 'docs/REFERENCE.md', 'the command table restates the commands map'],
  ['bin/research-vault.mjs', 'test/smoke.test.mjs', 'the --help usage line is asserted in order'],
  ['bin/lib/fsutil.mjs', 'schema/taxonomy.json', 'TYPE_FOLDER keys and folders equal artifact_type and stage_by_folder keys'],
  ['bin/lib/fsutil.mjs', 'agents/claims-reviewer.md', 'the {sources,notes,...} folder list is TYPE_FOLDER'],
  ['bin/lib/validate.mjs', 'bin/lib/lintrules.mjs', 'ENUM_META needs an entry for every CONTROLLED_FIELDS field'],
  ['bin/lib/manifest.mjs', 'bin/commands/lint.mjs', "the '.vault-manifest.json' literal is written in both"],
  ['bin/lib/manifest.mjs', 'schema/taxonomy.json', 'CONFIRMING_RESULTS is a subset of verification_result'],
  ['bin/lib/ids.mjs', 'bin/lib/citations.mjs', 'makeId output must match ID_RE'],
  ['bin/lib/ids.mjs', 'bin/lib/agentsmd.mjs', 'the filename-is-the-id rule is restated in the generated AGENTS.md'],
  ['bin/lib/ids.mjs', 'bin/lib/gate.mjs', "sha256 formats differ: 'sha256:<hex>' stored, bare hex in the ledger"],
  ['bin/lib/stale.mjs', 'vault-template/meta/freshness-policy.md', 'the last_verified rule and the volatility windows are restated in §2-3'],
  ['bin/lib/stale.mjs', 'vault-template/meta/prompt-templates/verify-entry.md', 'steps 1-2 restate the last_verified rule and the windows'],
  ['bin/lib/stale.mjs', 'skills/research-vault-usage/SKILL.md', 'the 90-day window and the last_verified rule are written out'],
  ['schema/taxonomy.json', 'vault-template/meta/freshness-policy.md', 'refresh_after_days are hand-copied into the §2 table; method and result lists into §5'],
  ['schema/taxonomy.json', 'vault-template/meta/prompt-templates/verify-entry.md', 'windows in step 2, method and result lists in steps 3-4'],
  ['schema/taxonomy.json', 'vault-template/meta/prompt-templates/probe-tool.md', 'verification method names'],
  ['schema/taxonomy.json', 'skills/research-verify/SKILL.md', 'method and result lists'],
  ['schema/taxonomy.json', 'skills/research-capture/SKILL.md', 'the enum lists under Optional fields (authority_basis among them)'],
  ['schema/taxonomy.json', 'docs/REFERENCE.md', 'volatility windows, domain values and the extensible fields are hand-listed'],
  ['schema/taxonomy.json', 'README.md', 'the volatility windows are written as prose'],
  ['schema/taxonomy.json', 'test/helpers.mjs', 'put() hardcodes domain, method, by_type, result and volatility values'],
  ['schema/taxonomy.json', 'bin/commands/capture.mjs', 'the default domain, volatility, source_type, confidence, outcome, state and language values'],
  ['schema/teach-taxonomy.json', 'skills/research-teach/LEARNING-RECORD-FORMAT.md', 'kind values, types and the learning-records folder are hand-copied'],
  ['schema/frontmatter.schema.json', 'bin/lib/graph.mjs', 'DEPENDENCY_RELS must be a subset of edge_fields.backlink'],
  ['schema/frontmatter.schema.json', 'hooks/pre-web.mjs', 'title, topics, summary, source_url, status and type are read by name'],
  ['bin/commands/init.mjs', 'vault-template/README.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'vault-template/CLAUDE.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'vault-template/GEMINI.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'commands/research-init.md', 'the non-clobber and --refresh-docs behaviour is described'],
  ['bin/commands/init.mjs', 'bin/lib/resolve.mjs', 'init derives home from HOME||USERPROFILE, resolve from os.homedir()'],
  ['bin/lib/resolve.mjs', 'docs/REFERENCE.md', 'the vault resolution order is written out'],
  ['bin/lib/resolve.mjs', 'commands/research-init.md', 'the vault resolution order is written out'],
  ['bin/lib/resolve.mjs', 'skills/research-vault-usage/SKILL.md', 'the vault resolution order is written out'],
  ['bin/lib/resolve.mjs', 'skills/research-orchestrate/SKILL.md', 'the vault resolution order is written out'],
  ['bin/lib/resolve.mjs', 'skills/research-claims-gate/SKILL.md', 'the vault resolution order is written out'],
  ['bin/lib/resolve.mjs', 'hooks/session-start.mjs', "the source label 'project' gates the workspace briefs"],
  ['bin/lib/projectconfig.mjs', 'docs/REFERENCE.md', 'EXTENSIBLE_TAXONOMY_FIELDS and the non-extensible list'],
  ['bin/lib/projectconfig.mjs', 'commands/research-init.md', "the config keys and 'volatility defaults to fast'"],
  ['bin/commands/obsidian.mjs', 'commands/research-obsidian.md', "the '_obsidian' default"],
  ['bin/lib/files.mjs', 'vault-template/.gitignore', 'SKIP_DIRS and the ignore list both name _index and _obsidian'],
  ['bin/lib/files.mjs', '.gitignore', 'SKIP_DIRS and the ignore list both name _index and _obsidian'],
  ['bin/commands/check.mjs', 'bin/lib/gate.mjs', "checkCitations status values 'ok', 'stale', 'uncovered'"],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', 'VERDICTS, LEDGER_FILENAME and the fact:N/quiz:N unit names'],
  ['bin/lib/gate.mjs', 'agents/claims-reviewer.md', 'the renderEvidence line format, unit names and verdict tokens'],
  ['bin/lib/gate.mjs', 'hooks/stop-gate.mjs', 'the PASS|MERIT text the hook prints'],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', 'the ledger filename and the verdicts'],
  ['bin/lib/gate.mjs', 'bin/lib/lesson.mjs', "unitHashes depends on the data-block names 'fact' and 'quiz'"],
  ['bin/commands/gate.mjs', 'agents/claims-reviewer.md', "the 'changed units:' line the gate prints is the line the agent keys on"],
  ['bin/lib/codelinks.mjs', 'agents/claims-reviewer.md', "the sym: unit name and the 'unit sym:<name> <file>:<start>-<end> <status>' line format"],
  ['bin/lib/codelinks.mjs', 'skills/research-authoring/SKILL.md', 'the <id>@<key>=<version> link form and the stale reason tag'],
  ['bin/lib/codelinks.mjs', 'docs/REFERENCE.md', 'the Lua row of LANGS is quoted as the language example'],
  ['bin/commands/gate.mjs', 'skills/research-claims-gate/SKILL.md', "the 'changed units:' last line is quoted"],
  ['hooks/stop-gate.mjs', 'skills/research-claims-gate/SKILL.md', "the hook names the skill and the 'gate record <file> PASS|MERIT' form"],
  ['hooks/hooks.json', 'docs/REFERENCE.md', "'four Claude Code hooks' and their names"],
  ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'the plugin name'],
  ['.claude-plugin/plugin.json', 'package.json', 'the version (test/manifests.test.mjs)'],
  ['.claude-plugin/plugin.json', 'skills/research-claims-gate/SKILL.md', 'the research-vault: dispatch prefix is the plugin name'],
  ['.claude-plugin/plugin.json', 'skills/research-teach/SKILL.md', 'the research-vault: dispatch prefix is the plugin name'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', 'the /lessons.json and POST /attempt routes and the {id,score,total} shape'],
  ['skills/research-teach/assets/quiz.js', 'skills/research-teach/LESSON-FORMAT.md', "the 'recorded <id>: <score>/<total>' and terminal strings are quoted"],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'block names, MAX_INTRODUCES, QUIZ_MIN_ITEMS, QUIZ_SPREAD_MAX and FOLLOWUP as prose'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/assets/lesson.css', 'the [data-block=...] selectors name the same blocks'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/MISSION-FORMAT.md', 'the Floor, Known tools, Known terms and New to me headings are parsed'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/PATH-FORMAT.md', 'the PATH.md line grammar is parsed'],
  ['bin/commands/teach.mjs', 'skills/research-teach/PATH-FORMAT.md', 'the PATH.md line grammar is parsed by next'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'the teach verbs and the serving line are quoted'],
  ['bin/lib/teach.mjs', 'skills/research-teach/SKILL.md', "SPACING_DAYS as '21 days', .teach-serve.json and the lesson URL"],
  ['bin/lib/teach.mjs', 'SECURITY.md', 'ATTEMPT_BODY_MAX, the allowlisted dirs, .teach-serve.json and the 127.0.0.1 binding'],
  ['bin/commands/refresh.mjs', 'SECURITY.md', 'RESEARCH_VAULT_ALLOW_NETWORK and --dry-run'],
  ['bin/commands/export.mjs', 'SECURITY.md', 'the export flag semantics'],
  ['skills/research-teach/LESSON-FORMAT.md', 'test/fixtures/teach/lessons/0001-good.html', 'the single ```html example is byte-identical to the fixture'],
  ['bin/lib/lintrules.mjs', 'scripts/check-encoding.mjs', 'the mojibake regex and the BOM/CR checks are duplicated'],
  ['bin/lib/lintrules.mjs', 'docs/REFERENCE.md', 'lint codes are documented by name'],
  ['bin/lib/lintrules.mjs', 'docs/ORCHESTRATOR-INTEGRATION.md', 'WARN_SYNTHESIS_* codes and the 1500-word limit'],
  ['bin/lib/lintrules.mjs', 'bin/lib/agentsmd.mjs', 'WARN_MISSING_SUMMARY and WARN_SOURCE_UNVERIFIED are named in the generated AGENTS.md'],
  ['bin/lib/lintrules.mjs', 'skills/research-authoring/SKILL.md', 'lint codes are named in prose'],
  ['bin/lib/lintrules.mjs', 'skills/research-capture/SKILL.md', 'lint codes are named in prose'],
  ['bin/lib/lintrules.mjs', 'skills/research-review/SKILL.md', 'lint codes are named in prose'],
  ['bin/lib/lintrules.mjs', 'skills/research-orchestrate/SKILL.md', 'lint codes are named in prose'],
  ['bin/lib/advise.mjs', 'skills/research-librarian/SKILL.md', "'nine sections' and their list"],
  ['bin/commands/capture.mjs', 'skills/research-orchestrate/SKILL.md', 'the --batch camelCase keys'],
  ['bin/commands/capture.mjs', 'skills/research-capture/SKILL.md', 'the --batch camelCase keys'],
  ['bin/lib/agentsmd.mjs', 'docs/ORCHESTRATOR-INTEGRATION.md', 'AGENTS.md §2.6 is cited by number'],
  ['bin/lib/agentsmd.mjs', 'docs/REFERENCE.md', 'AGENTS.md §5 and §5.2 are cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-vault-usage/SKILL.md', 'AGENTS.md §2.7 and §5.2 are cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-capture/SKILL.md', 'AGENTS.md §2.5 and §2.6 are cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-orchestrate/SKILL.md', 'AGENTS.md §2.6 is cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-review/SKILL.md', 'AGENTS.md §2.6 is cited by number'],
  ['bin/lib/agentsmd.mjs', 'vault-template/meta/freshness-policy.md', 'freshness-policy §8 is cited by number'],
  ['vault-template/meta/freshness-policy.md', 'vault-template/meta/prompt-templates/probe-tool.md', 'freshness-policy §8 is cited by number'],
  ['.github/workflows/ci.yml', 'docs/REFERENCE.md', 'the CI matrix and steps are restated'],
  ['.gitattributes', 'scripts/check-encoding.mjs', 'eol=lf keeps the CR gate green on Windows'],
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ext = f => posix.extname(f);
const read = f => readFileSync(join(REPO_ROOT, f), 'utf8');
const lsFiles = (...flags) => execFileSync('git', ['ls-files', '-z', '--exclude-standard', ...flags], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
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

function reads(text, ctx) {
  const out = [...text.matchAll(/'(schema|vault-template)'((?:,\s*'[^']+')*)/g)]
    .map(m => posix.join(m[1], ...[...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])));
  // ponytail: docs/ is also the layout test/gate.test.mjs gives its temp repos, so literals under it
  // are skipped; a test that reads docs/ would go unseen.
  const dirs = ctx.topDirs.filter(d => d !== 'docs').map(esc).join('|');
  out.push(...[...text.matchAll(new RegExp(`'((?:${dirs})/[^'\\n*]*\\.(?:mjs|js|md|json|yml))'`, 'g'))].map(m => m[1]));
  return out;
}

function documents(file, text, ctx) {
  const t = text.replaceAll('${CLAUDE_PLUGIN_ROOT}/', ' ');
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
  if (e === '.md' || e === '.yml') for (const m of text.matchAll(/npm run ([\w:-]+)/g)) add('npm', `npm:${m[1]}`);
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
  const isDir = to => ctx.files.some(f => f.startsWith(to + '/'));
  const broken = edges.filter(e => !nodes.has(e.to) && !(e.kind === 'reads' && isDir(e.to)));
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
