// R-18: the CLI entry imports this module first, and nothing else statically that could fail, so an older Node gets
// one line naming the requirement instead of whatever error its first unsupported API gives. Keep it to what Node 14
// has. The floor is package.json's engines.node, which ships with the plugin and with a Codex install.
import { readFileSync } from 'node:fs';

const ENGINES = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).engines.node;
const FLOOR = Number(ENGINES.match(/\d+/)[0]);

// The line to print for a Node version string such as process.versions.node, or null when it is new enough.
export const nodeTooOld = (version) => Number(String(version).split('.')[0]) < FLOOR
  ? `research-vault: Node.js ${FLOOR} or newer is required (this is ${version})` : null;

const problem = nodeTooOld(process.versions.node);
if (problem) { process.stderr.write(problem + '\n'); process.exit(1); }
