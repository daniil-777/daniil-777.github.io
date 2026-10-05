import type { GenerationRequest } from './protocol.ts';

export const RESERVED = ['<pad>', '<bos>', '<eos>', '<ai>', '<profile>', '<wellbeing>', '<facts>', '<question>', '<answer>'] as const;
export interface ByteBpeData {
  schemaVersion: 1;
  vocabularySize: 4096;
  reserved: string[];
  merges: [number, number][];
  trainedSplit: 'train';
}
/** Byte BPE with whitespace boundaries; exactly shared with the offline Python implementation. */
export class ByteBpeTokenizer {
  readonly eos = 2;
  readonly bytes: number[][];
  private ranks = new Map<string, number>();
  readonly data: ByteBpeData;
  constructor(data: ByteBpeData) {
    this.data = data;
    if (data.schemaVersion !== 1 || data.vocabularySize !== 4096 || data.trainedSplit !== 'train' || JSON.stringify(data.reserved) !== JSON.stringify(RESERVED)) throw new Error('Unsupported tokenizer');
    this.bytes = RESERVED.map(() => []);
    for (let b = 0; b < 256; b++) this.bytes.push([b]);
    for (const [a, b] of data.merges) {
      if (!this.bytes[a]?.length || !this.bytes[b]?.length || this.bytes.length >= 4096) throw new Error('Invalid BPE merge');
      this.ranks.set(`${a},${b}`, this.bytes.length);
      this.bytes.push([...this.bytes[a], ...this.bytes[b]]);
    }
  }
  encode(text: string): number[] {
    const result: number[] = [];
    for (const piece of text.match(/\s+|\S+/gu) ?? []) {
      let ids = Array.from(new TextEncoder().encode(piece), b => b + RESERVED.length);
      while (ids.length > 1) {
        let index = -1, best = Infinity;
        for (let i = 0; i < ids.length - 1; i++) {
          const rank = this.ranks.get(`${ids[i]},${ids[i + 1]}`);
          if (rank !== undefined && rank < best) { best = rank; index = i; }
        }
        if (index < 0) break;
        ids = [...ids.slice(0, index), best, ...ids.slice(index + 2)];
      }
      result.push(...ids);
    }
    return result;
  }
  decode(ids: readonly number[]): string {
    return new TextDecoder().decode(new Uint8Array(ids.flatMap(id => this.bytes[id] ?? [])));
  }
  /** Whole facts only, with a guaranteed output reservation and no growing history. */
  prompt(request: GenerationRequest): { ids: number[]; includedFactIds: string[] } {
    if (!Number.isFinite(request.maxNewTokens)) throw new Error('Invalid token budget');
    const max = Math.min(64, Math.max(1, Math.floor(request.maxNewTokens)));
    const limit = 256 - max;
    const mode = RESERVED.indexOf(`<${request.mode}>` as typeof RESERVED[number]);
    if (mode < 3 || mode > 5) throw new Error('Invalid language mode');
    const question = this.encode((request.question ?? '').slice(0, 240));
    if (question.length > 64) throw new Error('Question exceeds the compact model budget');
    const ids = [1, mode, 6];
    const includedFactIds: string[] = [];
    for (const fact of request.facts) {
      if (!request.factIds.includes(fact.id)) continue;
      const encoded = this.encode(`${fact.text}\n`);
      if (ids.length + encoded.length + question.length + 2 > limit) continue;
      ids.push(...encoded); includedFactIds.push(fact.id);
    }
    ids.push(7, ...question, 8);
    if (ids.length > limit) throw new Error('Context budget exceeded');
    return { ids, includedFactIds };
  }
}
