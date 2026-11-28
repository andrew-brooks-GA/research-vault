// Spec 34: one POST per batch to the operator-approved embedding endpoint.
import { existsSync, readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapePathControls } from './containment.ts';
import { loadProjectConfig } from './projectconfig.mjs';
import { loadSchema } from './schema.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const INDEX = join('_index', 'embeddings.jsonl');
export const EMBEDDING_REQUEST_FAILED = 'EMBEDDING_REQUEST_FAILED';

function parseUrl(address) {
  try { return new URL(address); } catch { return null; }
}

export function embeddingDestination(address) {
  const url = parseUrl(address);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return { refusal: 'embedding endpoint must be an http or https URL' };

  // URL parsing removes an empty user-info prefix. Check the original authority for it too.
  const userInfo = url.username || url.password || /^[^:]+:[/\\\t\r\n]*[^/\\?#]*@/.test(address);
  if (userInfo) {
    url.username = '';
    url.password = '';
  }
  const display = escapePathControls(url.href);
  if (userInfo) return { display, refusal: `embedding endpoint ${display} must not contain user-info` };

  if (parseUrl(process.env.RESEARCH_VAULT_EMBED_URL)?.href !== url.href) {
    return { display, refusal: `set RESEARCH_VAULT_EMBED_URL to ${display} to allow this embedding endpoint` };
  }
  const host = url.hostname;
  const loopback = host === 'localhost' || host === '[::1]' || (isIPv4(host) && host.startsWith('127.'));
  if (url.protocol === 'http:' && !loopback) return { display, refusal: `embedding endpoint ${display} must use HTTPS or loopback HTTP` };
  return { display, url: url.href };
}

function requestError(message) {
  return Object.assign(new Error(message), { code: EMBEDDING_REQUEST_FAILED });
}

export async function embedTexts(cfg, texts, { fetch = globalThis.fetch } = {}) {
  const { url, refusal } = embeddingDestination(cfg.url);
  if (refusal) throw new Error(refusal);
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.RESEARCH_VAULT_EMBED_KEY) headers.Authorization = `Bearer ${process.env.RESEARCH_VAULT_EMBED_KEY}`;
  const body = JSON.stringify({ input: texts, model: cfg.model });
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body, redirect: 'error' });
  } catch {
    throw requestError('embedding endpoint request failed');
  }
  if (!res?.ok) {
    const status = res?.status;
    throw requestError(Number.isInteger(status) ? `embedding endpoint ${status}` : 'embedding endpoint request failed');
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw requestError('embedding endpoint returned invalid JSON');
  }
  const data = json?.data;
  let vectors = json?.embeddings;
  if (data != null) vectors = Array.isArray(data) ? data.map(d => d?.embedding) : null;
  if (!Array.isArray(vectors)) throw requestError(`embedding endpoint returned no vectors for ${texts.length} texts`);
  if (vectors.length !== texts.length) throw requestError(`embedding endpoint returned ${vectors.length} vectors for ${texts.length} texts`);
  if (!vectors.every(v => Array.isArray(v) && v.every(Number.isFinite))) throw requestError('embedding endpoint returned an invalid vector');
  return vectors;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function readIndex(vaultPath) {
  const p = join(vaultPath, INDEX);
  if (!existsSync(p)) return null;
  const [head, ...rest] = readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { header: head, rows: rest };
}

// Check before resolving the vault and collecting text. embedTexts checks again at the request.
export function embeddingGate(name, args) {
  const cfg = loadProjectConfig(args.cwd ?? process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config?.embedding;
  if (!cfg) { process.stderr.write(`${name} refused: no embedding endpoint in .research-vault.json\n`); return null; }
  const { display, refusal } = embeddingDestination(cfg.url);
  if (process.env.RESEARCH_VAULT_ALLOW_NETWORK !== '1') { process.stderr.write(`${name} refused: set RESEARCH_VAULT_ALLOW_NETWORK=1 to send text to ${display}\n`); return null; }
  if (!args['ack-data-egress']) { process.stderr.write(`${name} refused: --ack-data-egress is required (the text leaves this process for ${display})\n`); return null; }
  if (refusal) { process.stderr.write(`${name} refused: ${refusal}\n`); return null; }
  return { cfg, display };
}
