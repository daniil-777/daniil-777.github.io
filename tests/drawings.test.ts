import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = new URL('../public/drawings/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root));
const json = (file: string) => JSON.parse(read(file).toString());

test('drawing model is the pinned fast decoder and its first six objects', () => {
  const meta = json('model/meta.json');
  const provenance = JSON.parse(readFileSync(new URL('../docs/live-drawing-provenance.json', import.meta.url), 'utf8'));
  for (const file of ['decoder.bin.gz', 'anchors-0.bin.gz']) {
    const entry = provenance.files.find((entry: { local: string }) => entry.local === 'drawings/model/' + file);
    assert.equal(createHash('sha256').update(read('model/' + file)).digest('hex'), entry.upstreamSha256);
  }
  assert.equal(meta.format, 'pm2'); assert.equal(meta.size, 384); assert.equal(meta.grid, 48);
  assert.deepEqual(meta.chunks.map((chunk: { file: string }) => chunk.file), ['anchors-0.bin.gz']);
  const anchors = gunzipSync(read('model/anchors-0.bin.gz'));
  assert.equal(anchors.subarray(0, 4).toString(), 'PMA2');
  assert.equal(anchors.readUInt16LE(4), meta.chunks[0].n);
  assert.equal(anchors.readUInt16LE(6), meta.pca.k);
  const decoder = gunzipSync(read('model/decoder.bin.gz'));
  assert.ok(decoder.length >= meta.pca.mean + meta.code * 2, 'decoder holds the PCA basis and mean');
});

test('every photo behind a shipped object is credited', () => {
  const { photos } = json('model/sources.json');
  const credits = read('credits.html').toString();
  const covered = new Set<number>();
  for (const photo of photos) {
    assert.ok(photo.author && photo.license);
    assert.match(photo.url, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(credits.includes(photo.url.replaceAll('&', '&amp;')), photo.url);
    for (const anchor of photo.anchors) if (anchor < 6) covered.add(anchor);
  }
  assert.equal(covered.size, 6);
});

test('the drawing page shares the 3D preview runtime pins and stays light', () => {
  const page = read('drawings.js').toString();
  const boot = readFileSync(new URL('../public/architecture/boot.js', import.meta.url), 'utf8') + readFileSync(new URL('../public/architecture/index.html', import.meta.url), 'utf8');
  const pins = [...page.matchAll(/sha384-[\w+/=]+/g)].map((match) => match[0]);
  assert.equal(pins.length, 3);
  for (const pin of pins) assert.ok(boot.includes(pin), `${pin} differs from the 3D preview, so the browser cache would not be shared`);
  assert.match(page, /channel: CHANNEL, session/);
  assert.match(page, /event\.origin !== location\.origin/);
  const bytes = (dir: URL): number => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? bytes(new URL(entry.name + '/', dir)) : statSync(new URL(entry.name, dir)).size), 0);
  assert.ok(bytes(root) < 600_000, 'the 2D preview stays under 600 KB of local files');
});

test('the 2D and 3D previews use separate channels and pages', async () => {
  const { ARCHITECTURE, DRAWING } = await import('../src/lib/architecture/preview.ts');
  assert.notEqual(DRAWING.channel, ARCHITECTURE.channel);
  assert.equal(DRAWING.src('session=a', true, false), '/drawings/?session=a&play=1');
  assert.equal(DRAWING.src('session=a', false, true), '/drawings/?session=a&play=0&backend=webgl');
  const desktop = new URL(ARCHITECTURE.src('session=a', false, false), 'https://x.test').searchParams;
  assert.equal(desktop.get('play'), '0'); assert.equal(desktop.get('hd'), '1');
  assert.equal(desktop.get('tfjsflags'), 'WEBGL_DELETE_TEXTURE_THRESHOLD:134217728', 'the texture pool is capped (it grew past 2 GB)');
  // touch devices: WebGL with a capped pool and half floats, no HD grid or per-pixel pass (~130 MB, from 2.1 GB)
  const touch = new URL(ARCHITECTURE.src('session=a', false, true), 'https://x.test').searchParams;
  assert.equal(touch.get('backend'), 'webgl'); assert.equal(touch.get('hd'), '0'); assert.equal(touch.get('neural'), '0');
  assert.equal(touch.get('tfjsflags'), 'WEBGL_DELETE_TEXTURE_THRESHOLD:50331648,WEBGL_FORCE_F16_TEXTURES:true');
});
