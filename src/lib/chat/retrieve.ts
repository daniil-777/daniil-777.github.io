/**
 * From scores to the chunks an answer is built from: ranking, the optional
 * semantic tier, confidence (which only ever changes wording), follow-up
 * questions and the fixed replies for private topics.
 */
import { STOP, editDistance, stem, tokenise, type SearchResult } from './bm25.ts';
import { EMBED } from './embed.ts';
import type { Chunk } from './kb.ts';
import { normalise } from './text.ts';
import { scopedPortfolioOwner } from './intent.ts';

export const TOP_K = 5;
/** Share of the semantic score in the fused ranking. */
export const DENSE_WEIGHT = 0.7;
/** Below this coverage the answer is worded as "closest passages". */
export const LOW_COVERAGE = 0.5;
/**
 * When the keywords find nothing, a semantic match at least this similar is
 * still shown, as a "closest passage". Similarity never makes an answer
 * confident: on this site's questions no value separates a right match from
 * an unrelated one (`npm run eval:chat` prints both).
 */
export const DENSE_CLOSEST = 0.3;

export type Confidence = 'ok' | 'low' | 'none';

/** Dot product of a query embedding with every row of the int8 matrix. */
export function denseScores(query: Float32Array, vectors: Int8Array, count: number, dim: number): Float32Array {
  const scores = new Float32Array(count);
  for (let row = 0; row < count; row++) {
    let sum = 0;
    const offset = row * dim;
    for (let i = 0; i < dim; i++) sum += query[i] * vectors[offset + i];
    scores[row] = sum;
  }
  return scores;
}

function minmax(values: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  return values.map((value) => (range > 0 ? (value - min) / range : 0));
}

export function fuse(bm25: Float32Array, dense: Float32Array): Float32Array {
  const a = minmax(dense);
  const b = minmax(bm25);
  return a.map((value, i) => DENSE_WEIGHT * value + (1 - DENSE_WEIGHT) * b[i]);
}

/** Indices of the best chunks, best first; ties keep the order of the knowledge base. */
export function topK(scores: Float32Array, k: number = TOP_K): number[] {
  return [...scores.keys()]
    .filter((i) => scores[i] > 0)
    .sort((a, b) => scores[b] - scores[a] || a - b)
    .slice(0, k);
}

/** How sure the keywords are. It only ever changes the wording of an answer. */
export function confidence(result: Pick<SearchResult, 'scores' | 'coverage' | 'oov' | 'anchored'>): Confidence {
  if (!result.scores.some((score) => score > 0)) return 'none';
  // A word the site never uses, or a single word found somewhere in a text: passages, not an answer.
  return result.coverage < LOW_COVERAGE || result.oov > 0 || !result.anchored ? 'low' : 'ok';
}

/**
 * The final ranking of one question: keyword scores alone, or fused with the
 * semantic scores (`similar`, one dot product per chunk) when that tier is
 * loaded. The semantic tier changes which passages are shown, and lets a
 * question no keyword matches still show its closest passages.
 */
export function ranking(result: Pick<SearchResult, 'scores' | 'coverage' | 'oov' | 'anchored'>, similar?: Float32Array): { scores: Float32Array; top: number[]; level: Confidence } {
  const level = confidence(result);
  if (!similar) return { scores: result.scores, top: topK(result.scores), level };
  const scores = fuse(result.scores, similar);
  const top = topK(scores);
  if (level !== 'none') return { scores, top, level };
  // The vectors are int8 at a fixed scale; this turns the dot product back into a cosine.
  const cosine = top.length ? (similar[top[0]] * EMBED.scale) / 127 : 0;
  return cosine >= DENSE_CLOSEST ? { scores, top, level: 'low' } : { scores, top: [], level };
}

const PRONOUNS = new Set(['it', 'its', 'they', 'them', 'that', 'this', 'there', 'he', 'his']);

/** Words of the subjects a question can name: project titles and the organisations of the journey. */
export function subjectTerms(chunks: Chunk[]): Set<string> {
  const terms = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.kind === 'project') for (const term of tokenise(chunk.title)) terms.add(term);
    if (chunk.kind === 'journey') for (const term of tokenise(chunk.heading)) terms.add(term);
  }
  return terms;
}

/**
 * The retrieval query for a follow-up such as "What was its result?": the
 * question plus the content words of the previous one and the title last
 * cited. Only retrieval sees this; the visitor's own words are what is shown
 * and sent to a model.
 */
export function contextualise(question: string, history: { previousQuestion?: string; lastCitedTitle?: string }, subjects: Set<string>): string {
  if (!history.previousQuestion && !history.lastCitedTitle) return question;
  const terms = tokenise(question);
  const hasPronoun = normalise(question).split(/[^a-z0-9]+/).some((word) => PRONOUNS.has(word));
  const namesSubject = terms.some((term) => subjects.has(term));
  if (terms.length >= 3 && !(hasPronoun && !namesSubject)) return question;
  const previous = normalise(history.previousQuestion ?? '')
    .split(/[^a-z0-9+#]+/)
    .filter((word) => word && !STOP.has(word));
  return [question, previous.join(' '), history.lastCitedTitle ?? ''].filter(Boolean).join(' ');
}

/** Words that make a question one about Daniil himself. */
const PERSON = new Set(['he', 'him', 'his', 'himself', 'daniil', 'emtsev', 'you', 'your', 'yours']);
/** From this length a trigger word also matches with one typo ("adress"). */
export const TRIGGER_TYPO_MIN = 6;

const plain = (text: string) => normalise(text).replace(/[’']s\b/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const content = (word: string) => (word.length >= 2 || /\d/.test(word)) && !STOP.has(word);

/** The same word: equal stems ("earns", "earn"), or one typo apart in a word long enough to tell. */
function same(asked: string, wanted: string): boolean {
  if (stem(asked) === stem(wanted)) return true;
  return wanted.length >= TRIGGER_TYPO_MIN && asked[0] === wanted[0] && Math.abs(asked.length - wanted.length) <= 1 && editDistance(asked, wanted) === 1;
}

/**
 * The fact one of whose trigger phrases occurs in the question, word for word
 * and in order. It is the answer in every mode, with no model call and no
 * network request. A trigger only fires when the question is about Daniil
 * ("his references") or about nothing else ("phone number?"): "Which references
 * does the paper cite?" is a question about the work.
 */
export function matchTrigger(question: string, chunks: Chunk[]): Chunk | undefined {
  const asked = plain(question);
  const personal = asked.some((word) => PERSON.has(word)) || scopedPortfolioOwner(question);
  const fires = (trigger: string) => {
    const wanted = plain(trigger);
    if (wanted.length === 0) return false;
    for (let at = 0; at + wanted.length <= asked.length; at++) {
      if (!wanted.every((word, i) => same(asked[at + i], word))) continue;
      if (personal || !asked.some((word, i) => (i < at || i >= at + wanted.length) && content(word))) return true;
    }
    return false;
  };
  return chunks.find((chunk) => chunk.kind === 'fact' && chunk.triggers?.some(fires));
}
