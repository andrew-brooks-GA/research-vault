import path from 'node:path';
import { homedir } from 'node:os';
import nodeFs, { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configPath, isBindingAcknowledged } from './trust.ts';
import { walkEntries } from './fsutil.ts';
import { loadSchema } from './schema.ts';
import { loadProjectConfig, PROJECT_CONFIG_FILENAME } from './projectconfig.ts';
import { compareContainment, compareVaultLocations, mayBeInside } from './containment.ts';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUTSIDE_PROJECT_VAULT = 'ERR_OUTSIDE_PROJECT_VAULT';

function pj(platform) { return platform === 'win32' ? path.win32 : path.posix; }

export function defaultVaultPath({ platform, home, env }) {
  const p = pj(platform);
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'research-vault');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'research-vault');
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'research-vault');
}

export { configPath } from './trust.ts';

function readConfigPath(ctx) {
  const p = configPath(ctx);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')).vaultPath || null; } catch { return null; }
}

export function checkProjectVault(vault, binding, {
  env = process.env, platform = process.platform, home = homedir(), fs = nodeFs,
  readConfig = () => readConfigPath({ env, platform, home }),
} = {}) {
  const choices = [() => env.RESEARCH_VAULT_PATH, readConfig, () => defaultVaultPath({ env, platform, home })];
  const p = pj(platform);
  const outside = 'a vault outside its repository that is not one of your own';
  if (p.isAbsolute(vault) && /^[\\/]{2}/.test(vault)) {
    // Comparing these spellings must not open a network share or a device.
    const bound = p.normalize(vault);
    const comparable = value => platform === 'win32' ? value.toLowerCase() : value;
    for (const readChoice of choices) {
      const value = readChoice();
      if (typeof value !== 'string' || !value) continue;
      const choice = p.normalize(value);
      if (comparable(choice) === comparable(bound)) return { path: choice };
    }
    return { reason: outside };
  }

  const base = path.dirname(binding);
  const vaultPath = path.resolve(base, vault);
  const inside = compareContainment(base, vaultPath, path, fs);
  if (inside === true) return { path: vaultPath };

  let unresolved = inside === null || mayBeInside(base, vaultPath, path, null);
  let alreadyChosen = false;
  for (const readChoice of choices) {
    const value = readChoice();
    if (typeof value !== 'string' || !value) continue;
    const choice = path.resolve(value);
    const same = compareVaultLocations(choice, vaultPath, path, fs);
    if (same === true) return { path: vaultPath };
    if (same === null) unresolved = true;
    if (path.relative(choice, vaultPath) === '') alreadyChosen = true;
  }
  return { reason: unresolved ? 'a vault that could not be resolved' : outside, alreadyChosen };
}

export function resolveVault(opts = {}) {
  const ctx = {
    flag: opts.flag ?? null,
    env: opts.env ?? process.env,
    platform: opts.platform ?? process.platform,
    home: opts.home ?? homedir(),
    cwd: opts.cwd ?? process.cwd(),
  };
  const readConfig = opts.readConfig ?? (() => readConfigPath(ctx));
  const readProjectConfig = opts.readProjectConfig ?? (() => {
    const hit = loadProjectConfig(ctx.cwd, { schema: loadSchema(REPO_ROOT), workspaceDir: opts.workspaceDir });
    return hit ? { ...hit.config, path: hit.path } : null;
  });
  if (ctx.flag) return { path: ctx.flag, source: 'flag' };
  const project = readProjectConfig();
  // A relative vault (what `init --project --vault research` writes) is relative to the
  // config file's directory, never to wherever the process happens to run.
  if (project?.vault) {
    const binding = path.resolve(project.path || path.join(ctx.cwd, PROJECT_CONFIG_FILENAME));
    const verdict = checkProjectVault(project.vault, binding, { ...ctx, readConfig, fs: opts.fs ?? nodeFs });
    if (verdict.path) return { path: verdict.path, source: 'project' };

    if (isBindingAcknowledged(binding, ctx)) {
      return { path: path.resolve(path.dirname(binding), project.vault), source: 'project' };
    }

    const location = binding.replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, ch => {
      const hex = ch.codePointAt(0).toString(16);
      return hex.length > 4 ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
    });
    const remedy = verdict.alreadyChosen ? 'Pass --vault to the command.'
      : 'Set RESEARCH_VAULT_PATH to that folder or pass --vault to the command.';
    const error = new Error(`The binding at ${location} names ${verdict.reason}. Run research-vault trust in that project to approve the binding. ${remedy}`);
    error.code = OUTSIDE_PROJECT_VAULT;
    throw error;
  }
  if (ctx.env.RESEARCH_VAULT_PATH) return { path: ctx.env.RESEARCH_VAULT_PATH, source: 'env' };
  const cfg = readConfig();
  if (cfg) return { path: cfg, source: 'config' };
  return { path: defaultVaultPath(ctx), source: 'default' };
}

// A write that resolved through the user config or the OS default did not come from the
// project the caller is standing in. Say where it went, so a capture run from the wrong
// directory does not land silently in another vault.
export function reportFallback({ path: vaultPath, source }, stream = process.stderr) {
  if (source !== 'config' && source !== 'default') return;
  const from = source === 'config' ? 'the user config' : 'the OS default';
  stream.write(`research-vault: no .research-vault.json found from the working directory; writing to ${vaultPath} (from ${from})\n`);
}

const VAULT_MARKERS = ['AGENTS.md', 'taxonomy.json', 'README.md', 'CLAUDE.md', 'GEMINI.md', 'meta'];
export function hasVaultContent(dir) {
  return VAULT_MARKERS.some(m => existsSync(path.join(dir, m))) || walkEntries(dir).length > 0;
}
