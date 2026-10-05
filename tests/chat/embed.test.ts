import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMBED, VECTORS_HEADER, createEmbedder, decodeVectors, encodeVectors, quantise, vectorsMismatch, type Transformers } from '../../src/lib/chat/embed.ts';

const HASH = '0123456789abcdef';
const row = (fill: number) => new Int8Array(EMBED.dim).fill(fill);
const manifest = (count: number) => ({ model: EMBED.model, revision: EMBED.revision, dtype: EMBED.dtype, dim: EMBED.dim, scale: EMBED.scale, count });

describe('quantise', () => {
  it('scales to int8 and clamps', () => {
    assert.deepEqual([...quantise([0, 0.3, -0.3, 0.15, 1, -1, 0.001])], [0, 127, -127, 64, 127, -127, 0]);
  });

  it('keeps the direction of a vector', () => {
    const q = quantise([0.1, -0.2, 0.05]);
    assert.ok(q[0] > 0 && q[1] < 0 && q[2] > 0 && Math.abs(q[1]) > q[0]);
  });
});

describe('vectors file', () => {
  it('round-trips rows, hash and count', () => {
    const rows = [row(1), row(-128 + 1), row(127)];
    const bytes = encodeVectors(HASH, rows);
    assert.equal(bytes.length, VECTORS_HEADER + 3 * EMBED.dim);
    assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'DEV1');
    const decoded = decodeVectors(bytes);
    assert.equal(decoded.hash, HASH);
    assert.equal(decoded.count, 3);
    assert.deepEqual([decoded.data[0], decoded.data[EMBED.dim], decoded.data[2 * EMBED.dim], decoded.data.at(-1)], [1, -127, 127, 127]);
  });

  it('decodes from a view into a larger buffer', () => {
    const bytes = encodeVectors(HASH, [row(7)]);
    const padded = new Uint8Array(bytes.length + 5);
    padded.set(bytes, 5);
    assert.equal(decodeVectors(padded.subarray(5)).data[10], 7);
  });

  it('writes a header-only file when there are no vectors', () => {
    const bytes = encodeVectors(HASH, []);
    assert.equal(bytes.length, 16);
    assert.equal(decodeVectors(bytes).count, 0);
  });

  it('rejects a wrong magic, a short file and a wrong row size', () => {
    const bytes = encodeVectors(HASH, [row(1)]);
    assert.throws(() => decodeVectors(Uint8Array.from([...bytes].map((b, i) => (i === 0 ? 88 : b)))), /not a vectors file/);
    assert.throws(() => decodeVectors(bytes.subarray(0, bytes.length - 1)), /wrong length/);
    assert.throws(() => decodeVectors(bytes.subarray(0, 8)), /not a vectors file/);
    assert.throws(() => encodeVectors(HASH, [new Int8Array(10)]), /dimensions/);
    assert.throws(() => encodeVectors('xyz', []), /hash/);
  });

  it('detects vectors that do not belong to the knowledge base', () => {
    const vectors = decodeVectors(encodeVectors(HASH, [row(1), row(2)]));
    const kb = { hash: HASH, embedding: manifest(2), chunks: [0, 1] };
    assert.equal(vectorsMismatch(vectors, kb), undefined);
    assert.match(vectorsMismatch(vectors, { ...kb, hash: 'ffffffffffffffff' })!, /different version/);
    assert.match(vectorsMismatch(vectors, { ...kb, chunks: [0, 1, 2] })!, /number of vectors/);
    assert.match(vectorsMismatch(vectors, { ...kb, embedding: { ...manifest(2), revision: 'other' } })!, /different model/);
    assert.match(vectorsMismatch(vectors, { ...kb, embedding: null })!, /without vectors/);
    assert.match(vectorsMismatch(decodeVectors(encodeVectors(HASH, [])), kb)!, /without vectors/);
  });
});

describe('createEmbedder', () => {
  const calls: unknown[][] = [];
  const fake = (dims: number[], name: string = EMBED.output): Transformers => ({
    AutoTokenizer: { from_pretrained: async (...args) => (calls.push(['tokenizer', ...args]), (text: string) => ({ text })) },
    AutoModel: {
      from_pretrained: async (...args) => (calls.push(['model', ...args]), async () => ({ [name]: { data: new Float32Array(dims[dims.length - 1]).fill(0.5), dims } })),
    },
  });

  it('loads the pinned revision and reads the pooled output', async () => {
    const embedder = await createEmbedder(fake([1, EMBED.dim]), { device: 'wasm' });
    const vector = await embedder.embed('hello');
    assert.equal(vector.length, EMBED.dim);
    assert.equal(vector[0], 0.5);
    assert.deepEqual(calls[0], ['tokenizer', EMBED.model, { revision: EMBED.revision }]);
    assert.deepEqual(calls[1], ['model', EMBED.model, { revision: EMBED.revision, dtype: 'q8', device: 'wasm' }]);
  });

  it('refuses a model that returns another embedding space', async () => {
    await assert.rejects((await createEmbedder(fake([1, 384]))).embed('x'), /768-d/);
    await assert.rejects((await createEmbedder(fake([1, EMBED.dim], 'last_hidden_state'))).embed('x'), /sentence_embedding/);
  });
});
