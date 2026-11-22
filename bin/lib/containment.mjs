import nodePath from 'node:path';
import nodeFs from 'node:fs';

// Resolve the longest existing prefix of `target`, keeping the missing tail
// lexical. An existing entry whose resolution fails leaves containment unknown.
function realResolve(target, p, fs) {
  const resolved = p.resolve(target);
  const tail = [];
  const inspectEntry = typeof fs.lstatSync === 'function';
  let cur = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(cur) : fs.realpathSync(cur);
      return { path: tail.length ? p.join(real, ...tail) : real, prefix: real };
    } catch (err) {
      let code = err?.code;
      if (inspectEntry) {
        try {
          fs.lstatSync(cur);
          return null;
        } catch (entryErr) {
          code = entryErr?.code;
        }
      }
      if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') return null;
      const parent = p.dirname(cur);
      if (parent === cur) return inspectEntry ? null : { path: resolved, prefix: resolved };
      tail.unshift(p.basename(cur));
      cur = parent;
    }
  }
}

// Return null for unknown containment. With no filesystem, use lexical paths.
export function compareContainment(parent, child, p = nodePath, fs = p === nodePath ? nodeFs : null) {
  if (!parent || !child) return null;
  const par = fs ? realResolve(parent, p, fs)?.path : p.resolve(parent);
  const chi = fs ? realResolve(child, p, fs)?.path : p.resolve(child);
  if (par === undefined || chi === undefined) return null;
  if (fs) {
    const prefix = par.endsWith(p.sep) ? par : par + p.sep;
    return chi === par || chi.startsWith(prefix);
  }
  const rel = p.relative(par, chi);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel));
}

// Use when an operation requires known containment.
export function isInsideVault(parent, child, p = nodePath, fs = p === nodePath ? nodeFs : null) {
  return compareContainment(parent, child, p, fs) === true;
}

// An allowlisted folder must resolve to its own place under the workspace.
export function isInsideWorkspaceFolder(workspace, folder, target = folder) {
  const realWorkspace = realResolve(workspace, nodePath, nodeFs)?.path;
  const realFolder = realResolve(folder, nodePath, nodeFs)?.path;
  const name = nodePath.basename(folder);
  if (!realWorkspace || !realFolder || !name || nodePath.dirname(realFolder) !== realWorkspace) return false;
  if (realFolder !== nodePath.join(realWorkspace, name)) {
    if (nodePath.basename(realFolder).toLowerCase() !== name.toLowerCase()) return false;
    // A case-insensitive lookup can return the stored spelling of a real directory.
    // On a case-sensitive volume, a link to a differently spelled sibling is refused.
    try { if (!nodeFs.lstatSync(folder).isDirectory()) return false; } catch { return false; }
  }
  return target === folder || isInsideVault(realFolder, target);
}

export const VAULT_PATH_OUTSIDE = 'VAULT_PATH_OUTSIDE';

export function escapePathControls(path) {
  // Escape supplementary format characters as two JSON-compatible UTF-16 escapes.
  return path.replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, (ch) =>
    ch.split('').map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));
}

function missingOr(workspacePath, type) {
  try {
    const entry = nodeFs.lstatSync(workspacePath, { throwIfNoEntry: false });
    return !entry || entry[type]();
  } catch { return false; }
}

export function assertInsideWorkspaceFolder(workspace, folder, target = folder, { regular = false } = {}) {
  const name = nodePath.basename(folder) + '/';
  const refuse = (place) => {
    throw Object.assign(new Error(`${escapePathControls(place)}: path is outside its workspace folder or cannot be resolved`), { code: VAULT_PATH_OUTSIDE });
  };
  if (!isInsideWorkspaceFolder(workspace, folder) || !missingOr(folder, 'isDirectory')) refuse(name);
  if (target === folder) return;
  if (!isInsideWorkspaceFolder(workspace, folder, target) || !isInsideVault(folder, nodePath.dirname(target))
      || (regular && !missingOr(target, 'isFile'))) {
    const rel = isInsideVault(folder, target, nodePath, null) ? nodePath.relative(folder, target) : '';
    refuse(name + rel.split(nodePath.sep).join('/'));
  }
}

export function assertInsideVault(vaultPath, path) {
  const rel = nodePath.relative(vaultPath, path);
  // Rename and removal also modify the directory holding the name.
  if (!isInsideVault(vaultPath, path) || (rel && !isInsideVault(vaultPath, nodePath.dirname(path)))) {
    throw Object.assign(new Error(`${rel || '.'}: path is outside the vault or cannot be resolved`), { code: VAULT_PATH_OUTSIDE });
  }
}

// Compare canonical locations, including missing paths with a known directory prefix.
// Return null when resolution could not establish a location.
export function compareVaultLocations(a, b, p = nodePath, fs = p === nodePath ? nodeFs : null) {
  if (typeof a !== 'string' || !a || typeof b !== 'string' || !b || !fs) return false;
  const first = realResolve(a, p, fs);
  const second = realResolve(b, p, fs);
  if (!first || !second) return null;
  if (first.path !== second.path) return false;
  try {
    for (const prefix of new Set([first.prefix, second.prefix])) {
      if (!fs.statSync(prefix).isDirectory()) return prefix === first.path ? false : null;
    }
    return true;
  } catch { return null; }
}

// Use when an operation requires known separation.
export function mayBeInside(parent, child, p = nodePath, fs = p === nodePath ? nodeFs : null) {
  return compareContainment(parent, child, p, fs) !== false
    || (fs != null && compareContainment(parent, child, p, null) === true);
}
