/* Classic worker: the pinned Emscripten engine uses importScripts. Audio never leaves this worker. */
'use strict';

const BASE = '/vendor/whistle/2026-10-02';
const CACHE = 'portfolio-whistle-2026-10-02';
const FILES = [
  { name: 'needle.js', bytes: 62823, sha: 'f3f7366dcad9555b792ee519d2518f3c506038bcb2ffd179e76e850000749359' },
  { name: 'needle.wasm', bytes: 903655, sha: 'c19b9ddf9c7de4eb4f37e5f1811c5bbea9f099041d2a27284daf89789ee8523d' },
  { name: 'whistle.cact', bytes: 16919407, sha: 'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb' },
];
const OUTPUT = 16384;
let model;

async function load() {
  const cache = await self.caches?.open(CACHE).catch(() => undefined);
  const loaded = [0, 0, 0];
  const total = FILES.reduce((sum, file) => sum + file.bytes, 0);
  const progress = () => self.postMessage({ type: 'progress', loaded: loaded.reduce((a, b) => a + b, 0), total });
  const assets = await Promise.all(FILES.map(async (file, index) => {
    const url = `${BASE}/${file.name}`;
    const cached = await cache?.match(url).catch(() => undefined);
    const response = cached || await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error('Voice input could not be downloaded. Please try again.');
    const bytes = new Uint8Array(file.bytes);
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (loaded[index] + value.length > file.bytes) throw new Error('Invalid voice input asset');
        bytes.set(value, loaded[index]);
        loaded[index] += value.length;
        progress();
      }
    } finally {
      reader.releaseLock();
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (loaded[index] !== file.bytes || sha !== file.sha) {
      await cache?.delete(url).catch(() => {});
      throw new Error('Voice input assets could not be verified. Please try again.');
    }
    if (!cached) await cache?.put(url, new Response(bytes)).catch(() => {});
    return bytes;
  }));
  // Execute the verified source; wasmBinary prevents the engine fetching any other files.
  const source = URL.createObjectURL(new Blob([assets[0]], { type: 'text/javascript' }));
  try { importScripts(source); } finally { URL.revokeObjectURL(source); }
  const engine = await self.createNeedle({ wasmBinary: assets[1] });
  const weights = engine._malloc(assets[2].length);
  const output = engine._malloc(OUTPUT);
  if (!weights || !output) throw new Error('Not enough browser memory for voice input.');
  engine.HEAPU8.set(assets[2], weights);
  if (engine._needle_load(weights, BigInt(assets[2].length)) !== 0) throw new Error('Voice input could not start on this browser.');
  // The engine references the weight allocation for its lifetime. Never free it after load.
  return { engine, output, weights };
}

async function handle(data) {
  try {
    const { engine, output } = await (model ??= load());
    if (data.type === 'load') return self.postMessage({ type: 'ready' });
    if (data.type !== 'transcribe' || !(data.audio instanceof Float32Array) || data.audio.length < 1 || data.audio.length > 480000 || !data.audio.every(Number.isFinite)) {
      throw new Error('Invalid audio recording');
    }
    const pcm = engine._malloc(data.audio.byteLength);
    if (!pcm) throw new Error('Not enough browser memory for this recording.');
    try {
      engine.HEAPU8.set(new Uint8Array(data.audio.buffer, data.audio.byteOffset, data.audio.byteLength), pcm);
      if (engine._needle_transcribe(pcm, data.audio.length, 0, 0, 0, output, OUTPUT) < 0) throw new Error('The recording could not be transcribed. Please try again.');
      const transcript = JSON.parse(engine.UTF8ToString(output));
      if (typeof transcript.text !== 'string') throw new Error('Invalid voice transcript');
      self.postMessage({ type: 'transcript', id: data.id, text: transcript.text.trim() });
    } finally {
      engine._free(pcm);
    }
  } catch (error) {
    model = undefined;
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Voice input is unavailable. Please try typing.' });
  }
}

// Serialize calls: Needle's speech model is process-global and is not thread-safe.
let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
