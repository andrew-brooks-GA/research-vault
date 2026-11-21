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
      return tail.length ? p.join(real, ...tail) : real;
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
      if (parent === cur) return inspectEntry ? null : resolved;
      tail.unshift(p.basename(cur));
      cur = parent;
    }
  }
}

// Return null for unknown containment. With no filesystem, use lexical paths.
function compareContainment(parent, child, p, fs) {
  if (!parent || !child) return null;
  const par = fs ? realResolve(parent, p, fs) : p.resolve(parent);
  const chi = fs ? realResolve(child, p, fs) : p.resolve(child);
  if (par === null || chi === null) return null;
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

// Use when an operation requires known separation.
export function mayBeInside(parent, child, p = nodePath, fs = p === nodePath ? nodeFs : null) {
  return compareContainment(parent, child, p, fs) !== false
    || (fs != null && compareContainment(parent, child, p, null) === true);
}
