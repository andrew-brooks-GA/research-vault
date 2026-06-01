import nodePath from 'node:path';

// True when `child` resolves to `parent` itself or a path nested inside it.
// Separator-aware: a sibling like `<parent>-evil` or a child literally named
// `..foo` is correctly NOT treated as inside.
export function isInsideVault(parent, child, p = nodePath) {
  if (!parent || !child) return false;
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel));
}
