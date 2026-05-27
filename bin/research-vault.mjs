#!/usr/bin/env node
const USAGE = `research-vault <command> [options]
commands: init|lint|capture|verify|search|related|manifest`;

const [cmd] = process.argv.slice(2);
if (!cmd || cmd === '--help' || cmd === '-h') {
  process.stdout.write(USAGE + '\n');
  process.exit(0);
}
process.stderr.write(`unknown command: ${cmd}\n${USAGE}\n`);
process.exit(1);
