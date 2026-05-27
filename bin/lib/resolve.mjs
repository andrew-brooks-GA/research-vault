import path from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';

function pj(platform) { return platform === 'win32' ? path.win32 : path.posix; }

export function defaultVaultPath({ platform, home, env }) {
  const p = pj(platform);
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'research-vault');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'research-vault');
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'research-vault');
}

export function configPath({ platform, home, env }) {
  const p = pj(platform);
  if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'research-vault', 'config.json');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'research-vault', 'config.json');
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'research-vault', 'config.json');
}

function readConfigPath(ctx) {
  const p = configPath(ctx);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')).vaultPath || null; } catch { return null; }
}

export function resolveVault(opts = {}) {
  const ctx = {
    flag: opts.flag ?? null,
    env: opts.env ?? process.env,
    platform: opts.platform ?? process.platform,
    home: opts.home ?? homedir(),
  };
  const readConfig = opts.readConfig ?? (() => readConfigPath(ctx));
  if (ctx.flag) return { path: ctx.flag, source: 'flag' };
  if (ctx.env.RESEARCH_VAULT_PATH) return { path: ctx.env.RESEARCH_VAULT_PATH, source: 'env' };
  const cfg = readConfig();
  if (cfg) return { path: cfg, source: 'config' };
  return { path: defaultVaultPath(ctx), source: 'default' };
}
