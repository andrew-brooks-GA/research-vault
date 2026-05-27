#!/usr/bin/env node
import { parseArgs } from './lib/args.mjs';

const USAGE = `research-vault <command> [options]
commands: init|lint|capture|verify|search|related|manifest`;

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || cmd === '--help' || cmd === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }

const commands = {
  init: () => import('./commands/init.mjs'),
  lint: () => import('./commands/lint.mjs'),
  capture: () => import('./commands/capture.mjs'),
  verify: () => import('./commands/verify.mjs'),
  search: () => import('./commands/search.mjs'),
  related: () => import('./commands/related.mjs'),
  manifest: () => import('./commands/manifest.mjs'),
};
if (!commands[cmd]) { process.stderr.write(`unknown command: ${cmd}\n${USAGE}\n`); process.exit(1); }
try {
  const mod = await commands[cmd]();
  const code = await mod.run(args);
  process.exit(code ?? 0);
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(2);
}
