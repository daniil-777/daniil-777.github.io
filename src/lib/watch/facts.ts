import type { LanguageMode, WatchKnowledgeDomain } from './types.ts';

export interface WatchFact {
  id: string; mode: LanguageMode; topic: string; text: string; answer: string;
  sourceId: string; sourceTitle: string; sourceUrl: string; sourceDate: string;
  reviewedAt: string; freshnessPolicy: string; rights: string;
  publicAllowed: true; reviewStatus: 'reviewed';
  domain?: Exclude<WatchKnowledgeDomain, 'all'>;
}
export interface FactPack { version: string; asOf: string; language: 'en'; facts: WatchFact[] }
export const MODES: LanguageMode[] = ['ai', 'profile', 'wellbeing'];
export const KNOWLEDGE_DOMAINS: WatchKnowledgeDomain[] = ['all', 'math', 'ai', 'finance', 'robotics', 'vision', 'healthcare', 'science', 'security'];
const normalize = (text: string) => text.normalize('NFKC').replace(/[’]/g, "'").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const stop = new Set(['the', 'a', 'an', 'is', 'are', 'in', 'on', 'at', 'of', 'to', 'and', 'or', 'for', 'what', 'how', 'does', 'do', 'me', 'tell', 'about', 'please', 'can', 'you', 'my', 'his', 'it', 'with']);
const tokens = (text: string) => normalize(text).split(' ').filter(token => token.length > 2 && !stop.has(token));

/** Narrow public wellbeing scope. This finite guard is supplementary to the reviewed output allowlist. */
export function wellbeingNeedsHelp(question: string): boolean {
  return /\b(?:symptoms?|diagnos\w*|medications?|medicines?|pills?|tablets?|drugs?|doses?|dosage|prescrib\w*|suicid\w*|overdos\w*|emergenc\w*|pregnan\w*|bleeding|seizures?|antidepressants?|pain|hurts?|fever|vomit\w*|dizziness)\b|hurt myself|harm myself|kill myself|end my life|chest pain|can t breathe|cannot breathe/i.test(normalize(question));
}

export function validateFactPack(value: unknown): FactPack {
  const pack = value as FactPack;
  if (!pack || typeof pack.version !== 'string' || !Array.isArray(pack.facts) || pack.facts.length > 500 || pack.language !== 'en') throw new Error('Invalid public fact pack');
  const ids = new Set<string>();
  for (const fact of pack.facts) {
    if (!fact || !MODES.includes(fact.mode) || fact.publicAllowed !== true || fact.reviewStatus !== 'reviewed' || ids.has(fact.id)) throw new Error('Unreviewed or duplicate watch fact');
    if (fact.domain !== undefined && !KNOWLEDGE_DOMAINS.slice(1).includes(fact.domain)) throw new Error('Invalid knowledge field');
    if (![fact.id, fact.topic, fact.text, fact.answer, fact.sourceTitle, fact.sourceDate, fact.reviewedAt, fact.rights].every(x => typeof x === 'string' && x.length > 0 && x.length <= 1000)) throw new Error('Invalid fact metadata');
    const source = new URL(fact.sourceUrl);
    if (source.protocol !== 'https:' || source.username || source.password || !validateSentence(fact.answer, [fact])) throw new Error('Invalid fact source or sentence');
    ids.add(fact.id);
  }
  if (!MODES.every(mode => pack.facts.some(fact => fact.mode === mode))) throw new Error('Missing watch mode');
  return pack;
}

/** Conservative release validator: only reviewed equivalences are published.
 * This is an explicit output gate, never a claim that lexical similarity proves truth. */
export function validateSentence(text: string, facts: Pick<WatchFact, 'answer'>[]): boolean {
  if (typeof text !== 'string' || text.length > 260 || /[\n<>]/.test(text)) return false;
  const words = text.trim().split(/\s+/).length;
  if (words < 10 || words > 20 || !/[.!?]$/.test(text.trim())) return false;
  if (/\b(?:diagnos\w*|dosage|milligrams?|cure[sd]?|suicid\w*|guarantee[sd]?)\b/i.test(text)) return false;
  return facts.some(fact => normalize(fact.answer) === normalize(text));
}

/** Empty queries rotate reviewed facts. Questions must match at least one actual source topic. */
export function retrieveFacts(pack: FactPack, mode: LanguageMode, question = '', offset = 0, domain: WatchKnowledgeDomain = 'all'): WatchFact[] {
  const candidates = pack.facts.filter(fact => fact.mode === mode && (mode !== 'ai' || domain === 'all' || (fact.domain ?? 'ai') === domain));
  if (!candidates.length) return [];
  if (!question.trim()) return [candidates[((offset % candidates.length) + candidates.length) % candidates.length]];
  if (mode === 'wellbeing' && wellbeingNeedsHelp(question)) return [];
  if (question.length > 160 || /\b(?:ignore|system prompt|pretend|diagnose|dosage|suicide|medication|prescribe)\b/i.test(question)) return [];
  const query = [...new Set(tokens(question))];
  if (!query.length) return [];
  const ranked = candidates.map(fact => {
    const topic = new Set(tokens(fact.topic));
    const body = new Set(tokens(fact.text));
    const score = query.reduce((sum, word) => sum + (topic.has(word) ? 3 : body.has(word) ? 1 : 0), 0);
    return { fact, score };
  }).filter(row => row.score >= 2).sort((a, b) => b.score - a.score);
  return ranked.slice(0, 2).map(row => row.fact);
}

export function makeSourceLink(fact: WatchFact): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = fact.sourceUrl; link.textContent = fact.sourceTitle;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
