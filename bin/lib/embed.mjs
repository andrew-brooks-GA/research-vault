// Spec 34: the bring-your-own embedding endpoint. One POST per batch to the binding's `embedding.url`
// through the global fetch (the operator chose the endpoint, which may be local, so the refresh
// fetcher's SSRF guard is not applied); the index is a disposable cache at _index/embeddings.jsonl.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const INDEX = join('_index', 'embeddings.jsonl');

export async function embedTexts(cfg, texts, { fetch = globalThis.fetch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.RESEARCH_VAULT_EMBED_KEY) headers.Authorization = `Bearer ${process.env.RESEARCH_VAULT_EMBED_KEY}`;
  const res = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ input: texts, model: cfg.model }) });
  if (!res.ok) throw new Error(`embedding endpoint ${res.status}`);
  const json = await res.json();
  const vectors = json.data?.map(d => d.embedding) ?? json.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error(`embedding endpoint returned ${vectors?.length ?? 'no'} vectors for ${texts.length} texts`);
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
