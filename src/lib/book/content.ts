import { retrieveFacts, validateFactPack, type FactPack, type WatchFact } from '../watch/facts.ts';
import type { LanguageMode } from '../watch/types.ts';

export interface BookSource { title: string; url: string }
export interface BookThought { text: string; sources: BookSource[]; reviewed: boolean; fact?: WatchFact }
const defaults: Record<LanguageMode, { sentences: string[]; source: BookSource }> = {
  ai: { sentences: [
    'Attention compares a query with keys, weighting values to build a context-dependent representation.',
    'The original Transformer used attention instead of recurrence to model relationships across a sequence.',
    'Multi-head attention lets different learned projections attend to different relationships in the same sequence.',
  ], source: { title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' } },
  profile: { sentences: [
    'Daniil Emtsev is an AI research engineer based in Zurich, Switzerland.',
    'Daniil builds computer vision and language-model systems that support surgical training at VirtaMed.',
    'Daniil completed a master’s in Computational Science and Engineering at ETH Zurich, focusing on robotics.',
  ], source: { title: 'Daniil’s public portfolio and CV', url: '/#about' } },
  wellbeing: { sentences: [
    'Even a little physical activity contributes more than none, according to WHO guidance.',
    'Walking, cycling and everyday movement all count as physical activity in WHO guidance.',
    'WHO recommends limiting sedentary time; small opportunities for movement can fit into everyday life.',
  ], source: { title: 'WHO: physical activity', url: 'https://www.who.int/news-room/fact-sheets/detail/physical-activity' } },
};

/** The watch and book use the same reviewed public modes and source pack. */
export async function loadBookFacts(signal: AbortSignal): Promise<FactPack> {
  const response = await fetch('/watch/facts.v1.json', { signal });
  if (!response.ok) throw new Error('Book facts are unavailable');
  return validateFactPack(await response.json());
}
export function reviewedThought(mode: LanguageMode, offset = 0, pack?: FactPack): BookThought {
  const fact = pack && retrieveFacts(pack, mode, '', offset)[0];
  if (fact) return { text: fact.answer, sources: [{ title: fact.sourceTitle, url: fact.sourceUrl }], reviewed: true, fact };
  const fallback = defaults[mode];
  const text = fallback.sentences[Math.abs(offset) % fallback.sentences.length];
  const source = mode === 'profile' && Math.abs(offset) % fallback.sentences.length === 2
    ? { title: 'Daniil’s public journey', url: '/#journey' } : fallback.source;
  return { text, sources: [source], reviewed: true };
}
