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

/**
 * Shapes only: enough of TF.js to run the decoder without a GPU. Like TF.js (reshapes share their buffer; with a submit
 * per dispatch, a freed buffer is reusable at once; WebGL convolves through an im2col texture of k*k*Cin floats per
 * output pixel), freed buffers are pooled by exact size: `pooled` is the GPU memory that leaves allocated, `live` what
 * tensors hold.
 */
function shapeOnlyTf(backend: string) {
  let live = 0, peak = 0, pooled = 0;
  const free = new Map<number, number>(), scopes: Set<any>[] = [];
  const make = (shape: number[], data?: { bytes: number; refs: number }): any => {
    const size = shape.reduce((a, b) => a * b, 1);
    if (!data) {
      data = { bytes: 4 * size, refs: 0 };
      const spare = free.get(data.bytes) ?? 0;
      if (spare) free.set(data.bytes, spare - 1); else pooled += data.bytes;
      live += data.bytes; peak = Math.max(peak, live);
    }
    const buffer = data;
    buffer.refs++;
    const t = { shape, size, data: buffer, isDisposed: false, dispose() {
      if (t.isDisposed) return;
      t.isDisposed = true;
      if (--buffer.refs === 0) { live -= buffer.bytes; free.set(buffer.bytes, (free.get(buffer.bytes) ?? 0) + 1); }
    } };
    scopes.at(-1)?.add(t);
    return t;
  };
  const same = (x: any) => make([...x.shape]);
  const binary = (a: any, b: any) => {
    const n = Math.max(a.shape.length, b.shape.length), pad = (s: number[]) => Array(n - s.length).fill(1).concat(s);
    return make(pad(a.shape).map((d: number, i: number) => Math.max(d, pad(b.shape)[i])));
  };
  const conv = (x: any, f: any, pad: any = 'same') => {             // 'same', or [[0, 0], [top, bottom], [left, right], [0, 0]]
    const [kh, kw, cin, cout] = f.shape;
    const [h, w] = [1, 2].map((i) => (pad === 'same' ? x.shape[i] : x.shape[i] - f.shape[i - 1] + 1 + pad[i][0] + pad[i][1]));
    const im2col = backend === 'webgl' && kh * kw > 1 ? make([x.shape[0], kh * kw * cin, h * w]) : null;
    const y = make([x.shape[0], h, w, cout]);
    im2col?.dispose();
    return y;
  };
  const resize = (x: any, [h, w]: number[]) => make([x.shape[0], h, w, x.shape[3]]);
  return {
    tensor: (_: unknown, shape: number[]) => make(shape),
    slice: (x: any, begin: number[], size: number[]) => make(size.map((s, i) => (s === -1 ? x.shape[i] - begin[i] : s))),
    reshape: (x: any, shape: number[]) => make(shape.map((d) => (d === -1 ? x.size / -shape.reduce((a, b) => a * b, 1) : d)), x.data),
    add: binary, sub: binary, mul: binary, relu: same, rsqrt: same,
    mean: (x: any, axes: number | number[]) => make(x.shape.filter((_: number, i: number) => ![axes].flat().includes(i))),
    matMul: (a: any, b: any) => make([...a.shape.slice(0, -1), b.shape.at(-1)]),
    conv2d: (x: any, filter: any, _: number, pad: any) => conv(x, filter, pad),
    fused: { conv2d: ({ x, filter, pad }: any) => conv(x, filter, pad), matMul: ({ a, b }: any) => make([a.shape[0], b.shape[1]]),
      depthwiseConv2d: ({ x, filter }: any) => make([...x.shape.slice(0, 3), x.shape[3] * filter.shape[3]]) },
    split: (x: any, n: number, axis: number) => Array.from({ length: n }, () => make(x.shape.map((d: number, i: number) => (i === axis ? d / n : d)))),
    concat: (list: any[], axis: number) => make(list[0].shape.map((d: number, i: number) => (i === axis ? list.reduce((s, t) => s + t.shape[i], 0) : d))),
    image: { resizeNearestNeighbor: resize, resizeBilinear: resize },
    tidy(fn: () => any) {
      scopes.push(new Set());
      let result;
      try { result = fn(); } finally {
        const own = scopes.pop()!, kept = new Set([result].flat());
        for (const t of own) if (kept.has(t)) scopes.at(-1)?.add(t); else t.dispose();
      }
      return result;
    },
    dispose: (x: any) => [x].flat().forEach((t) => t.dispose()),
    getBackend: () => backend,
    memory: () => ({ numBytes: live, pooled }),
    peakSince() { const p = peak; peak = live; return p; },
  };
}

test('the compact preview decodes keyframes inside a GPU memory budget on every backend', () => {
  // This accounting matches Chromium within a few percent. With the old decoder (one tidy around everything) TF.js held
  // 1515 MB after a keyframe on WebGPU and 2345 MB on WebGL, more than a phone's browser grants a page before killing
  // and reloading it. Now: 449 MB and 745 MB.
  const MB = 2 ** 20;
  const meta = json('model/meta.json');
  for (const backend of ['webgpu', 'webgl']) {
    const tf = shapeOnlyTf(backend), window: any = {};
    for (const file of ['runtime/m3d-model.js', 'runtime/m3d-model2.js']) runInNewContext(read(file).toString(), { window, tf });
    const model = window.M3D.createModel(meta, gunzipSync(read('model/decoder.bin.gz')));
    model.addAnchors(gunzipSync(read('model/anchors-0.bin.gz')), 0);
    const base = tf.memory().numBytes;
    for (const [anchor, size] of [[0, 96], [0, 160], [5, 96]]) {   // a keyframe, the fine grid of its hold, the next one
      const z = model.tensor({ terms: [[anchor, 1]] }), P = model.planes(z, size);
      assert.deepEqual(P.shape, [3, size, size, meta.hid + meta.dec.chc]);
      tf.dispose([z, P]);
      assert.equal(tf.memory().numBytes, base, `${backend}: nothing outlives a keyframe`);
    }
    const budget = backend === 'webgl' ? 768 : 512;                   // WebGL pools its im2col textures as well
    assert.ok(tf.memory().pooled < budget * MB, `${backend}: compact keyframes leave under ${budget} MB allocated`);
    const z = model.tensor({ terms: [[0, 1]] });
    tf.peakSince();
    const full = model.planes(z);
    assert.deepEqual(full.shape, [3, meta.planes_res, meta.planes_res, meta.hid + meta.dec.chc]);
    assert.ok(tf.peakSince() - base < 600 * MB, `${backend}: full planes keep under 600 MB alive at once`);
    full.dispose();
    // A decode that fails half way (a lost device, an allocation the GPU refuses) is retried: it must leave nothing behind.
    const depthwise = tf.fused.depthwiseConv2d;
    let calls = 0;
    tf.fused.depthwiseConv2d = (args: any) => { if (++calls === 2) throw new Error('device lost'); return depthwise(args); };
    assert.throws(() => model.planes(z, 160), /device lost/);
    tf.fused.depthwiseConv2d = depthwise;
    z.dispose();
    assert.equal(tf.memory().numBytes, base, `${backend}: a failed keyframe releases everything`);
  }
});
