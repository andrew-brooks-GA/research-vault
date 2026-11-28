import { constants, fstatSync, readFileSync, realpathSync, lstatSync, mkdirSync, writeFileSync, renameSync, rmSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assertInsideWorkspaceFolder } from './containment.ts';
import { sha256Hex } from './hash.ts';
import { errorCode, isRecord, parseJson } from './unknowns.ts';

export function configPath({ platform, home, env }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'research-vault', 'config.json');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'research-vault', 'config.json');
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'research-vault', 'config.json');
}

export function trustedBindingsPath({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.join(p.dirname(configPath({ platform, home, env })), 'trusted-bindings.json');
}

function readRecord(options) {
  try {
    checkRecordLocation(options);
    const record = parseJson(readFileSync(trustedBindingsPath(options), 'utf8'));
    if (!isRecord(record) || record.version !== 1 || !Array.isArray(record.bindings)) return [];
    const bindings = record.bindings;
    const seen = new Set();
    if (!bindings.every(row => {
      if (!isRecord(row) || typeof row.path !== 'string' || !path.isAbsolute(row.path)
          || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)
          || typeof row.date !== 'string' || !Number.isFinite(Date.parse(row.date)) || seen.has(row.path)) return false;
      seen.add(row.path);
      return true;
    })) return [];
    return bindings;
  } catch { return []; }
}

export function bindingIdentity(binding) {
  if (!lstatSync(binding).isFile()) throw new Error('binding must be a regular file');
  return path.join(realpathSync.native(path.dirname(binding)), path.basename(binding));
}

export function bindingSnapshot(binding) {
  const identity = bindingIdentity(binding);
  let fd;
  try {
    fd = openSync(identity, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ELOOP' || code === 'EMLINK') throw new Error('binding must be a regular file');
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error('binding must be a regular file');
    return { path: identity, bytes: readFileSync(fd) };
  } finally { closeSync(fd); }
}

function bindingFingerprint(binding) {
  const snapshot = bindingSnapshot(binding);
  return { path: snapshot.path, sha256: sha256Hex(snapshot.bytes) };
}

function checkRecordLocation(options) {
  const destination = trustedBindingsPath(options);
  const folder = path.dirname(destination);
  assertInsideWorkspaceFolder(path.dirname(folder), folder, destination, { regular: true });
}

export function isBindingAcknowledged(binding, options = {}) {
  try {
    const current = bindingFingerprint(binding);
    return readRecord(options).some(row => row.path === current.path && row.sha256 === current.sha256);
  } catch { return false; }
}

function writeRecord(bindings, options) {
  const destination = trustedBindingsPath(options);
  const folder = path.dirname(destination);
  const check = () => assertInsideWorkspaceFolder(path.dirname(folder), folder, destination, { regular: true });
  check();
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  check();
  const temporary = path.join(folder, `.trusted-bindings-${randomUUID()}.tmp`);
  let created = false;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    created = true;
    try { writeFileSync(fd, JSON.stringify({ version: 1, bindings }, null, 2) + '\n'); }
    finally { closeSync(fd); }
    check();
    renameSync(temporary, destination);
  } finally {
    if (created) rmSync(temporary, { force: true });
  }
}

export function acknowledgeBinding(binding, options = {}) {
  const now = options?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('acknowledgeBinding: now must be a Date');
  const row = { ...bindingFingerprint(binding), date: now.toISOString() };
  // Do not acknowledge bytes changed while the command was displaying or confirming them.
  if ((options.identity !== undefined && row.path !== options.identity)
      || (options.bytes !== undefined && row.sha256 !== sha256Hex(options.bytes))) {
    throw new Error('binding changed; run research-vault trust again');
  }
  writeRecord([...readRecord(options).filter(old => old.path !== row.path), row], options);
}

export function revokeBinding(binding, options = {}) {
  const resolved = bindingIdentity(binding);
  checkRecordLocation(options);
  const rows = readRecord(options);
  const remaining = rows.filter(row => row.path !== resolved);
  if (remaining.length === rows.length) return false;
  writeRecord(remaining, options);
  return true;
}
