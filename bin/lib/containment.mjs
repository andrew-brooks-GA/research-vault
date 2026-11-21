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
