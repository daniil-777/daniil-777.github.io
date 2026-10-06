import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseContourModel, loadContourModel, generateContour, generateContourFromStyle, contourStyle, type ContourKind, type ContourPoint } from '../src/lib/book/contour.ts';
import { contourPath } from '../src/lib/book/artwork.ts';

const metadata = JSON.parse(readFileSync(resolve('public/book/contour/contour-decoder.json'), 'utf8'));
const bytes = readFileSync(resolve('public/book/contour/contour-decoder.bin'));
const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const fixtures: { shape: ContourKind; style: number[]; points: ContourPoint[] }[] = JSON.parse(readFileSync(resolve('docs/book/contour/parity-fixtures.json'), 'utf8'));
const model = parseContourModel(metadata, binary);
const kinds: ContourKind[] = metadata.shapes;

test('the shipped contour weights match the trained artifact receipt', () => {
  assert.equal(metadata.trained, true);
  assert.equal(metadata.version, 2);
  assert.equal(kinds.length, 16);
  assert.equal(metadata.architecture.points, 96);
  const receipt = JSON.parse(readFileSync(resolve('docs/book/contour/training-report.json'), 'utf8'));
  assert.equal(receipt.trainExamples, 64000);
  assert.equal(receipt.testExamples, 3200);
  assert.equal(receipt.qualityPassed, true);
  assert.equal(receipt.afterWeightsSha256, metadata.sha256);
  assert.equal(metadata.parameterCount, 52130);
  assert.equal(bytes.byteLength, 208520);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
});

test('the incremental causal decoder reproduces independent Python traces', async () => {
  let maximumDifference = 0;
  for (const fixture of fixtures) {
    const art = await generateContourFromStyle(model, fixture.shape, fixture.style, undefined, false);
    assert.equal(art.points.length, metadata.architecture.points);
    assert.equal(art.closed, (metadata.closed ?? kinds.map(kind => kind === 'leaf' || kind === 'flower'))[kinds.indexOf(fixture.shape)]);
    for (let i = 0; i < art.points.length; i++) {
      for (let axis = 0; axis < 2; axis++) maximumDifference = Math.max(maximumDifference, Math.abs(art.points[i][axis] - fixture.points[i][axis]));
    }
  }
  assert.ok(maximumDifference < 0.00002, `coordinate difference ${maximumDifference}`);
});

test('seeded conditions yield distinct bounded drawings in each learned family', async () => {
  for (const kind of kinds) {
    const a = await generateContour(model, kind, 82419);
    assert.deepEqual(a, await generateContour(model, kind, 82419));
    assert.notDeepEqual(a, await generateContour(model, kind, 1027106));
    assert.ok(a.points.flat().every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  }
  assert.deepEqual(contourStyle(0), contourStyle(0));
});

test('smoothing learned points makes finite curves contained in the page', async () => {
  for (const kind of kinds) {
    for (const seed of [7, 82419, 1027106]) {
      const art = await generateContourFromStyle(model, kind, contourStyle(seed), undefined, false);
      const path = contourPath(art.points, art.closed);
      assert.ok(!path.includes('NaN') && !path.includes('Infinity'));
      assert.equal(path.endsWith('Z'), art.closed);
      const values = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      assert.equal(values.length, 2 + 6 * (metadata.architecture.points - 1));
      let previous = values.slice(0,2);
      for (let offset = 2; offset < values.length; offset += 6) {
        const control1 = values.slice(offset, offset+2);
        const control2 = values.slice(offset+2, offset+4);
        const endpoint = values.slice(offset+4, offset+6);
        for (let step = 0; step <= 16; step++) {
          const t = step/16, inverse = 1-t;
          for (let axis = 0; axis < 2; axis++) {
            const coordinate = inverse**3*previous[axis] + 3*inverse**2*t*control1[axis] + 3*inverse*t**2*control2[axis] + t**3*endpoint[axis];
            assert.ok(Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 200, `curve escaped page at ${coordinate}`);
          }
        }
        previous = endpoint;
      }
    }
  }
});

test('malformed assets fail before inference allocates their tensor caches', () => {
  assert.throws(() => parseContourModel(null, binary));
  assert.throws(() => parseContourModel({ ...metadata, trained: false }, binary));
  assert.throws(() => parseContourModel({ ...metadata, architecture: { ...metadata.architecture, layers: 40 } }, binary));
  assert.throws(() => parseContourModel(metadata, binary.slice(0, binary.byteLength-4)));
  const badOffset = structuredClone(metadata);
  badOffset.weights['input.weight'].offset = metadata.parameterCount;
  assert.throws(() => parseContourModel(badOffset, binary));
  const badShape = structuredClone(metadata);
  badShape.weights['input.weight'].shape = [10, 10];
  assert.throws(() => parseContourModel(badShape, binary));
  const transposed = structuredClone(metadata);
  transposed.weights['input.weight'].shape.reverse();
  assert.throws(() => parseContourModel(transposed, binary));
  const overlapping = structuredClone(metadata);
  overlapping.weights['input.bias'].offset = 0;
  assert.throws(() => parseContourModel(overlapping, binary));
  const extra = structuredClone(metadata);
  extra.weights['unused.weight'] = { offset: 0, length: 1, shape: [1] };
  assert.throws(() => parseContourModel(extra, binary));
  const missing = structuredClone(metadata);
  delete missing.weights['blocks.1.down.weight'];
  assert.throws(() => parseContourModel(missing, binary));
  const nonfinite = binary.slice(0);
  new DataView(nonfinite).setFloat32(0, NaN, true);
  assert.throws(() => parseContourModel(metadata, nonfinite));
});

test('invalid generation conditions and malformed paths are rejected', async () => {
  for (const style of [[0,0,0], [2,0,0,0], [0,NaN,0,0], new Array<number>(4)]) {
    await assert.rejects(() => generateContourFromStyle(model, 'leaf', style));
  }
  await assert.rejects(() => generateContour(model, 'leaf', NaN));
  await assert.rejects(() => generateContourFromStyle(model, 'unknown' as ContourKind, [0,0,0,0]));
  assert.throws(() => contourPath([[0,0],[1,1],[0,0]], false));
  assert.throws(() => contourPath([[0,0],[NaN,0],[0,0],[0,0]], false));
  assert.throws(() => contourPath([[],[],[],[]] as unknown as ContourPoint[], false));
});

test('cancelled contour decoding stops both before work and at a yield boundary', async () => {
  const initial = new AbortController(); initial.abort();
  await assert.rejects(() => generateContour(model, 'wave', 82419, initial.signal), { name: 'AbortError' });
  const during = new AbortController();
  const pending = generateContour(model, 'flower', 82419, during.signal);
  queueMicrotask(() => during.abort());
  await assert.rejects(() => pending, { name: 'AbortError' });
});

test('importing book artwork fetches no model; first generation fetches and caches only its two assets', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/contour-decoder.json')) return new Response(JSON.stringify(metadata), { headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/contour-decoder.bin')) return new Response(binary.slice(0));
    throw new Error(`Unexpected eager model fetch: ${url}`);
  }) as typeof fetch;
  try {
    const fresh = await import(pathToFileURL(resolve('src/lib/book/artwork.ts')).href + '?contour-lazy-test');
    assert.deepEqual(calls, []);
    const signal = new AbortController().signal;
    const first = await fresh.generateBookArt('wellbeing', 82419, signal);
    assert.equal(calls.length, 2);
    assert.ok(first.path.startsWith('M') && first.accent.startsWith('M'));
    await fresh.generateBookArt('profile', 1027106, signal);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

test('loading rejects a mismatched metadata and weight pair before decoding', async () => {
  const original = globalThis.fetch;
  const damaged = binary.slice(0);
  new Uint8Array(damaged)[0] ^= 1;
  globalThis.fetch = (async input => new Response(String(input).endsWith('.json') ? JSON.stringify(metadata) : damaged)) as typeof fetch;
  try { await assert.rejects(() => loadContourModel(), /do not match their checkpoint/); }
  finally { globalThis.fetch = original; }
});

test('published training and runtime receipts bind to the actual artifact bytes', () => {
  const manifest: Record<string, { bytes: number; sha256: string }> = JSON.parse(readFileSync(resolve('docs/book/contour/artifact-manifest.json'), 'utf8'));
  for (const [name, entry] of Object.entries(manifest)) {
    if (name === 'localCorpus') continue;
    const artifact = readFileSync(resolve(name));
    assert.equal(artifact.byteLength, entry.bytes, name);
    assert.equal(createHash('sha256').update(artifact).digest('hex'), entry.sha256, name);
  }
});
