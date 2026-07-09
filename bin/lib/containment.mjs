import nodePath from 'node:path';
import nodeFs from 'node:fs';

// Resolve symlinks on the longest existing prefix of `target`, keeping the
// non-existent tail lexical. A symlink anywhere across the boundary would
// otherwise defeat the purely lexical containment check below.
function realResolve(target, p, fs) {
  const resolved = p.resolve(target);
  const tail = [];
  let cur = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return tail.length ? p.join(real, ...tail) : real;
    } catch {
      const parent = p.dirname(cur);
      if (parent === cur) return resolved; // reached root; nothing on this path exists
      tail.unshift(p.basename(cur));
      cur = parent;
    }
  }
}

// True when `child` resolves to `parent` itself or a path nested inside it.
// Separator-aware: a sibling like `<parent>-evil` or a child literally named
// `..foo` is correctly NOT treated as inside. Symlinks across the boundary are
// resolved via `fs` when the caller uses the real path module; tests that
// inject a path impl and pass `fs = null` keep the historical lexical-only seam.
export function isInsideVault(parent, child, p = nodePath, fs = p === nodePath ? nodeFs : null) {
  if (!parent || !child) return false;
  const par = fs ? realResolve(parent, p, fs) : p.resolve(parent);
  const chi = fs ? realResolve(child, p, fs) : p.resolve(child);
  const rel = p.relative(par, chi);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel));
}
