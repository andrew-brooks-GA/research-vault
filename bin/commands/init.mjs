import { cpSync, mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { generateAgentsMd } from '../lib/agentsmd.mjs';
import { resolveVault, configPath } from '../lib/resolve.mjs';
import { buildManifest } from '../lib/manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function hasEntries(dir) {
  for (const f of ['sources','notes','synthesis','snippets','experiments','questions']) {
    const p = join(dir, f);
    if (existsSync(p) && readdirSync(p).some(n => n.endsWith('.md') && n !== 'INDEX.md')) return true;
  }
  return false;
}

export function runInit({ vaultPath, repoRoot = REPO_ROOT, force = false }) {
  if (existsSync(vaultPath) && hasEntries(vaultPath) && !force) {
    return { created: false, reason: 'target vault is non-empty (use --force to overwrite)', vaultPath };
  }
  mkdirSync(vaultPath, { recursive: true });
  cpSync(join(repoRoot, 'vault-template'), vaultPath, { recursive: true });
  const schema = loadSchema(repoRoot);
  writeFileSync(join(vaultPath, 'AGENTS.md'), generateAgentsMd(schema), 'utf8');
  // Copy the canonical taxonomy verbatim — single source of truth, no hand-maintained duplicate.
  cpSync(join(repoRoot, 'schema', 'taxonomy.json'), join(vaultPath, 'taxonomy.json'));
  writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(buildManifest(vaultPath), null, 2), 'utf8');
  return { created: true, vaultPath };
}

function profileHint(platform, vaultPath) {
  if (platform === 'win32') return `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vaultPath}","User")`;
  return `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vaultPath}"`;
}

export async function run(args) {
  const { path: vaultPath, source } = resolveVault({ flag: args.vault ?? null });
  const r = runInit({ vaultPath, force: !!args.force });
  if (!r.created) { process.stderr.write(r.reason + '\n'); return 1; }
  const home = process.env.HOME || process.env.USERPROFILE;
  const cfg = configPath({ platform: process.platform, home, env: process.env });
  // Only set the global discovery pointer when establishing the default vault:
  // when none exists yet, or when explicitly requested. Never silently hijack an
  // existing default (e.g. a throwaway `init --vault /tmp/x` must not steal it).
  if (args['set-default'] || !existsSync(cfg)) {
    mkdirSync(dirname(cfg), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ vaultPath }, null, 2), 'utf8');
    process.stdout.write(`Initialized vault at ${vaultPath} (resolved via ${source}); set as default.\n`);
  } else {
    process.stdout.write(`Initialized vault at ${vaultPath} (resolved via ${source}). Default pointer unchanged (use --set-default to repoint).\n`);
  }
  process.stdout.write(profileHint(process.platform, vaultPath) + '\n');
  return 0;
}
