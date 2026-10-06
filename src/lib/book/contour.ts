/** Exact dependency-free inference for the trained 2-layer causal vector decoder. */
export const CONTOUR_KINDS = ['leaf', 'wave', 'mountain', 'flower', 'lotus', 'shell', 'butterfly', 'moon', 'cloud', 'koi', 'swan', 'fern', 'ginkgo', 'feather', 'acorn', 'pebble'] as const;
export type ContourKind = typeof CONTOUR_KINDS[number];
export type ContourPoint = [number, number];
type WeightDescriptor = { offset: number; length: number; shape: number[] };
type Metadata = {
  version: number;
  trained: boolean;
  dtype: string;
  byteLength: number;
  parameterCount: number;
  shapes: string[];
  closed?: boolean[];
  sha256: string;
  architecture: { width: number; layers: number; heads: number; ffn: number; points: number; input: number; epsilon: number };
  weights: Record<string, WeightDescriptor>;
};
export type ContourModel = {
  metadata: Metadata;
  weights: ReadonlyMap<string, Float32Array>;
};

const LEGACY_KINDS = CONTOUR_KINDS.slice(0, 4);

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Contour generation cancelled', 'AbortError');
}

export function parseContourModel(metadataValue: unknown, binary: ArrayBuffer): ContourModel {
  const metadata = metadataValue as Metadata;
  const c = metadata?.architecture;
  const legacy = metadata?.version === 1;
  const kinds = legacy ? LEGACY_KINDS : CONTOUR_KINDS;
  if (![1, 2].includes(metadata?.version) || metadata.trained !== true || metadata.dtype !== 'float32-le' ||
      !c || c.width !== (legacy ? 32 : 48) || c.layers !== 2 || c.heads !== 4 || c.ffn !== (legacy ? 64 : 96) ||
      c.points !== (legacy ? 48 : 96) || c.input !== 6 + kinds.length || c.epsilon !== 1e-6 ||
      !Number.isSafeInteger(metadata.parameterCount) || metadata.parameterCount < 10000 || metadata.parameterCount > 100000 ||
      metadata.byteLength !== binary.byteLength || binary.byteLength !== metadata.parameterCount * 4 ||
      !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
      !Array.isArray(metadata.shapes) || metadata.shapes.join(',') !== kinds.join(',') ||
      (!legacy && (!Array.isArray(metadata.closed) || metadata.closed.length !== kinds.length || metadata.closed.some(value => typeof value !== 'boolean')))) {
    throw new Error('Unsupported contour decoder checkpoint');
  }
  const expected: Record<string, number[]> = { 'input.weight': [c.width, c.input], 'input.bias': [c.width], 'position.weight': [c.points, c.width] };
  for (let layer = 0; layer < c.layers; layer++) {
    const prefix = `blocks.${layer}.`;
    Object.assign(expected, {
      [prefix + 'attention_norm.weight']: [c.width], [prefix + 'qkv.weight']: [c.width * 3, c.width],
      [prefix + 'attention_out.weight']: [c.width, c.width], [prefix + 'feedforward_norm.weight']: [c.width],
      [prefix + 'gate.weight']: [c.ffn, c.width], [prefix + 'up.weight']: [c.ffn, c.width], [prefix + 'down.weight']: [c.width, c.ffn],
    });
  }
  Object.assign(expected, { 'norm.weight': [c.width], 'output.weight': [2, c.width], 'output.bias': [2] });
  if (!metadata.weights || Object.keys(metadata.weights).sort().join(',') !== Object.keys(expected).sort().join(',')) throw new Error('Unexpected contour weight tensors');
  const intervals: [number, number][] = [];
  for (const [name, shape] of Object.entries(expected)) {
    const descriptor = metadata.weights[name];
    if (!descriptor || !Array.isArray(descriptor.shape) || descriptor.shape.join(',') !== shape.join(',') ||
        descriptor.length !== shape.reduce((total, size) => total * size, 1) ||
        !Number.isSafeInteger(descriptor.offset) || descriptor.offset < 0 || descriptor.offset + descriptor.length > metadata.parameterCount) throw new Error('Invalid contour weight tensor');
    intervals.push([descriptor.offset, descriptor.offset + descriptor.length]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [start, end] of intervals) { if (start !== covered) throw new Error('Contour tensors overlap or leave gaps'); covered = end; }
  if (covered !== metadata.parameterCount) throw new Error('Unaccounted contour parameters');
  const weights = new Map<string, Float32Array>();
  const view = new DataView(binary);
  for (const [name, descriptor] of Object.entries(metadata.weights ?? {})) {
    const { offset, length, shape } = descriptor;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 ||
        offset + length > metadata.parameterCount || !Array.isArray(shape) ||
        shape.some(value => !Number.isSafeInteger(value) || value < 1) ||
        shape.reduce((total, size) => total * size, 1) !== length) throw new Error('Invalid contour weight tensor');
    const values = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      values[i] = view.getFloat32((offset + i) * 4, true);
      if (!Number.isFinite(values[i])) throw new Error('Nonfinite contour weight');
    }
    weights.set(name, values);
  }
  return { metadata, weights };
}

export async function loadContourModel(
  metadataUrl = '/book/contour/contour-decoder.json',
  weightsUrl = '/book/contour/contour-decoder.bin',
  signal?: AbortSignal,
): Promise<ContourModel> {
  const [metadataResponse, weightResponse] = await Promise.all([
    fetch(metadataUrl, { cache: 'no-cache', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]) }),
    fetch(weightsUrl, { cache: 'no-cache', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]) }),
  ]);
  if (!metadataResponse.ok || !weightResponse.ok) throw new Error('Contour model could not be loaded');
  const [metadata, binary] = await Promise.all([metadataResponse.json(), weightResponse.arrayBuffer()]);
  assertNotAborted(signal);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', binary)), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== metadata.sha256) throw new Error('Contour weights do not match their checkpoint');
  assertNotAborted(signal);
  return parseContourModel(metadata, binary);
}

function weight(model: ContourModel, name: string, expectedLength: number): Float32Array {
  const values = model.weights.get(name);
  if (!values || values.length !== expectedLength) throw new Error(`Missing contour tensor: ${name}`);
  return values;
}

function linear(input: Float32Array, matrix: Float32Array, outputs: number, bias?: Float32Array): Float32Array {
  const result = new Float32Array(outputs);
  for (let row = 0; row < outputs; row++) {
    let sum = bias?.[row] ?? 0;
    for (let column = 0; column < input.length; column++) sum += matrix[row * input.length + column] * input[column];
    result[row] = sum;
  }
  return result;
}

function rms(input: Float32Array, scale: Float32Array): Float32Array {
  let squared = 0;
  for (const value of input) squared += value * value;
  const divisor = 1 / Math.sqrt(squared / input.length + 1e-6);
  return Float32Array.from(input, (value, i) => value * divisor * scale[i]);
}

function residual(input: Float32Array, update: Float32Array): Float32Array {
  for (let i = 0; i < input.length; i++) input[i] += update[i];
  return input;
}

type Cache = { keys: Float32Array; values: Float32Array };

function decodePoint(model: ContourModel, previous: ContourPoint, kind: ContourKind, style: readonly number[], position: number, caches: Cache[]): ContourPoint {
  const { width: WIDTH, heads: HEADS, points: POINTS, input: INPUT, layers: LAYERS, ffn: FFN } = model.metadata.architecture;
  const HEAD_WIDTH = WIDTH / HEADS;
  const input = new Float32Array(INPUT);
  input.set(previous);
  input[2 + model.metadata.shapes.indexOf(kind)] = 1;
  input.set(style, 2 + model.metadata.shapes.length);
  let hidden = linear(input, weight(model, 'input.weight', WIDTH * INPUT), WIDTH, weight(model, 'input.bias', WIDTH));
  const positions = weight(model, 'position.weight', POINTS * WIDTH);
  for (let i = 0; i < WIDTH; i++) hidden[i] += positions[position * WIDTH + i];
  for (let layer = 0; layer < LAYERS; layer++) {
    const prefix = `blocks.${layer}.`;
    const normalized = rms(hidden, weight(model, prefix + 'attention_norm.weight', WIDTH));
    const qkv = linear(normalized, weight(model, prefix + 'qkv.weight', WIDTH * WIDTH * 3), WIDTH * 3);
    const cache = caches[layer];
    cache.keys.set(qkv.subarray(WIDTH, WIDTH * 2), position * WIDTH);
    cache.values.set(qkv.subarray(WIDTH * 2), position * WIDTH);
    const attended = new Float32Array(WIDTH);
    for (let head = 0; head < HEADS; head++) {
      const headStart = head * HEAD_WIDTH;
      const scores = new Float32Array(position + 1);
      let maximum = -Infinity;
      for (let token = 0; token <= position; token++) {
        let score = 0;
        for (let d = 0; d < HEAD_WIDTH; d++) score += qkv[headStart + d] * cache.keys[token * WIDTH + headStart + d];
        scores[token] = score / Math.sqrt(HEAD_WIDTH);
        maximum = Math.max(maximum, scores[token]);
      }
      let total = 0;
      for (let token = 0; token <= position; token++) total += scores[token] = Math.exp(scores[token] - maximum);
      for (let token = 0; token <= position; token++) {
        const probability = scores[token] / total;
        for (let d = 0; d < HEAD_WIDTH; d++) attended[headStart + d] += probability * cache.values[token * WIDTH + headStart + d];
      }
    }
    hidden = residual(hidden, linear(attended, weight(model, prefix + 'attention_out.weight', WIDTH * WIDTH), WIDTH));
    const feedforward = rms(hidden, weight(model, prefix + 'feedforward_norm.weight', WIDTH));
    const gate = linear(feedforward, weight(model, prefix + 'gate.weight', WIDTH * FFN), FFN);
    const up = linear(feedforward, weight(model, prefix + 'up.weight', WIDTH * FFN), FFN);
    for (let i = 0; i < FFN; i++) gate[i] = (gate[i] / (1 + Math.exp(-gate[i]))) * up[i];
    hidden = residual(hidden, linear(gate, weight(model, prefix + 'down.weight', WIDTH * FFN), WIDTH));
  }
  const result = linear(rms(hidden, weight(model, 'norm.weight', WIDTH)), weight(model, 'output.weight', WIDTH * 2), 2, weight(model, 'output.bias', 2));
  return [Math.tanh(result[0]), Math.tanh(result[1])];
}

/** Four seed values condition the learned shape prior; no path is retrieved. */
export function contourStyle(seed: number): [number, number, number, number] {
  let state = (seed | 0) || 0x6a09e667;
  const sample = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0xffffffff * 2 - 1;
  };
  return [sample(), sample(), sample(), sample()];
}

export async function generateContourFromStyle(model: ContourModel, kind: ContourKind, style: readonly number[], signal?: AbortSignal, yieldWork = true): Promise<{ points: ContourPoint[]; closed: boolean }> {
  if (!model.metadata.shapes.includes(kind) || style.length !== 4 || Array.from(style).some(value => !Number.isFinite(value) || value < -1 || value > 1)) {
    throw new Error('Invalid contour generation conditions');
  }
  const { points: POINTS, width: WIDTH, layers: LAYERS } = model.metadata.architecture;
  const caches: Cache[] = Array.from({ length: LAYERS }, () => ({ keys: new Float32Array(POINTS * WIDTH), values: new Float32Array(POINTS * WIDTH) }));
  const points: ContourPoint[] = [];
  let previous: ContourPoint = [0, 0];
  for (let position = 0; position < POINTS; position++) {
    assertNotAborted(signal);
    previous = decodePoint(model, previous, kind, style, position, caches);
    points.push(previous);
    if (yieldWork && position % 8 === 7) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assertNotAborted(signal);
  return { points, closed: model.metadata.closed?.[model.metadata.shapes.indexOf(kind)] ?? (kind === 'leaf' || kind === 'flower') };
}

export function generateContour(model: ContourModel, kind: ContourKind, seed: number, signal?: AbortSignal): Promise<{ points: ContourPoint[]; closed: boolean }> {
  if (!Number.isSafeInteger(seed)) return Promise.reject(new Error('Invalid contour seed'));
  return generateContourFromStyle(model, kind, contourStyle(seed), signal);
}
