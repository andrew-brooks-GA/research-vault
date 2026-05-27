import { readFileSync } from 'node:fs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { generateAgentsMd } from '../bin/lib/agentsmd.mjs';

const gen = generateAgentsMd(loadSchema(process.cwd()));
const cur = readFileSync('./ci-vault/AGENTS.md', 'utf8');
if (gen !== cur) { console.error('AGENTS.md drift between generator and init output'); process.exit(1); }
console.log('agentsmd ok');
