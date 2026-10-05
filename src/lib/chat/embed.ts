/**
 * The optional semantic tier: one embedding model, used by the build (to embed
 * every chunk) and by the browser (to embed the question). Both call
 * `createEmbedder`, so the two sides cannot drift apart.
 */

export const EMBED = {
  model: 'MongoDB/mdbr-leaf-ir',
  revision: '4262131b32c3182bd06e67e92ae69d7bd66e0c5c',
  dtype: 'q8',
  dim: 768,
  /** A float component x is stored as round(x × 127 / scale), clamped to ±127. */
  scale: 0.3,
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
  /** The ONNX output that holds the pooled, normalised 768-d embedding. */
  output: 'sentence_embedding',
} as const;

export const VECTORS_MAGIC = 'DEV1';
export const VECTORS_HEADER = 16;

/** The part of `@huggingface/transformers` that is used here. The tokenizer classes are looked up by name. */
export interface Transformers {
  AutoTokenizer: { from_pretrained(model: string, options?: object): Promise<unknown> };
  AutoModel: { from_pretrained(model: string, options?: object): Promise<unknown> };
  [name: string]: unknown;
}

/** The parsed tokenizer.json and tokenizer_config.json of the model, when the caller has them on disk. */
export interface TokenizerFiles {
  tokenizer: Record<string, unknown>;
  config: Record<string, unknown>;
}

type Tokenizer = (text: string, options: object) => object;
type Model = (inputs: object) => Promise<Record<string, { data: ArrayLike<number>; dims: number[] } | undefined>>;

export interface Embedder {
  /** The embedding of one text, as produced by the model (unit length). */
  embed(text: string): Promise<Float32Array>;
}

/** The tokenizer built from files already read, the way the library builds it after downloading them. */
function tokenizerFrom(transformers: Transformers, files: TokenizerFiles): Tokenizer {
  const name = String(files.config.tokenizer_class ?? '').replace(/Fast$/, '');
  const Class = (transformers[name] ?? transformers.PreTrainedTokenizer) as new (tokenizer: object, config: object) => Tokenizer;
  return new Class(files.tokenizer, files.config);
}

/**
 * `options` are passed to the model loader, e.g. `{ device: 'wasm', progress_callback }`.
 * With `files` the tokenizer is not fetched (embed-node.ts).
 */
export async function createEmbedder(transformers: Transformers, options: object = {}, files?: TokenizerFiles): Promise<Embedder> {
  const tokenizer = files ? tokenizerFrom(transformers, files) : ((await transformers.AutoTokenizer.from_pretrained(EMBED.model, { revision: EMBED.revision })) as Tokenizer);
  const model = (await transformers.AutoModel.from_pretrained(EMBED.model, { revision: EMBED.revision, dtype: EMBED.dtype, ...options })) as Model;
  return {
    async embed(text) {
      const output = (await model(tokenizer(text, { padding: true, truncation: true })))[EMBED.output];
      if (!output || output.dims[output.dims.length - 1] !== EMBED.dim) throw new Error(`[chat] the model returned no ${EMBED.dim}-d "${EMBED.output}"`);
      return Float32Array.from(output.data as ArrayLike<number>).slice(0, EMBED.dim);
    },
  };
}

export function quantise(vector: ArrayLike<number>, scale: number = EMBED.scale): Int8Array {
  const out = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round((vector[i] * 127) / scale)));
  return out;
}

/**
 * The file layout of vectors.bin: "DEV1", the 8 bytes of the knowledge-base
 * hash, the row count (uint32, little-endian), then count × 768 int8 values.
 * With no rows it is the 16-byte header alone, which means "no vectors".
 */
export function encodeVectors(hash: string, rows: Int8Array[]): Uint8Array {
  if (!/^[0-9a-f]{16}$/.test(hash)) throw new Error('[chat] the knowledge-base hash must be 16 hex characters');
  const bytes = new Uint8Array(VECTORS_HEADER + rows.length * EMBED.dim);
  for (let i = 0; i < 4; i++) bytes[i] = VECTORS_MAGIC.charCodeAt(i);
  for (let i = 0; i < 8; i++) bytes[4 + i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  new DataView(bytes.buffer).setUint32(12, rows.length, true);
  rows.forEach((row, index) => {
    if (row.length !== EMBED.dim) throw new Error(`[chat] vector ${index} has ${row.length} dimensions, expected ${EMBED.dim}`);
    bytes.set(new Uint8Array(row.buffer, row.byteOffset, row.length), VECTORS_HEADER + index * EMBED.dim);
  });
  return bytes;
}

export interface Vectors {
  hash: string;
  count: number;
  /** Row-major, count × 768. */
  data: Int8Array;
}

/** Throws on a file that is not a vectors.bin or that was cut short. */
export function decodeVectors(bytes: Uint8Array): Vectors {
  if (bytes.length < VECTORS_HEADER || String.fromCharCode(...bytes.subarray(0, 4)) !== VECTORS_MAGIC) throw new Error('[chat] not a vectors file');
  const hash = [...bytes.subarray(4, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  if (bytes.length !== VECTORS_HEADER + count * EMBED.dim) throw new Error('[chat] the vectors file has the wrong length');
  return { hash, count, data: new Int8Array(bytes.buffer, bytes.byteOffset + VECTORS_HEADER, count * EMBED.dim) };
}

/** Why these vectors cannot be used with this knowledge base, or nothing if they can. */
export function vectorsMismatch(
  vectors: Vectors,
  kb: { hash: string; embedding: null | { model: string; revision: string; dtype: string; dim: number; scale: number; count: number }; chunks: unknown[] },
): string | undefined {
  const e = kb.embedding;
  if (!e || vectors.count === 0) return 'the site was built without vectors';
  if (vectors.hash !== kb.hash) return 'the vectors belong to a different version of the content';
  if (vectors.count !== kb.chunks.length || e.count !== vectors.count) return 'the number of vectors does not match the number of chunks';
  if (e.model !== EMBED.model || e.revision !== EMBED.revision || e.dtype !== EMBED.dtype || e.dim !== EMBED.dim || e.scale !== EMBED.scale) {
    return 'the vectors were made with a different model';
  }
  return undefined;
}
