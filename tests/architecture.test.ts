import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const root = new URL('../public/architecture/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root));
const json = (file: string) => JSON.parse(read(file).toString());

test('HD model is the pinned decoder and twelve genuine latent records', () => {
  const meta = json('model/meta.json');
  const provenance = JSON.parse(readFileSync(new URL('../docs/live-architecture-provenance.json', import.meta.url), 'utf8'));
  assert.equal(provenance.commit, '107db8f196386da39104f14f86a4c41a426d309e');
  assert.equal(meta.arch, 'v2'); assert.equal(meta.lat, 64); assert.equal(meta.planes_res, 512);
  assert.equal(meta.anchors.length, 12); assert.equal(meta.anchor_chunks.length, 1);
  assert.equal(meta.clip, undefined); assert.equal(meta.prior, undefined);
  for (const file of ['decoder.bin.gz', 'anchors-0.bin.gz']) {
    const entry = provenance.files.find((entry: { local: string }) => entry.local.endsWith(file));
    assert.equal(createHash('sha256').update(read('model/' + file)).digest('hex'), entry.upstreamSha256);
  }
  assert.equal(gunzipSync(read('model/anchors-0.bin.gz')).length, meta.anchor_bytes * 12);
  const weights = gunzipSync(read('model/decoder.bin.gz'));
  const last = meta.weights.at(-1);
  assert.equal(weights.length, last.offset + last.shape.reduce((a: number, b: number) => a * b, 1) * 2);
  for (let offset = 0; offset < weights.length; offset += 2) assert.notEqual(weights.readUInt16LE(offset) & 0x7c00, 0x7c00, 'non-finite fp16 weight');
});

test('all models have attribution and subset map edges remain valid', () => {
  const meta = json('model/meta.json');
  const sources = json('model/sources.json'); const map = json('model/map.json');
  assert.equal(sources.length, meta.anchors.length);
  sources.forEach((source: { anchor: number; author: string; url: string; license: string }, index: number) => {
    assert.equal(source.anchor, index); assert.ok(source.author);
    assert.match(source.url, /^https:\/\/sketchfab\.com\/3d-models\/[a-f0-9]+$/);
    assert.equal(source.license, 'by'); assert.ok(read('credits.html').toString().includes(source.url));
  });
  for (let index = 0; index < 12; index++) {
    assert.equal(map.sknn[index].length, map.siou[index].length);
    for (const neighbor of [...map.knn[index], ...map.sknn[index]]) assert.ok(Number.isInteger(neighbor) && neighbor >= 0 && neighbor < 12);
  }
});

test('frame protocol ignores foreign/stale commands, preserves pause and disposes once', () => {
  const listeners: Record<string, (event: any) => void> = {};
  const origin = 'https://portfolio.test'; const parent = { postMessage() {} };
  let destroyed = 0; let lost = 0; let advanced = 0;
  const app = { st: { hostVisible: false }, paused: true, setPaused(paused: boolean) { this.paused = paused; }, next() { advanced++; }, R3: { paper: [], gl: { getExtension: () => ({ loseContext: () => lost++ }) } } };
  const window: any = { M3D: { app }, tf: { getBackend: () => 'webgpu', backend: () => ({ device: { destroy: () => destroyed++ } }) } };
  runInNewContext(read('ui.js').toString(), { window, parent, document: { documentElement: { dataset: {} } }, location: { origin, search: '?session=current' }, URLSearchParams,
    addEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = listener; }, setInterval: () => 1, clearInterval() {}, matchMedia: () => ({ matches: false }) });
  const send = (extra: any = {}) => listeners.message({ source: parent, origin, data: { channel: 'portfolio-architecture', session: 'current', type: 'visibility', active: true }, ...extra });
  send({ origin: 'https://foreign.test' }); assert.equal(app.st.hostVisible, false);
  send({ source: {} }); assert.equal(app.st.hostVisible, false);
  send({ data: { channel: 'portfolio-architecture', session: 'old', type: 'visibility', active: true } }); assert.equal(app.st.hostVisible, false);
  send(); assert.equal(app.st.hostVisible, true); assert.equal(app.paused, true);
  const command = (type: string) => send({ data: { channel: 'portfolio-architecture', session: 'current', type } });
  command('toggle'); assert.equal(app.paused, false);
  command('toggle'); assert.equal(app.paused, true);
  command('next'); assert.equal(advanced, 1);
  send({ data: { channel: 'portfolio-architecture', session: 'current', type: 'visibility', active: false } }); assert.equal(app.st.hostVisible, false);
  send({ data: { channel: 'portfolio-architecture', session: 'current', type: 'dispose' } });
  send(); assert.equal(app.st.hostVisible, false);
  listeners.pagehide({}); assert.equal(destroyed, 1); assert.equal(lost, 1);
});
