import { resolve, dirname } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { findProjectConfig, parseProjectConfig } from '../lib/projectconfig.mjs';
import { loadSchema } from '../lib/schema.mjs';
import { bindingIdentity, bindingSnapshot, acknowledgeBinding, isBindingAcknowledged, revokeBinding } from '../lib/trust.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WIDTH = 76;
const safe = value => String(value).replace(/\\|[^\x20-\x7e]/g, c => c === '\\' ? '\\\\' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export async function run(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, ask, ...options } = {}) {
  const now = new Date();
  const line = value => stdout.write(value + '\n');
  const valueLine = (prefix, value, output = stdout) => {
    const escaped = safe(value);
    for (let i = 0; i < escaped.length || i === 0;) {
      const label = i ? '  + ' : prefix;
      const size = WIDTH - label.length;
      output.write(label + escaped.slice(i, i + size) + '\n');
      i += size;
    }
  };
  try {
    // Locate without reading: the snapshot below is the only initial byte read.
    const hit = findProjectConfig(resolve(args._[1] ?? process.cwd()), {
      existsSync: name => !!lstatSync(name, { throwIfNoEntry: false }), readFileSync: () => '',
    });
    if (!hit) { line('No binding found.'); return 1; }
    if (args.revoke && !args.show) {
      valueLine('Binding: ', bindingIdentity(hit.path));
      line(revokeBinding(hit.path, options) ? 'Acknowledgement revoked.' : 'No acknowledgement to revoke.');
      return 0;
    }
    const snapshot = bindingSnapshot(hit.path);
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes); }
    catch { throw new Error('binding must be valid UTF-8'); }
    let data;
    try { data = JSON.parse(raw); } catch (error) { throw new Error(`invalid binding JSON: ${error.message}`); }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('binding JSON must be an object');
    const config = parseProjectConfig(raw, loadSchema(REPO_ROOT));
    valueLine('Binding: ', snapshot.path);
    const lines = raw.split('\n');
    line(`Content: ${snapshot.bytes.length} bytes, ${lines.length} lines`);
    for (let i = 0; i < lines.length; i++) valueLine('  | ', lines[i] + (i < lines.length - 1 ? '\n' : ''));
    valueLine('Vault: ', config.vault ?? '(none)');
    if (config.vault !== undefined) {
      const displayVault = (prefix, realPrefix, lexical) => {
        valueLine(prefix, lexical);
        if (/^[\\/]{2}/.test(config.vault)) {
          line('Vault location was not looked up.');
        } else try {
          const real = realpathSync.native(lexical);
          if (real !== lexical) valueLine(realPrefix, real);
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
          line('Vault location does not exist.');
        }
      };
      const lexical = resolve(dirname(hit.path), config.vault);
      displayVault('Resolved vault: ', 'Real vault: ', lexical);
      const alternate = resolve(dirname(snapshot.path), config.vault);
      if (alternate !== lexical) {
        displayVault('Binding-folder vault: ', 'Real binding-folder vault: ', alternate);
        line('Linked folder: vault locations differ depending on the path.');
      }
    }
    if (config.gates.globs) valueLine('Gate globs: ', JSON.stringify(config.gates.globs));
    if (args.show) {
      line(`Acknowledged: ${isBindingAcknowledged(hit.path, options) ? 'yes' : 'no'}`);
      return 0;
    }
    if (!args.yes) {
      if (!stdin.isTTY) { line('Use research-vault trust --yes to acknowledge without a terminal.'); return 2; }
      let answer;
      if (ask) answer = await ask('Acknowledge this binding? [y/N] ');
      else {
        const rl = createInterface({ input: stdin, output: stdout, terminal: false });
        try { answer = await Promise.race([rl.question('Acknowledge this binding? [y/N] '), new Promise(r => rl.once('close', () => r(undefined)))]); }
        finally { rl.close(); }
      }
      if (!/^(y|yes)$/i.test(answer ?? '')) return 1;
    }
    acknowledgeBinding(hit.path, { ...options, bytes: snapshot.bytes, identity: snapshot.path, now });
    line('Binding acknowledged.');
    return 0;
  } catch (error) {
    valueLine('trust: ', error.message, stderr);
    return 2;
  }
}
