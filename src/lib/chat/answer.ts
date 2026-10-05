/**
 * Quotes mode: an answer made only of the site's own sentences. No model is
 * involved; it is also what every other mode falls back to.
 */
import { COPY, SUGGESTED } from '../../data/chat.ts';
import { search, tokenise, type Index, type QueryTerm } from './bm25.ts';
import type { Chunk, Kb } from './kb.ts';
import { confidence as rate, matchTrigger, topK, type Confidence } from './retrieve.ts';
import { displayTitle, looksForeign, sentences, words } from './text.ts';

export interface Passage {
  chunkId: string;
  text: string;
  url: string;
  label: string;
}

export interface Answer {
  kind: 'declined' | 'faq' | 'list' | 'quote' | 'closest' | 'none';
  /** Fixed wording, or the body of a fact. */
  lead: string;
  passages: Passage[];
  followUps: string[];
  confidence: Confidence;
}

/** What retrieval hands to the composer. */
export interface Ranked {
  /** Indices into `kb.chunks`, best first. */
  top: number[];
  /** The score of every chunk, as ranked. */
  scores: Float32Array;
  terms: QueryTerm[];
  index: Index;
}

export const PASSAGES_MAX = 3;
export const PER_PAGE_MAX = 2;
export const PASSAGE_WORDS_MAX = 60;
export const FOLLOW_UPS_MAX = 3;
/** A further passage is shown only if it scores at least this share of the best one. */
export const RELATED_SHARE = 0.6;
/** … and only if it holds a word of the question at least this specific, relative to the question's most specific word. */
export const RELATED_IDF = 0.7;

const page = (url: string) => url.split('#')[0];

/** A link that scrolls to the quoted sentence in browsers that support text fragments. */
function quoteUrl(url: string, quote: string): string {
  const start = words(quote).slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '');
  return `${url}${url.includes('#') ? '' : '#'}:~:text=${encodeURIComponent(start).replace(/-/g, '%2D')}`;
}

/** The one or two neighbouring sentences of a chunk that say most about the question. */
export function bestSentences(text: string, terms: QueryTerm[]): string {
  const all = sentences(text);
  const scored = all.map((sentence) => {
    const present = new Set(tokenise(sentence));
    return terms.filter((t) => t.matches.some((m) => present.has(m))).reduce((sum, t) => sum + t.idf, 0);
  });
  let best = 0;
  for (let i = 1; i < all.length; i++) if (scored[i] > scored[best]) best = i;
  const count = (i: number) => words(all[i]).length;
  let picked = all[best] ?? '';
  const neighbour = [best + 1, best - 1]
    .filter((i) => i >= 0 && i < all.length && count(i) + count(best) <= PASSAGE_WORDS_MAX)
    .sort((a, b) => scored[b] - scored[a])[0];
  if (neighbour !== undefined && (scored[neighbour] > 0 || count(best) < 8)) {
    picked = neighbour > best ? `${picked} ${all[neighbour]}` : `${all[neighbour]} ${picked}`;
  }
  const list = words(picked);
  return list.length > PASSAGE_WORDS_MAX ? `${list.slice(0, PASSAGE_WORDS_MAX).join(' ')}…` : picked;
}

/**
 * At most two chunks per page and three in all, in rank order. A further
 * passage must score close to the first and hold one of the question's more
 * specific words: sharing "work" with the question is not being about it.
 */
function pick(top: number[], ranked: Ranked, chunks: Chunk[]): Chunk[] {
  const { scores, terms, index } = ranked;
  const holds = (i: number, term: QueryTerm) => term.matches.some((match) => index.postings.get(match)!.some(([doc]) => doc === i));
  const specific = RELATED_IDF * Math.max(0, ...terms.filter((term) => term.matches.length > 0).map((term) => term.idf));
  const perPage = new Map<string, number>();
  const picked: Chunk[] = [];
  for (const i of top) {
    // A fact answers its own question; next to another answer it is only a text that shares a word.
    if (picked.length > 0 && (chunks[i].kind === 'fact' || scores[i] < RELATED_SHARE * scores[top[0]] || !terms.some((term) => term.idf >= specific && holds(i, term)))) continue;
    const key = page(chunks[i].url);
    const used = perPage.get(key) ?? 0;
    if (used >= PER_PAGE_MAX) continue;
    perPage.set(key, used + 1);
    picked.push(chunks[i]);
    if (picked.length === PASSAGES_MAX) break;
  }
  return picked;
}

/** Facts, roll-ups and the short lists of the About section ("Awards and honours") are quoted whole. */
const whole = (chunk: Chunk) => chunk.kind === 'fact' || chunk.kind === 'rollup' || (chunk.kind === 'site' && chunk.heading !== '');

function passage(chunk: Chunk, terms: QueryTerm[]): Passage {
  const text = whole(chunk) ? chunk.text : bestSentences(chunk.text, terms);
  return { chunkId: chunk.id, text, url: whole(chunk) ? chunk.url : quoteUrl(chunk.url, text), label: displayTitle(chunk) };
}

/**
 * Is this fact the answer to the question, rather than a text that shares a
 * word with it? Every word of the question must be one the fact's own
 * question or `asks` use. "Was the patent granted?" is not a question about
 * scholarships, whatever word they share.
 */
export function direct(fact: Chunk, terms: QueryTerm[]): boolean {
  const asks = new Set(tokenise(fact.asks.join(' ')));
  return fact.kind === 'fact' && terms.length > 0 && terms.every((term) => term.matches.some((match) => asks.has(match)));
}

function answerable(question: string, index: Index): boolean {
  return rate(search(index, question)) === 'ok';
}

/** Up to three questions that lead on from the cited chunks and that the site can answer. */
export function followUps(cited: Chunk[], index: Index, asked: string[] = []): string[] {
  const candidates: string[] = [];
  for (const chunk of cited) {
    if (chunk.kind === 'project' || chunk.kind === 'section' || chunk.kind === 'media') {
      candidates.push(`What is the stack of ${chunk.title}?`, `What was the result of ${chunk.title}?`);
    } else if (chunk.kind === 'journey') {
      candidates.push(`Which projects came out of ${chunk.heading}?`);
    } else if (chunk.kind === 'publication') {
      candidates.push(`What is ${chunk.heading} about?`);
    }
  }
  candidates.push(...SUGGESTED);
  const seen = new Set(asked.map((q) => q.trim().toLowerCase()));
  const out: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key) || !answerable(candidate, index)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length === FOLLOW_UPS_MAX) break;
  }
  return out;
}

/** A question the site's sentences cannot answer with a yes or a no. */
const YES_NO = /^\s*(?:is|are|was|were|does|do|did|has|have|had|can|could|will|would|should)\b/i;

/** The quotes answer. Rules in order; the first that applies wins. */
export function composeExtractive(question: string, ranked: Ranked, confidence: Confidence, kb: Pick<Kb, 'chunks'>, asked: string[] = []): Answer {
  const { chunks } = kb;
  const done = (kind: Answer['kind'], lead: string, cited: Chunk[], passages: Passage[], level: Confidence = confidence): Answer => ({
    kind,
    lead,
    passages,
    followUps: kind === 'declined' || kind === 'none' ? [] : followUps(cited, ranked.index, [question, ...asked]),
    confidence: level,
  });

  const triggered = matchTrigger(question, chunks);
  if (triggered) return done(triggered.sensitive ? 'declined' : 'faq', triggered.text, [triggered], [passage(triggered, [])], 'ok');

  // A fixed reply for a private topic is an answer or nothing: never a passage next to another answer.
  const top = ranked.top.filter((i, rank) => !chunks[i].sensitive || (rank === 0 && direct(chunks[i], ranked.terms)));
  if (confidence === 'none' || top.length === 0) return done('none', looksForeign(question) ? COPY.lead.englishOnly : COPY.lead.none, [], [], 'none');

  const first = chunks[top[0]];
  if (direct(first, ranked.terms)) {
    const cited = pick(top, ranked, chunks);
    return done(first.sensitive ? 'declined' : 'faq', first.text, cited, cited.map((chunk) => passage(chunk, ranked.terms)), 'ok');
  }
  if (confidence === 'ok' && first.kind === 'rollup') return done('list', COPY.lead.list, [first], [passage(first, ranked.terms)]);

  const cited = pick(top, ranked, chunks);
  const passages = cited.map((chunk) => passage(chunk, ranked.terms));
  if (confidence !== 'ok') return done('closest', COPY.lead.closest, cited, passages);
  // Quoted sentences can mention what a yes-or-no question asks about; they cannot say yes or no.
  return YES_NO.test(question) ? done('closest', COPY.lead.mentions, cited, passages) : done('quote', COPY.lead.quote, cited, passages);
}

/** The whole quotes pipeline for one question: fixed replies, keyword search, confidence, wording. */
export function answerQuestion(question: string, kb: Pick<Kb, 'chunks'>, index: Index, retrievalQuery: string = question, asked: string[] = []): Answer {
  const result = search(index, retrievalQuery);
  const ranked: Ranked = { top: topK(result.scores), scores: result.scores, terms: result.terms, index };
  return composeExtractive(question, ranked, rate(result), kb, asked);
}
