// R-18: the CLI entry imports this module first, and nothing else statically that could fail, so an older Node gets
// one line naming the requirement instead of whatever error its first unsupported API gives. Keep it to what Node 14
// has. The floor is package.json's engines.node, which ships with the plugin and with a Codex install.
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const ENGINES = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).engines.node;
const [major, minor = 0, patch = 0] = ENGINES.match(/\d+(?:\.\d+){0,2}/)[0].split('.').map(Number);
const FLOOR = [major, minor, patch];

// The line to print for a Node version string such as process.versions.node, or null when it is new enough.
export const nodeTooOld = (version) => {
  const [major, minor = '0', patch = '0'] = String(version).split('.', 3);
  const parts = [Number(major), Number(minor), parseInt(patch, 10)];
  for (let i = 0; i < FLOOR.length; i++) {
    if (parts[i] === FLOOR[i]) continue;
    return parts[i] < FLOOR[i]
      ? `research-vault: Node.js ${FLOOR.join('.')} or newer is required (this is ${version})` : null;
  }
  return null;
};

const problem = nodeTooOld(process.versions.node);
if (problem) { process.stderr.write(problem + '\n'); process.exit(1); }

// Claude Code treats status 1 as a non-blocking hook error and keeps stderr out of the model's context.
// Hooks, the CLI and scripts all report a refusal on stderr and exit 1.
export function launch(metaUrl, cache) {
  if (url.fileURLToPath(metaUrl).split(path.sep).includes('node_modules')) {
    process.stderr.write('research-vault: install as a plugin or git clone, not through npm (node_modules).\n');
    process.exit(1);
  }
  if (!cache || process.env.NODE_DISABLE_COMPILE_CACHE !== undefined || typeof module.enableCompileCache !== 'function') return;
  try {
    const platform = process.platform;
    let root = platform === 'win32' ? process.env.LOCALAPPDATA
      : platform === 'darwin' ? undefined : process.env.XDG_CACHE_HOME;
    if (!root || !path.isAbsolute(root)) {
      const home = os.homedir();
      if (!path.isAbsolute(home)) return;
      root = path.join(home, platform === 'win32' ? 'AppData/Local' : platform === 'darwin' ? 'Library/Caches' : '.cache');
    }
    const dir = path.join(root, 'research-vault', 'compile-cache');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    module.enableCompileCache(dir);
  } catch { /* The cache is optional. */ }
}
