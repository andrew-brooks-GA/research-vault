import { cpSync, mkdirSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { generateAgentsMd } from '../lib/agentsmd.ts';
import { checkProjectVault, resolveVault, configPath, hasVaultContent } from '../lib/resolve.mjs';
import { writeManifest } from '../lib/manifest.mjs';
import { ENTRY_FOLDERS } from '../lib/fsutil.ts';
import { compileVault } from '../lib/indexview.mjs';
import { scaffoldProjectConfig, quotedGlob } from '../lib/projectconfig.mjs';
import { acknowledgeBinding } from '../lib/trust.ts';
import { csvList } from '../lib/args.ts';
import { assertInsideVault, compareVaultLocations, VAULT_PATH_OUTSIDE } from '../lib/containment.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function writeVaultDocs(vaultPath, repoRoot) {
  const docs = join(vaultPath, 'AGENTS.md');
  const taxonomy = join(vaultPath, 'taxonomy.json');
  const content = generateAgentsMd(loadSchema(repoRoot));
  assertInsideVault(vaultPath, docs);
  writeFileSync(docs, content, 'utf8');
  // Copy the canonical taxonomy verbatim — single source of truth, no hand-maintained duplicate.
  assertInsideVault(vaultPath, taxonomy);
  cpSync(join(repoRoot, 'schema', 'taxonomy.json'), taxonomy);
}

export function runInit({ vaultPath, repoRoot = REPO_ROOT, force = false }) {
  if (existsSync(vaultPath) && hasVaultContent(vaultPath) && !force) {
    return { created: false, reason: 'target vault is non-empty (use --force to overwrite)', vaultPath };
  }
  assertInsideVault(vaultPath, vaultPath);
  mkdirSync(vaultPath, { recursive: true });
  const root = realpathSync.native(vaultPath);
  cpSync(join(repoRoot, 'vault-template'), root, { recursive: true, filter: (_src, dest) => {
    assertInsideVault(vaultPath, join(vaultPath, relative(root, dest)));
    return true;
  } });
  // Create the six entry folders (+ attachments) explicitly — there are no INDEX.md
  // placeholders; the manifest is the index.
  for (const folder of [...ENTRY_FOLDERS, join('sources', '_attachments')]) {
    const path = join(vaultPath, folder);
    assertInsideVault(vaultPath, path);
    mkdirSync(path, { recursive: true });
  }
  writeVaultDocs(vaultPath, repoRoot);
  writeManifest(vaultPath);
  try { compileVault(vaultPath); } catch (e) { if (e.code === VAULT_PATH_OUTSIDE) throw e; }
  return { created: true, vaultPath };
}

// Doc-resync for an EXISTING vault: regenerate the two derived-from-schema artifacts
// (AGENTS.md + taxonomy.json) after a plugin upgrade, without the destructive full re-init.
// Never touches entries, meta/, .gitignore, or the manifest.
export function refreshDocs({ vaultPath, repoRoot = REPO_ROOT }) {
  if (!existsSync(vaultPath) || !hasVaultContent(vaultPath)) {
    return { refreshed: false, reason: 'target is not an existing vault (nothing to refresh)', vaultPath };
  }
  writeVaultDocs(vaultPath, repoRoot);
  return { refreshed: true, vaultPath };
}

export function profileHint(platform, vaultPath) {
  if (platform === 'win32') return `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vaultPath}","User")`;
  return `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vaultPath}"`;
}

export async function run(args) {
  const now = new Date();
  // `init --project` binds the CURRENT repo to a vault by writing a .research-vault.json
  // here; it does not scaffold a vault. The vault itself is resolved as usual.
  if (args.project) {
    // --code-links <glob,glob> adds the `code` block (spec 15); scaffoldProjectConfig checks it needs a relative vault.
    const codeLinks = csvList(args['code-links']);
    const globs = csvList(args.globs);
    const quoted = quotedGlob([...codeLinks, ...globs]);
    if (quoted) { process.stderr.write(`init: ${quoted}\n`); return 2; }
    const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
    const topics = csvList(args.topics);
    try {
      let writtenBytes;
      const target = scaffoldProjectConfig(process.cwd(), {
        vault: vaultPath, domain: args.domain, topics, globs, volatility: args.volatility, codeLinks, schema: loadSchema(REPO_ROOT),
      }, { writeFileSync(target, content, options) {
        writtenBytes = Buffer.from(content, options.encoding);
        writeFileSync(target, content, options);
      } });
      let acknowledged = false;
      try { acknowledgeBinding(target, { bytes: writtenBytes, now }); acknowledged = true; } catch {
        process.stderr.write('Could not record the acknowledgement; run research-vault trust to record it.\n');
      }
      process.stdout.write(`Bound this repo to ${vaultPath} via ${target}.\n`);
      if (!acknowledged && !checkProjectVault(vaultPath, target).path) {
        process.stderr.write('Warning: this binding names a vault outside the repository. It will be used only when RESEARCH_VAULT_PATH points at it or --vault is passed.\n');
      }
      if (codeLinks.length) {
        process.stdout.write(`Code links on for ${codeLinks.join(', ')}: in ${target}, add a code.versions key ({ file, pattern }) per dependency to pin to, and a code.languages row ({ comment, decl }) for a language the plugin does not ship.\n`);
      }
      return 0;
    } catch (e) {
      process.stderr.write(e.message + '\n');
      return 1;
    }
  }
  if (args['refresh-docs']) {
    const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
    const r = refreshDocs({ vaultPath });
    if (!r.refreshed) { process.stderr.write(r.reason + '\n'); return 1; }
    process.stdout.write(`Refreshed AGENTS.md + taxonomy.json at ${vaultPath} (entries, meta/, .gitignore untouched).\n`);
    return 0;
  }
  const { path: resolvedPath, source } = resolveVault({ flag: args.vault ?? null });
  const vaultPath = resolve(resolvedPath);
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
  const envVault = process.env.RESEARCH_VAULT_PATH;
  const later = resolveVault({ home, readProjectConfig: () => null });
  const relativeEnvVault = !!envVault && !isAbsolute(envVault);
  if (envVault && (relativeEnvVault || compareVaultLocations(envVault, vaultPath) !== true)) {
    process.stdout.write(`RESEARCH_VAULT_PATH is set to "${envVault}" and takes precedence over the default pointer; commands will use that folder until the variable is changed or unset.\n`);
  }
  if (relativeEnvVault || !isAbsolute(later.path) || compareVaultLocations(later.path, vaultPath) !== true) {
    process.stdout.write(profileHint(process.platform, vaultPath) + '\n');
  }
  return 0;
}
