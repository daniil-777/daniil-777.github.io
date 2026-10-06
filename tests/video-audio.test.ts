import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file));

/** Read MP4 boxes, rather than searching compressed video bytes for audio text. */
function boxes(bytes: Buffer) {
  const result: { type: string; data: Buffer }[] = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    let size = bytes.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      assert.ok(offset + 16 <= bytes.length, 'truncated extended MP4 box');
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) size = bytes.length - offset;
    assert.ok(size >= header && offset + size <= bytes.length, 'invalid MP4 box');
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + header, offset + size) });
    offset += size;
  }
  return result;
}

function audioCodecs(file: string) {
  const movie = boxes(read(file)).find(box => box.type === 'moov');
  assert.ok(movie, `${file}: missing movie metadata`);
  return boxes(movie.data).filter(box => box.type === 'trak').flatMap(track => {
    const media = boxes(track.data).find(box => box.type === 'mdia');
    assert.ok(media, `${file}: missing track metadata`);
    const children = boxes(media.data);
    const handler = children.find(box => box.type === 'hdlr');
    if (handler?.data.toString('ascii', 8, 12) !== 'soun') return [];
    const info = children.find(box => box.type === 'minf');
    const table = info && boxes(info.data).find(box => box.type === 'stbl');
    const description = table && boxes(table.data).find(box => box.type === 'stsd');
    assert.ok(description, `${file}: missing audio sample description`);
    return boxes(description.data.subarray(8)).map(box => box.type);
  });
}

describe('suturing demo sound', () => {
  const id = 'ai-proctor-davos';
  const text = read('src/content/projects/ai-proctor.md').toString();
  const project = parse(text.match(/^---\n([\s\S]*?)\n---/)![1]);
  const manifest = JSON.parse(read('src/data/media.json').toString())[id];

  it('keeps the original narration when media is regenerated', () => {
    assert.equal(project.videos.find((video: { id: string }) => video.id === id).audio, true);
    assert.equal(manifest.audio, true);
  });

  for (const rendition of ['src', 'small'] as const) {
    it(`${rendition}: ships a browser-compatible AAC audio track`, () => {
      assert.deepEqual(audioCodecs(`public${manifest[rendition]}`), ['mp4a']);
    });
  }

  it('keeps the automatic card preview silent', () => {
    assert.deepEqual(audioCodecs(`public${manifest.preview}`), []);
  });

  it('versions player and download URLs so cached silent files are replaced', () => {
    const files = ['build/index.html', 'build/work/ai-proctor/index.html'];
    for (const file of files) {
      const content = read(file).toString();
      assert.ok(content.includes(`${manifest.src}?v=${manifest.sig.full}`), `${file}: unversioned desktop video`);
      assert.ok(content.includes(`${manifest.small}?v=${manifest.sig.small}`), `${file}: unversioned phone video`);
    }
    const downloads = read('build/chat/resources.json').toString();
    assert.ok(downloads.includes(`${manifest.small}?v=${manifest.sig.small}`), 'video downloads use the versioned phone rendition');
  });
});
