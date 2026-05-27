const BOOL = new Set(['json', 'check', 'fix', 'force', 'stale', 'rebuild', 'succession', 'tested', 'set-default']);
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      if (BOOL.has(key)) out[key] = true;
      else { out[key] = argv[++i]; }
    } else out._.push(tok);
  }
  return out;
}
