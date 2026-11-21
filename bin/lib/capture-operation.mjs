// Opt-in publication protocol. Legacy capture deliberately remains outside this lock.
import * as fs from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { prepareEntry } from '../commands/capture.mjs';
import { serializeFrontmatter } from './frontmatter.mjs';
import { readEntry, walkEntries, TYPE_FOLDER, ENTRY_FOLDERS } from './fsutil.mjs';
import { loadSchema } from './schema.mjs';
import { sha256, normalizeUrl, verKey } from './ids.mjs';
import { buildManifest, danglingEdges, writeManifest } from './manifest.mjs';
import { assertInsideVault, isInsideVault } from './containment.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const operationKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(key);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const digest = value => sha256(JSON.stringify(canonical(value)));
const retryableIO = e => ['EINTR', 'EBUSY', 'EAGAIN'].includes(e.code);
function atomicJson(vault, path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const text = JSON.stringify(value, null, 2) + '\n';
  assertInsideVault(vault, path);
  try {
    assertInsideVault(vault, tmp);
    fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    assertInsideVault(vault, tmp);
    assertInsideVault(vault, path);
    fs.renameSync(tmp, path);
  } finally { try { unlinkInside(vault, tmp); } catch {} }
}
function unlinkInside(vault, path) {
  assertInsideVault(vault, path);
  fs.unlinkSync(path);
}
function fault(code, index, e) {
  return { code, ...(typeof index === 'number' ? { index } : { phase: index }), retryable: retryableIO(e), error: e.message };
}
function input(planPath, opts) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (!Array.isArray(plan) || !plan.length) throw new Error('plan must be a non-empty JSON array');
  // Issue 72 item 6: every entry that cannot be read is reported, as prepare() reports every entry that fails.
  const failures = [];
  const inputs = plan.map((spec, index) => {
    try {
      if (!spec || Array.isArray(spec) || typeof spec !== 'object') throw new Error('entry must be an object');
      return { spec, bytes: spec.contentFile ? fs.readFileSync(resolve(dirname(planPath), spec.contentFile)) : null };
    } catch (e) { e.index = index; failures.push(e); }
  });
  if (failures.length) throw Object.assign(failures[0], { failures });
  return { inputs, inputDigest: digest({ plan, options: { ackDataEgress: !!opts.ackDataEgress }, files: inputs.map(i => i.bytes ? sha256(i.bytes) : null) }) };
}
function render(vault, item, date, opts) {
  const spec = item.spec;
  for (const k of ['title', 'type']) if (typeof spec[k] !== 'string' || !spec[k].trim()) throw new Error(`${k} required`);
  for (const k of ['domain', 'topics', 'related', 'sources', 'contributingIds']) {
    if (spec[k] !== undefined && typeof spec[k] !== 'string' && !(Array.isArray(spec[k]) && spec[k].every(x => typeof x === 'string'))) throw new Error(`invalid ${k}`);
  }
  const csv = v => Array.isArray(v) ? v.join(',') : v;
  const prep = prepareEntry(vault, { ...spec, ...Object.fromEntries(['domain', 'topics', 'related', 'sources', 'contributingIds'].map(k => [k, csv(spec[k])])),
    content: item.bytes ? item.bytes.toString('utf8') : spec.content, contentBytes: item.bytes ?? spec.contentBytes,
    now: date, repoRoot: opts.repoRoot || ROOT, ackDataEgress: !!opts.ackDataEgress, force: false,
  }, { ignoreExisting: true });
  for (const field of ['sources', 'contributing_ids']) if (field in prep.data && !prep.data[field].length) throw new Error(`${field} must be non-empty`);
  if (spec.subjectVersion && !spec.subjectName) throw new Error('subjectVersion requires subjectName');
  return { ...prep, text: serializeFrontmatter(prep.data, prep.body, prep.order) };
}
// A source entry at the planned source's URL and version, and whether it may stand for the planned one. prepare() reuses
// a source by these rules, and a replay checks a reused source again by them (issue 72 item 5).
const sameSource = (e, p) => e.data.type === 'source' && normalizeUrl(e.data.source_url) === normalizeUrl(p.data.source_url) && verKey(e.data.subject?.version) === verKey(p.data.subject?.version);
const suitable = (e, p, spec) => e.data.status === 'active' && !(p.data.content_hash && p.data.content_hash !== e.data.content_hash) && !(spec.storeBody && p.body !== e.body);
function entries(vault) {
  return walkEntries(vault).map(path => ({ ...readEntry(path, { folderChecked: true }), path, text: fs.readFileSync(path, 'utf8') }));
}
function prepare(vault, inputs, date, opts) {
  const existing = entries(vault), available = [...existing], results = [], rendered = [], failures = [];
  for (const [index, item] of inputs.entries()) {
    try {
      const p = render(vault, item, date, opts);
      const matches = p.data.type === 'source' ? available.filter(e => sameSource(e, p)) : [];
      if (matches.length > 1) throw new Error('ambiguous source URL/version');
      let reused = matches[0];
      if (reused && !suitable(reused, p, item.spec)) throw new Error(`unsuitable existing source: ${reused.id}`);
      const collision = available.filter(e => e.id === p.id);
      if (!reused && collision.length) {
        if (collision.length !== 1 || collision[0].text !== p.text || collision[0].data.type !== p.data.type) throw new Error(`destination conflict: ${p.id}`);
        reused = collision[0];
      }
      const chosen = reused || p;
      const refs = [...(p.data.sources || []), ...(p.data.contributing_ids || []), ...(p.data.related || [])];
      for (const ref of refs) {
        const found = available.filter(e => e.id === ref).length;
        if (found !== 1) throw new Error(`${found ? 'ambiguous' : 'unresolved'} reference: ${ref}; use actual reused IDs when replanning`);
      }
      // Issue 72 item 4: the receipt's path uses '/' on every platform, the form validReceipt accepts.
      const rel = relative(vault, chosen.path).split(sep).join('/');
      results.push({ index, id: chosen.id, path: rel, fingerprint: sha256(chosen.text), state: reused ? 'reused' : 'pending', ...(reused ? { reason: 'existing suitable entry', actualId: chosen.id, ...(results.some(r => r.path === rel) ? { reuseOf: results.find(r => r.path === rel).index } : {}) } : {}) });
      rendered.push(p);
      if (!reused) available.push(p);
    } catch (e) {
      // One error per failing entry, as legacy --batch reports. A failed entry is not in `available`, so an
      // entry that names it fails too and one that shares its id is not compared with it.
      e.index = index;
      failures.push(e);
    }
  }
  if (failures.length) throw Object.assign(failures[0], { failures, results });
  return { results, rendered };
}
function validReceipt(r, key, vault, count) {
  if (r.schemaVersion !== 1 || r.operationId !== key || r.vault !== vault || !/^\d{4}-\d{2}-\d{2}$/.test(r.created) ||
    !['prepared', 'writing', 'needs-repair', 'complete'].includes(r.phase) || !['pending', 'complete', 'failed'].includes(r.manifest) || !Array.isArray(r.results) || r.results.length !== count) throw new Error('invalid receipt identity or structure');
  if (!Array.isArray(r.errors) || !/^sha256:[a-f0-9]{64}$/.test(r.inputDigest || '') || !/^sha256:[a-f0-9]{64}$/.test(r.schemaDigest || '') || r.phase === 'complete' && (r.manifest !== 'complete' || r.results.some(row => !['created', 'reused'].includes(row.state)))) throw new Error('inconsistent receipt state');
  for (const [i, row] of r.results.entries()) {
    if (row.index !== i || !['pending', 'created', 'reused', 'conflict', 'failed'].includes(row.state) || typeof row.id !== 'string' || !Object.values(TYPE_FOLDER).some(f => row.path === `${f}/${row.id}.md`) || /[/\\]/.test(row.id) || !/^sha256:[a-f0-9]{64}$/.test(row.fingerprint)) throw new Error('invalid receipt result');
    if (row.reuseOf !== undefined && (!Number.isInteger(row.reuseOf) || row.reuseOf >= i || row.reuseOf < 0 || r.results[row.reuseOf].path !== row.path || r.results[row.reuseOf].fingerprint !== row.fingerprint)) throw new Error('invalid receipt reuse');
  }
}

export function captureOperation(vaultPath, planPath, key, opts = {}) {
  let vault, receipt, receiptPath, lock, owned = false, recoveryStateCreated = false;
  const errors = [], event = opts.event || (() => {});
  const output = (extra = {}) => ({ created: (receipt?.results || []).filter(r => r.state === 'created').map(r => ({ index: r.index, id: r.id, path: join(vault, r.path) })), skipped: (receipt?.results || []).filter(r => r.state === 'reused').map(r => ({ index: r.index, id: r.id, reason: r.reason })), errors, recoveryStateCreated, ...(receipt ? { operation: receipt } : {}), ...extra });
  const save = () => { event('receipt', receipt); atomicJson(vault, receiptPath, receipt); recoveryStateCreated = true; };
  try {
    if (!operationKey(key)) throw new Error('invalid operation key');
    vault = fs.realpathSync(vaultPath);
    planPath = resolve(planPath);
    const loaded = input(planPath, opts);
    const schemaDigest = digest(loadSchema(opts.repoRoot || ROOT, { vaultPath: vault }));
    const dir = join(vault, '.capture-operations');
    receiptPath = join(dir, `${key}.json`);
    try { assertInsideVault(vault, receiptPath); }
    catch (e) { errors.push(fault('RECEIPT_IO', 'receipt', e)); return output(); }
    if (fs.existsSync(receiptPath)) {
      try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); validReceipt(receipt, key, vault, loaded.inputs.length); recoveryStateCreated = true; }
      catch (e) { receipt = undefined; errors.push(fault('RECEIPT_IO', 'receipt', e)); return output(); }
      if (receipt.inputDigest !== loaded.inputDigest || receipt.schemaDigest !== schemaDigest) {
        errors.push(fault('INPUT_CHANGED', -1, new Error('operation inputs or schema changed; retain original inputs or use a new key for a revised plan'))); return output();
      }
      // Historical success checks operation identity, never current artifact bytes.
      if (receipt.phase === 'complete') return output({ replay: true, historical: true });
    }
    event('before-lock', { key });
    try {
      assertInsideVault(vault, dir);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    catch (e) { errors.push(fault('RECEIPT_IO', 'prepared', e)); return output(); }
    lock = join(dir, 'writer.lock');
    try { assertInsideVault(vault, lock); }
    catch (e) { errors.push(fault('RECEIPT_IO', 'lock', e)); return output(); }
    try {
      fs.mkdirSync(lock, { mode: 0o700 }); owned = true;
    } catch (e) {
      // Issue 72 item 3: a lock with no owner.json names no process. A writer that has just made it, one of an older
      // version or a person may have left it.
      const how = e.code === 'EEXIST' && !fs.existsSync(join(lock, 'owner.json')) ? 'it holds no owner.json, so it names no process: confirm that no --operation-id capture is running' : 'inspect owner.json and confirm the original process is gone';
      errors.push({ ...fault('LOCK_BUSY', 'lock', e), retryable: false, error: `exclusive writer lock unavailable: ${lock}; ${how} before explicitly removing this lock` }); return output();
    }
    // The lock is ours from here; without its owner diagnostic we give it back rather than hold it unnamed.
    try { atomicJson(vault, join(lock, 'owner.json'), { operationId: key, pid: process.pid, vault, started: new Date().toISOString() }); }
    catch (e) { errors.push(fault('RECEIPT_IO', 'lock', e)); return output(); }
    // Issue 72 item 1: a writer killed between link and unlink leaves `<id>.md.<uuid>.tmp` beside the entry. Only this
    // file writes that name, and we hold the lock, so such a file is a dead writer's; the entry is a separate link.
    for (const f of ENTRY_FOLDERS) {
      const folder = join(vault, f);
      if (!isInsideVault(vault, folder)) continue;
      let names = [];
      try { names = fs.readdirSync(folder); } catch {}
      for (const n of names) if (/\.md\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(n)) { try { unlinkInside(vault, join(folder, n)); } catch {} }
    }
    // Another writer may have finished between our initial read and lock acquisition.
    // Never prepare from that stale observation or replace its receipt.
    try { assertInsideVault(vault, receiptPath); }
    catch (e) { errors.push(fault('RECEIPT_IO', 'receipt', e)); return output(); }
    if (fs.existsSync(receiptPath)) {
      try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); validReceipt(receipt, key, vault, loaded.inputs.length); recoveryStateCreated = true; }
      catch (e) { receipt = undefined; errors.push(fault('RECEIPT_IO', 'receipt', e)); return output(); }
      if (receipt.inputDigest !== loaded.inputDigest || receipt.schemaDigest !== schemaDigest) {
        errors.push(fault('INPUT_CHANGED', -1, new Error('operation inputs or schema changed'))); return output();
      }
      if (receipt.phase === 'complete') return output({ replay: true, historical: true });
    }
    event('locked', { lock, key });
    let rendered;
    if (!receipt) {
      const date = opts.now || new Date().toISOString().slice(0, 10);
      let prepared;
      try { prepared = prepare(vault, loaded.inputs, date, opts); }
      catch (e) {
        for (const f of e.failures || [e]) errors.push(fault(/conflict|ambiguous|unsuitable/.test(f.message) ? 'DESTINATION_CONFLICT' : 'INPUT_INVALID', f.index ?? -1, f));
        return output({ results: e.results || [] });
      }
      rendered = prepared.rendered;
      receipt = { schemaVersion: 1, operationId: key, vault, inputDigest: loaded.inputDigest, schemaDigest, created: date, phase: 'prepared', manifest: 'pending', results: prepared.results, errors: [] };
      try { save(); } catch (e) { errors.push(fault('RECEIPT_IO', 'prepared', e)); return output(); }
    } else {
      rendered = loaded.inputs.map(item => render(vault, item, receipt.created, opts));
      // Frozen defaults/renderer must also produce the prepared bytes.
      for (const row of receipt.results) if (row.state !== 'reused' && sha256(rendered[row.index].text) !== row.fingerprint) {
        errors.push(fault('INPUT_CHANGED', row.index, new Error('prepared content changed; implementation/defaults are incompatible'))); return output();
      }
    }
    // Revalidate ordered references against today's disk before any resumed publication.
    let availableIds;
    try { availableIds = entries(vault).map(e => e.id); }
    catch (e) { errors.push(fault('DESTINATION_CONFLICT', 'reconciliation', e)); receipt.phase = 'needs-repair'; return output(); }
    for (const row of receipt.results) {
      const p = rendered[row.index];
      for (const ref of [...(p.data.sources || []), ...(p.data.contributing_ids || []), ...(p.data.related || [])]) {
        if (availableIds.filter(id => id === ref).length !== 1) {
          errors.push(fault('DESTINATION_CONFLICT', row.index, new Error(`reference disappeared or became ambiguous: ${ref}`)));
          return output();
        }
      }
      if (!availableIds.includes(row.id)) availableIds.push(row.id);
    }
    receipt.errors = [];
    receipt.phase = 'writing';
    try { save(); } catch (e) { errors.push(fault('RECEIPT_IO', 'writing', e)); return output(); }
    // Reconcile the whole incomplete operation before publishing anything else.
    for (const row of receipt.results) {
      try {
        if (row.reuseOf !== undefined && receipt.results[row.reuseOf]?.state === 'pending') continue;
        const path = join(vault, row.path);
        let found = false;
        try {
          assertInsideVault(vault, path);
          const stat = fs.lstatSync(path);
          if (!stat.isFile()) throw new Error('destination is not a regular file');
          const text = fs.readFileSync(path, 'utf8'), entry = readEntry(path), p = rendered[row.index];
          // Issue 72 item 5: this operation did not write a reused source, so it is checked again by the rules prepare()
          // reused it by, and an edit that keeps it suitable, such as a verification, is no conflict. Any other row,
          // a question reused because its bytes were the same among them, keeps its bytes.
          if (row.state === 'reused' && p.data.type === 'source') { if (!sameSource(entry, p) || !suitable(entry, p, loaded.inputs[row.index].spec)) throw new Error('reused source no longer suitable'); }
          else if (sha256(text) !== row.fingerprint) throw new Error('destination fingerprint changed');
          found = true;
        } catch (e) { if (e.code !== 'ENOENT' || row.state !== 'pending') throw e; }
        if (found && row.state === 'pending') row.state = 'created';
        if (row.state === 'conflict' || row.state === 'failed') throw new Error('repair the original conflict before replay');
      } catch (e) { errors.push(fault('DESTINATION_CONFLICT', row.index, e)); }
    }
    if (!errors.length) for (const row of receipt.results) {
      if (row.state !== 'pending') continue;
      const path = join(vault, row.path), tmp = `${path}.${randomUUID()}.tmp`;
      try {
        event('artifact', row);
        const folder = dirname(path);
        assertInsideVault(vault, folder);
        fs.mkdirSync(folder, { recursive: true });
        // Issue 72 item 2: the default mode, as capture without --operation-id writes an entry.
        assertInsideVault(vault, tmp);
        fs.writeFileSync(tmp, rendered[row.index].text, { flag: 'wx' });
        // link is exclusive: EEXIST never replaces another writer's destination.
        assertInsideVault(vault, tmp);
        assertInsideVault(vault, path);
        fs.linkSync(tmp, path);
        row.state = 'created';
        event('published', row);
      } catch (e) { errors.push(fault(e.code === 'EEXIST' ? 'DESTINATION_CONFLICT' : 'ARTIFACT_IO', row.index, e)); break; }
      finally { try { unlinkInside(vault, tmp); } catch {} }
      try { save(); } catch (e) { errors.push(fault('RECEIPT_IO', row.index, e)); return output(); }
    }
    if (!errors.length) {
      try {
        event('manifest', receipt);
        const manifest = buildManifest(vault);
        if (danglingEdges(manifest).length) throw new Error('manifest has unresolved references');
        writeManifest(vault, manifest);
        receipt.manifest = 'complete';
      } catch (e) { receipt.manifest = 'failed'; errors.push(fault('MANIFEST_IO', 'manifest', e)); }
    }
    receipt.phase = errors.length ? 'needs-repair' : 'complete'; receipt.errors = [...errors];
    try { save(); } catch (e) { receipt.phase = 'needs-repair'; errors.push(fault('RECEIPT_IO', 'finalization', e)); }
    return output();
  } catch (e) { for (const f of e.failures || [e]) errors.push(fault(receipt ? 'ARTIFACT_IO' : 'INPUT_INVALID', f.index ?? -1, f)); return output(); }
  finally {
    if (owned) {
      try { unlinkInside(vault, join(lock, 'owner.json')); } catch {}
      try { assertInsideVault(vault, lock); fs.rmdirSync(lock); } catch {}
    }
  }
}
