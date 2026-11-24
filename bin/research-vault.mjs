#!/usr/bin/env node
// R-18: the Node version check runs first; every other import of the plugin's code is dynamic, after it.
import './lib/node-floor.mjs';
import { readFileSync, existsSync } from 'node:fs';
const { parseArgs } = await import('./lib/args.mjs');

const USAGE = `research-vault <command> [options]
commands: init|lint|capture|verify|search|related|manifest|compile|advise|obsidian|refresh|export|check|gate|teach|embed|host|trust`;

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || cmd === '--help' || cmd === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }

const commands = {
  trust: () => import('./commands/trust.mjs'),
  host: () => import('./commands/host.mjs'),
  init: () => import('./commands/init.mjs'),
  lint: () => import('./commands/lint.mjs'),
  capture: () => import('./commands/capture.mjs'),
  verify: () => import('./commands/verify.mjs'),
  search: () => import('./commands/search.mjs'),
  related: () => import('./commands/related.mjs'),
  manifest: () => import('./commands/manifest.mjs'),
  compile: () => import('./commands/compile.mjs'),
  advise: () => import('./commands/advise.mjs'),
  obsidian: () => import('./commands/obsidian.mjs'),
  refresh: () => import('./commands/refresh.mjs'),
  export: () => import('./commands/export.mjs'),
  check: () => import('./commands/check.mjs'),
  gate: () => import('./commands/gate.mjs'),
  teach: () => import('./commands/teach.mjs'),
  embed: () => import('./commands/embed.mjs'),
};
if (!commands[cmd]) { process.stderr.write(`unknown command: ${cmd}\n${USAGE}\n`); process.exit(1); }
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
try {
  const mod = await commands[cmd]();
  const code = await mod.run(args);
  process.exitCode = code ?? 0; // not process.exit(): that truncates piped stdout at 64 KB
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 2;
}
