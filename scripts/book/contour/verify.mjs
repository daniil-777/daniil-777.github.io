/** Independent rollout, geometry, resource and Python/TypeScript parity checks. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  if (index === -1) return;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a path`);
  return resolve(args[index + 1]);
};
const folder = option('--artifacts');
const runtime = option('--runtime') ?? resolve('src/lib/book/contour.ts');
const artwork = option('--artwork') ?? resolve('src/lib/book/artwork.ts');
const metadataPath = folder ? resolve(folder, 'contour-decoder.json') : resolve('public/book/contour/contour-decoder.json');
const binaryPath = folder ? resolve(folder, 'contour-decoder.bin') : resolve('public/book/contour/contour-decoder.bin');
const fixturePath = folder ? resolve(folder, 'parity-fixtures.json') : resolve('docs/book/contour/parity-fixtures.json');
const { parseContourModel, generateContourFromStyle, generateContour, contourStyle } = await import(pathToFileURL(runtime).href);
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const bytes = readFileSync(binaryPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256, 'Checkpoint byte checksum');
const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const model = parseContourModel(metadata, binary);
const count = metadata.architecture.points;
const kinds = metadata.shapes;
const closed = metadata.closed ?? kinds.map(kind => ['leaf', 'flower'].includes(kind));
assert.equal(closed.length, kinds.length, 'Every family declares whether its contour closes');
assert(closed.every(value => typeof value === 'boolean'));
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
assert(fixtures.length >= kinds.length, 'Python parity traces cover the vocabulary');
assert.deepEqual(new Set(fixtures.map(f => f.shape)), new Set(kinds), 'Python traces include every trained family');
const rmsDifference = (a, b) => Math.sqrt(a.reduce((sum, point, i) => sum + (point[0] - b[i][0]) ** 2 + (point[1] - b[i][1]) ** 2, 0) / (2 * a.length));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
function geometry(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const steps = points.slice(1).map((p, i) => distance(p, points[i]));
  return {
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    length: steps.reduce((sum, value) => sum + value, 0), maxStep: Math.max(...steps),
    seam: distance(points[0], points.at(-1)),
    saturation: points.flat().filter(value => Math.abs(value) >= .999).length / (2 * points.length),
  };
}
let maximumDifference = 0;
const parityStart = performance.now();
for (const fixture of fixtures) {
  assert.equal(fixture.points.length, count, 'Python trace has the declared token count');
  const generated = await generateContourFromStyle(model, fixture.shape, fixture.style, undefined, false);
  assert.equal(generated.points.length, count);
  assert.equal(generated.closed, closed[kinds.indexOf(fixture.shape)]);
  for (let point = 0; point < count; point++) {
    for (let axis = 0; axis < 2; axis++) maximumDifference = Math.max(maximumDifference, Math.abs(generated.points[point][axis] - fixture.points[point][axis]));
  }
}
const parityMilliseconds = performance.now() - parityStart;
assert(maximumDifference < .00003, `Python/TypeScript coordinate difference ${maximumDifference}`);

// These fixed xorshift conditions are independent of the Python fixture styles.
const seeds = [1729, 1730, 82419, 1027106, 0x1f123bb5, 0x34a0514b, 0x5e2d4c17, 0x7a6f932d];
const timings = [], families = [], means = [];
let minimumSeedRms = Infinity;
for (const [kindIndex, kind] of kinds.entries()) {
  const samples = [], metrics = [];
  for (const seed of seeds) {
    const started = performance.now();
    const result = await generateContourFromStyle(model, kind, contourStyle(seed), undefined, false);
    timings.push(performance.now() - started);
    assert.equal(result.points.length, count, `${kind}: complete autoregressive rollout`);
    assert.equal(result.closed, closed[kindIndex], `${kind}: declared topology`);
    assert(result.points.flat().every(value => Number.isFinite(value) && Math.abs(value) <= 1), `${kind}: finite, bounded coordinates`);
    const bounds = geometry(result.points);
    assert(bounds.width > .05 && bounds.height > .04 && bounds.length > .35, `${kind}: contour does not collapse`);
    assert(bounds.maxStep < .5, `${kind}: no abrupt decoded jump (${bounds.maxStep})`);
    assert(bounds.saturation < .2, `${kind}: coordinates do not flatten against tanh bounds`);
    if (result.closed) assert(bounds.seam < .18, `${kind}: learned closure avoids an artificial long seam`);
    metrics.push(bounds); samples.push(result.points);
  }
  assert.deepEqual(samples[0], (await generateContourFromStyle(model, kind, contourStyle(seeds[0]), undefined, false)).points, `${kind}: seeded replay is deterministic`);
  const variation = samples.slice(1).map(points => rmsDifference(samples[0], points));
  const smallest = Math.min(...variation);
  minimumSeedRms = Math.min(minimumSeedRms, smallest);
  assert(smallest > .0001, `${kind}: style seeds cause measurable variation`);
  means.push(samples[0].map((_, i) => [0, 1].map(axis => samples.reduce((sum, points) => sum + points[i][axis], 0) / samples.length)));
  families.push({ kind, samples: samples.length, closed: closed[kindIndex], minimumSeedRms: smallest,
    minimumWidth: Math.min(...metrics.map(m => m.width)), minimumHeight: Math.min(...metrics.map(m => m.height)),
    maximumStep: Math.max(...metrics.map(m => m.maxStep)), maximumClosureSeam: Math.max(...metrics.map(m => m.seam)) });
}
let minimumFamilyRms = Infinity, nearestFamilies;
for (let a = 0; a < kinds.length; a++) for (let b = a + 1; b < kinds.length; b++) {
  const difference = rmsDifference(means[a], means[b]);
  if (difference < minimumFamilyRms) { minimumFamilyRms = difference; nearestFamilies = [kinds[a], kinds[b]]; }
  assert(difference > .015, `Families ${kinds[a]}/${kinds[b]} do not collapse to the same mean drawing`);
}
// A generous portability gate catches second-long stalls without imposing a machine-specific benchmark.
assert(percentile(timings, .95) < 1000, 'A single unyielded contour must complete within one second');

assert.throws(() => parseContourModel({ ...metadata, trained: false }, binary));
assert.throws(() => parseContourModel(metadata, binary.slice(0, 12)));
await assert.rejects(() => generateContourFromStyle(model, kinds[0], [2, 0, 0, 0]));
const initialAbort = new AbortController(); initialAbort.abort();
await assert.rejects(() => generateContour(model, kinds[0], 12, initialAbort.signal), { name: 'AbortError' });
const midwayAbort = new AbortController();
const cancellationStart = performance.now();
const pending = generateContour(model, kinds.at(-1), 82419, midwayAbort.signal);
queueMicrotask(() => midwayAbort.abort());
await assert.rejects(() => pending, { name: 'AbortError' });
const cancellationMilliseconds = performance.now() - cancellationStart;
assert(cancellationMilliseconds < 1000, 'Cancellation is observed at a bounded yield boundary');
let eventLoopTicked = false;
setTimeout(() => { eventLoopTicked = true; }, 0);
await generateContour(model, kinds[0], 82419);
assert(eventLoopTicked, 'Default decoding yields to other browser work');

// Drive the real artwork cache against in-memory checkpoint assets. No actual network request occurs.
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async input => {
  const url = String(input); requests.push(url);
  if (url.endsWith('/contour-decoder.json')) return new Response(JSON.stringify(metadata));
  if (url.endsWith('/contour-decoder.bin')) return new Response(binary.slice(0));
  throw new Error(`Unexpected contour asset: ${url}`);
};
try {
  const fresh = await import(pathToFileURL(artwork).href + `?independent-cache-proof=${Date.now()}`);
  assert.deepEqual(requests, [], 'Importing artwork performs no model download');
  const signal = new AbortController().signal;
  const first = await fresh.generateBookArt('ai', 82419, signal);
  assert.equal(requests.length, 2, 'First drawing loads metadata and one weight file');
  assert(first.path.startsWith('M') && first.accent.startsWith('M'));
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(() => fresh.generateBookArt('profile', 82419, cancelled.signal), { name: 'AbortError' });
  await fresh.generateBookArt('wellbeing', 1027106, signal);
  assert.equal(requests.length, 2, 'Cancellation does not poison the cached checkpoint or trigger downloads');
} finally { globalThis.fetch = originalFetch; }

console.log(JSON.stringify({ checkpointVersion: metadata.version, familyCount: kinds.length, tokenCount: count,
  weightBytes: bytes.byteLength, maximumAbsoluteCoordinateDifference: maximumDifference,
  pythonParityFixtures: fixtures.length, parityMilliseconds, independentRollouts: kinds.length * seeds.length,
  unyieldedDrawingMilliseconds: { p50: percentile(timings, .5), p95: percentile(timings, .95), maximum: Math.max(...timings) },
  minimumSeedRms, minimumFamilyRms, nearestFamilies, cancellationMilliseconds,
  deterministicSeeds: true, geometryBounded: true, noncollapsePassed: true, cacheProofPassed: true,
  scope: 'Geometry, topology, seed diversity and family separation are checked automatically. Semantic recognizability still requires viewing the labeled held-out gallery.',
  families }, null, 2));
