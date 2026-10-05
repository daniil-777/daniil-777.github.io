import type { ModelManifest } from './protocol.ts';

const MAX_ASSET = 50_000_000;
export async function checkedAsset(url: URL, sha256: string, bytes: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!/^[a-f0-9]{64}$/.test(sha256) || bytes < 1 || bytes > MAX_ASSET) throw new Error('Invalid model asset manifest');
  if (url.origin !== location.origin) throw new Error('Model assets must be same origin');
  const cacheName = 'chronos-language-v1';
  let cache: Cache | undefined;
  try { cache = await caches.open(cacheName); } catch { /* Private browsing may disable persistent caching. */ }
  let response = await cache?.match(url.href);
  if (!response) {
    response = await fetch(url, { credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Model asset unavailable (${response.status})`);
  }
  const length = response.headers.get('Content-Length');
  if (length && Number(length) > MAX_ASSET) throw new Error('Model asset exceeds limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Model asset has no body');
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > bytes || received > MAX_ASSET) throw new Error('Model asset exceeds declared length');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const contents = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { contents.set(chunk, offset); offset += chunk.byteLength; }
  const buffer = contents.buffer;
  if (buffer.byteLength !== bytes) { await cache?.delete(url.href); throw new Error('Model asset length mismatch'); }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== sha256) { await cache?.delete(url.href); throw new Error('Model asset hash mismatch'); }
  if (cache) {
    await cache.put(url.href, new Response(buffer));
    // Keep only the selected model and selected tokenizer; bounded across version changes.
    const category = url.pathname.endsWith('/tokenizer.json') ? 'tokenizer' : url.pathname.endsWith('.wasm') ? 'wasm' : url.pathname.endsWith('.mjs') ? 'mjs' : 'model';
    for (const key of await cache.keys()) {
      const path = new URL(key.url).pathname;
      const oldCategory = path.endsWith('/tokenizer.json') ? 'tokenizer' : path.endsWith('.wasm') ? 'wasm' : path.endsWith('.mjs') ? 'mjs' : 'model';
      if (key.url !== url.href && category === oldCategory) await cache.delete(key);
    }
  }
  return buffer;
}
export function validateManifest(value: unknown): ModelManifest {
  const m = value as ModelManifest;
  if (!m || m.schemaVersion !== 1 || m.runtimeVersion !== '1.23.0' || m.dtype !== 'fp32' || m.contextLength !== 256) throw new Error('Unsupported model manifest');
  if (!['released', 'experimental', 'unavailable'].includes(m.releaseStatus)) throw new Error('Invalid release status');
  if (m.architecture?.layers !== 4 || m.architecture.width !== 192 || m.architecture.ffn !== 512 || m.architecture.heads !== 6 || m.architecture.kvHeads !== 2 || m.architecture.headDim !== 32 || m.architecture.vocab !== 4096 || m.architecture.parameters !== 2_361_024) throw new Error('Unsupported model architecture');
  return m;
}
