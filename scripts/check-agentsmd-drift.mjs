import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSchema } from '../bin/lib/schema.mjs';
import { generateAgentsMd } from '../bin/lib/agentsmd.mjs';

// Primary gate (works anywhere, no CI vault required): the generator output must match the
// committed golden snapshot. This is a real anti-drift check — unlike comparing the generator
// to an AGENTS.md that CI just produced with the same generator, which passes by construction.
const repoRoot = process.cwd();
const gen = generateAgentsMd(loadSchema(repoRoot));
const goldenPath = join(repoRoot, 'schema', 'AGENTS.golden.md');
const golden = readFileSync(goldenPath, 'utf8');
if (gen !== golden) {
  console.error('AGENTS.md drift: generator output differs from schema/AGENTS.golden.md.');
  console.error('If you edited schema/ or bin/lib/agentsmd.mjs, regenerate the golden and commit it:');
  console.error('  node -e "import(\'./bin/lib/schema.mjs\').then(async s=>{const a=await import(\'./bin/lib/agentsmd.mjs\');(await import(\'node:fs\')).writeFileSync(\'schema/AGENTS.golden.md\',a.generateAgentsMd(s.loadSchema(process.cwd())),\'utf8\');})"');
  process.exit(1);
}

// Secondary sanity (CI only): if a freshly-inited ci-vault is present, confirm its AGENTS.md
// still equals the generator output — catches `init` bypassing the generator.
if (existsSync('./ci-vault/AGENTS.md')) {
  const cur = readFileSync('./ci-vault/AGENTS.md', 'utf8');
  if (gen !== cur) { console.error('AGENTS.md drift between generator and init output (ci-vault)'); process.exit(1); }
}

console.log('agentsmd ok');
