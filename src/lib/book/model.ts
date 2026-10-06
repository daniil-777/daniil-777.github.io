import type { Generator } from '../chat/types.ts';
import { MODES } from '../watch/facts.ts';
import type { LanguageMode } from '../watch/types.ts';
import type { Chunk, Kb } from '../chat/kb.ts';
import { buildIndex, search } from '../chat/bm25.ts';

export const BOOK_TOPICS = MODES;
export type BookTopic = LanguageMode;
export type BookModelMode = 'cloud' | 'device' | 'quotes';
export type BookProgress = (loaded: number, total: number) => void;
export interface BookModel { generator: Generator; label: string; dispose(): void }
export type BookModelChoice =
  | { kind: 'ready'; model: BookModel }
  | { kind: 'download'; load(progress: BookProgress, signal: AbortSignal): Promise<BookModel>; dispose(): void }
  | { kind: 'unavailable' };

const themes: Record<BookTopic, { subject: string; images: string[] }> = {
  ai: { subject: 'an accessible idea in artificial intelligence', images: ['attention in transformers', 'learning from examples', 'computer vision'] },
  profile: { subject: 'Daniil Emtsev’s documented work and interests', images: ['his work at VirtaMed', 'his research at ETH Zurich', 'his interest in hiking'] },
  wellbeing: { subject: 'everyday wellbeing, rest, gentle movement or kindness', images: ['a quiet walk', 'a moment of rest', 'a little kindness'] },
};

/** Generic creative prose keeps the existing assistant on its genuine LLM path. */
export function bookPrompt(topic: BookTopic, variation = 0, context = ''): string {
  const theme = themes[topic];
  const image = theme.images[Math.abs(Math.floor(variation)) % theme.images.length];
  const grounding = topic === 'profile' ? 'Describe Daniil in the third person using only the supplied public portfolio facts, and cite the supporting source IDs as usual.' : topic === 'wellbeing' ? 'Offer a calm everyday reflection; do not make diagnoses, treatment recommendations or promises about health.' : 'Explain the idea accurately in simple, thoughtful language.';
  return `Write one concise, thoughtful sentence about ${theme.subject}, focusing on ${context || image}. ${grounding} Use between 14 and 26 words and no more than 260 characters, excluding source IDs. Write exactly one complete sentence with a final period, no title, list, quotation marks or preamble. Return only the sentence${topic === 'profile' ? ' with its source IDs' : ''}.`;
}

export function defaultBookModel(): BookModelMode {
  return 'device';
}

let knowledge: Kb | undefined;
/** Local inference sees the same public grounding as Ask AI; citation guards remain active. */
export async function bookEvidence(question: string, signal: AbortSignal, subject?: string) {
  if (!knowledge) {
    const response = await fetch('/chat/kb.json', { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw new Error('Portfolio evidence is unavailable');
    const kb = await response.json() as Kb;
    if (kb.v !== 1 || !Array.isArray(kb.chunks) || !kb.chunks.length) throw new Error('Invalid portfolio evidence');
    knowledge = kb;
  }
  signal.throwIfAborted();
  const query = subject ? `${subject} Daniil Emtsev` : question;
  const index = buildIndex(knowledge.chunks);
  const retrieve = (text: string) => {
    const { scores } = search(index, text);
    return [...scores.keys()].filter(i => scores[i] > 0)
      .sort((a, b) => scores[b] - scores[a] || a - b).slice(0, 5).map(i => knowledge!.chunks[i]);
  };
  const focused = retrieve(query);
  return { chunks: focused.length ? focused : retrieve(question), byId: new Map<string, Chunk>(knowledge.chunks.map(chunk => [chunk.id, chunk])) };
}

/** A page always holds one complete, bounded inscription; output is inserted as text. */
export function cleanBookSentence(raw: string): string | undefined {
  const text = raw.trim().replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ');
  const punctuation = text.match(/[.!?](?!\d)/g) ?? [];
  if (text.length > 260 || text.split(/\s+/).length < 6 || punctuation.length !== 1 || !/[.!?]$/.test(text)) return;
  if (/https?:\/\/|\[\[|[<>\u0000-\u001f\u007f]/.test(text)) return;
  return text;
}

/** Called after Write with AI. An available built-in model needs no download. */
export async function prepareBookModel(signal: AbortSignal, _mode?: BookModelMode): Promise<BookModelChoice> {
  signal.throwIfAborted();
  const { probeBookDevice, createBookBuiltin, createBookWebgpu } = await import('./local-device.ts');
  const offer = await probeBookDevice(signal);
  signal.throwIfAborted();
  if (offer.builtin) {
    const local = createBookBuiltin();
    return { kind: 'ready', model: { ...local, label: 'On-device AI' } };
  }
  if (!offer.webgpu) return { kind: 'unavailable' };
  const webgpu = createBookWebgpu();
  return {
    kind: 'download', dispose: webgpu.dispose,
    async load(progress, stop) {
      await webgpu.load(progress, stop);
      stop.throwIfAborted();
      return { generator: webgpu.generator, label: 'On-device AI', dispose: webgpu.dispose };
    },
  };
}
