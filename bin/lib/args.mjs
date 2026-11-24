import { parseArgs as parseTokens } from 'node:util';

// R-23: one options table per command, the union of the flags any of its subcommands or modes reads: strings, then
// booleans. Every command also takes --vault (string) and --help (boolean). A flag a mode does not read is accepted
// and ignored there. `--topics` is a list for capture and init and takes no value for lint and manifest.
const TABLES = {
  advise: ['', 'json'],
  capture: ['answer-summary authority-basis authority-tier batch body-file by-id captured-via confidence content content-file content-hash contributing-ids cwd date-run domain fill language model-id operation-id outcome provider question related series source-type sources state subject-name subject-version summary synthesis-basis task title topics type url volatility',
    'ack-data-egress continue discard force json replace scaffold store-body tested'],
  check: ['cwd now', 'check json report'],
  compile: ['', 'stdout'],
  embed: ['cwd', 'ack-data-egress'],
  export: ['chunk format min-authority now out overlap scope', 'ack-data-egress fresh-only include-bodies'],
  gate: ['cwd expect extra packet run', 'changed check json'],
  host: ['at cwd draft effort extra model out role', 'dry-run without-hooks'],
  init: ['code-links domain globs topics volatility', 'force project refresh-docs set-default'],
  lint: ['', 'check fix json topics'],
  manifest: ['', 'rebuild topics'],
  obsidian: ['out', ''],
  refresh: ['id', 'dry-run json'],
  related: ['depth direction format rel', ''],
  search: ['cwd domain limit now semantic series sort text topic type body', 'ack-data-egress include-superseded json'],
  teach: ['answered answers body-file by kind lesson minutes needle out pass reason result title topic',
    'cancel certify dry-run fix hints labs no-hints prose skip-ungated start terminal'],
  trust: ['', 'revoke show yes'],
  verify: ['answer-summary answered-by by-id id method notes quotes result run superseded-by', 'json stale succession'],
};
const words = (s) => s.split(' ').filter(Boolean);
const options = (cmd) => Object.fromEntries([
  ...words(`${TABLES[cmd][0]} vault`).map((n) => [n, { type: 'string' }]),
  ...words(`${TABLES[cmd][1]} help`).map((n) => [n, { type: 'boolean' }]),
]);
// A flag given more than once whose values all count: an array, in order.
const REPEAT = new Set(['needle']);
// The flags that take a value under some command: before the command, one of them takes the next word as its value.
const VALUED = new Set(Object.keys(TABLES).flatMap((c) => words(TABLES[c][0])).concat('vault'));
export const csvList = s => String(s ?? '').split(',').map(t => t.trim()).filter(Boolean);

// The index of the command in argv (flags may come first), or -1.
export function commandAt(argv) {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--') return i + 1 < argv.length ? i + 1 : -1;
    if (!tok.startsWith('--')) return i;
    if (!tok.includes('=') && VALUED.has(tok.slice(2))) i++;
  }
  return -1;
}

// Whether parsed args ask for the command's help: --help, or -h as a positional (not as an option's value).
export const wantsHelp = (args) => 'help' in args || args._.slice(1).includes('-h');

// Parses argv against its command's table: `_` holds the command and the positionals. Throws on an unknown option,
// a value-taking option with no value (at the end, or followed by a word that starts with --) and a value given to
// an option that takes none, unless the args ask for help (wantsHelp), which wins. A word that starts with a single
// '-' is a value after a value-taking option and a positional anywhere else, as before: node's parser would read it
// as short options (an inner '-' as `--`, ending the options), so it goes in as `\0<index>`, which argv cannot hold,
// and is put back.
export function parseArgs(argv, at = commandAt(argv)) {
  const cmd = argv[at];
  if (!Object.hasOwn(TABLES, cmd)) throw new Error(`no options table for ${cmd}`);
  const table = options(cmd);
  const rest = argv.toSpliced(at, 1);
  const back = (v) => (/^\0\d+$/.test(v) ? rest[v.slice(1)] : v);
  const out = { _: [cmd] };
  let err;
  const args = rest.map((w, i) => (/^-[^-]/.test(w) ? `\0${i}` : w));
  for (const t of parseTokens({ args, options: table, strict: false, allowPositionals: true, tokens: true }).tokens) {
    if (t.kind === 'positional') out._.push(back(t.value));
    else if (t.kind !== 'option') continue; // the option terminator
    else if (!Object.hasOwn(table, t.name)) err ??= `unknown option --${t.name}`;
    else if (table[t.name].type === 'boolean') {
      if (t.value !== undefined) err ??= `option --${t.name} takes no value`;
      else out[t.name] = true;
    } else if (t.value === undefined || (!t.inlineValue && t.value.startsWith('--'))) {
      err ??= `option --${t.name} needs a value`;
      if (t.value === '--help') out.help = true; // the word it took is an option of its own
    } else out[t.name] = REPEAT.has(t.name) ? [...(out[t.name] ?? []), back(t.value)] : back(t.value);
  }
  if (err && !wantsHelp(out)) throw new Error(err);
  return out;
}
