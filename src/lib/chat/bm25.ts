/**
 * Keyword search over the knowledge base: BM25F with weighted fields.
 * The index is built in the browser when the chat opens; nothing is shipped
 * precomputed.
 */
import { stemmer } from 'stemmer';
import type { Chunk } from './kb.ts';
import { normalise } from './text.ts';

export const K1 = 1.2;
export const B = 0.75;
export const FIELD_WEIGHTS = { asks: 3, title: 2, heading: 2, tags: 1.5, text: 1 } as const;
/** In a section of a write-up the project's title is context, not the subject: the overview chunk owns it. */
export const CONTEXT_TITLE_WEIGHT = 0.5;
/** … and a question that names the project ("What is Pixel Morph?") is a question for that overview. */
export const SUBJECT_TITLE_WEIGHT = 6;
/** A query word the site does not use counts this much through each word that stands for it. */
export const EXPANSION_WEIGHT = 0.6;
export const EXPANSIONS_MAX = 3;
/** Shorter words have too many neighbours one letter away ("fire", "file", "five") to be corrected. */
export const TYPO_MIN = 5;
/** From this length any single edit counts as a typo; below it only two swapped letters do. */
export const TYPO_ANY_EDIT_MIN = 7;
/** Two stems are forms of one word if one begins with the other and the shorter has this many letters. */
export const VARIANT_MIN = 5;

/**
 * English function words, the words that only shape a question ("how many",
 * "before that", "does he know"), and the subject words every question shares.
 */
export const STOP = new Set(
  (
    'a an the and or of to in on at for with by from as is are was were be been am do does did has have had it its ' +
    'this that these those what which who whom whose when where why how can could would should will about into than ' +
    'then there any some tell me please show give list daniil emtsev he him his you your i my we our ' +
    'not no but so if also just only very too ever really right ok okay many much long often before after know like get got done anyone anything something site website'
  ).split(' '),
);

/** Porter stem of a word of four letters or more; shorter words and anything with a digit stay as they are. */
export const stem = (word: string): string => (/^[a-z]{4,}$/.test(word) ? stemmer(word) : word);

/** The words of a text that search uses: each as typed (`raw`) and as its stem (`term`). */
export function tokens(text: string): { raw: string; term: string }[] {
  const normal = normalise(text)
    .replace(/[’']s\b/g, '')
    .replace(/\p{Script=Han}+/gu, (run) => [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(run)].map((part) => part.segment).join(' '));
  return normal.split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && (t.length >= 2 || /\d/.test(t)) && !STOP.has(t))
    .map((raw) => ({ raw, term: stem(raw) }));
}

export const tokenise = (text: string): string[] => tokens(text).map((token) => token.term);

export interface Index {
  size: number;
  avglen: number;
  /** Weighted length of each chunk. */
  len: Float32Array;
  /** term → [chunk, weighted term frequency, 1 if the term is in the chunk's questions, title, heading or tags] triples. */
  postings: Map<string, [number, number, number][]>;
  idf: Map<string, number>;
  maxIdf: number;
  /** Every word of the site as written, with its stem: what a misspelt query word is compared with. */
  words: Map<string, string>;
}

export function buildIndex(chunks: Chunk[]): Index {
  const postings = new Map<string, [number, number, number][]>();
  const words = new Map<string, string>();
  const len = new Float32Array(chunks.length);
  chunks.forEach((chunk, doc) => {
    const context = chunk.kind === 'section' || chunk.kind === 'media' || chunk.kind === 'document';
    // Roll-ups repeat other chunks and fixed replies say what the site does not cover:
    // both are found by what they are about, not by their wording. Addresses are not words.
    const body = chunk.kind === 'rollup' || chunk.sensitive ? '' : chunk.text.replace(/https:\/\/\S+/g, ' ');
    const fields: [number, string][] = [
      [FIELD_WEIGHTS.asks, chunk.asks.join(' ')],
      [context ? CONTEXT_TITLE_WEIGHT : chunk.kind === 'project' ? SUBJECT_TITLE_WEIGHT : FIELD_WEIGHTS.title, chunk.title],
      [FIELD_WEIGHTS.heading, chunk.heading],
      [FIELD_WEIGHTS.tags, chunk.tags.join(' ')],
      [FIELD_WEIGHTS.text, body],
    ];
    const wtf = new Map<string, number>();
    const named = new Set<string>();
    fields.forEach(([weight, value], field) => {
      const found = tokens(value);
      len[doc] += weight * found.length;
      for (const { raw, term } of found) {
        wtf.set(term, (wtf.get(term) ?? 0) + weight);
        words.set(raw, term);
        // The last field is the running text; a word in any other names what the chunk is about.
        if (field < fields.length - 1) named.add(term);
      }
    });
    for (const [term, value] of wtf) {
      const entry: [number, number, number] = [doc, value, named.has(term) ? 1 : 0];
      const posting = postings.get(term);
      if (posting) posting.push(entry);
      else postings.set(term, [entry]);
    }
  });
  const size = chunks.length;
  const idf = new Map<string, number>();
  for (const [term, posting] of postings) idf.set(term, Math.log(1 + (size - posting.length + 0.5) / (posting.length + 0.5)));
  return {
    size,
    avglen: size ? len.reduce((sum, value) => sum + value, 0) / size : 0,
    len,
    postings,
    idf,
    maxIdf: Math.log(1 + (size - 0.5) / 1.5),
    words,
  };
}

/** Damerau-Levenshtein distance (adjacent transpositions count as one edit). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * The site's words that stand for a query word it does not use itself. First
 * other forms of the same word: stems of five letters or more of which one
 * begins with the other ("accurate" and "accuracy", "programme" and
 * "program"). Then typos: same first letter, one edit away; short words are
 * corrected only when two letters were swapped ("pixle"), and words under five
 * letters never, because "fire" is not "file". Any other unknown word matches
 * nothing: it is not replaced by a look-alike. The more common word wins a tie.
 */
export function expand(index: Index, raw: string): string[] {
  if (raw.length < TYPO_MIN || /\d/.test(raw) || index.words.has(raw)) return [];
  const term = stem(raw);
  const df = (t: string) => index.postings.get(t)!.length;
  const byDf = (a: string, b: string) => df(b) - df(a) || a.localeCompare(b);
  const letters = (word: string) => [...word].sort().join('');
  const forms = new Set<string>();
  const typos = new Set<string>();
  for (const [word, other] of index.words) {
    if (/\d/.test(word)) continue;
    if (Math.min(other.length, term.length) >= VARIANT_MIN && (other.startsWith(term) || term.startsWith(other))) forms.add(other);
    else if (word[0] === raw[0] && Math.abs(word.length - raw.length) <= 1 && editDistance(raw, word) === 1 && (raw.length >= TYPO_ANY_EDIT_MIN || letters(word) === letters(raw))) typos.add(other);
  }
  return [...[...forms].sort(byDf), ...[...typos].filter((t) => !forms.has(t)).sort(byDf)].slice(0, EXPANSIONS_MAX);
}

export interface QueryTerm {
  /** As tokenised from the question. */
  term: string;
  /** The vocabulary words that score for it: itself, or the words it was corrected to. */
  matches: string[];
  /** False for a misspelt word that was corrected, and for a word the site does not use. */
  exact: boolean;
  /** Its weight in coverage: its idf, or the maximum idf for a word the site never uses. */
  idf: number;
}

export interface SearchResult {
  scores: Float32Array;
  /** Share of the question's weight found in the best chunk, 0 to 1. */
  coverage: number;
  /** Share of query words with no vocabulary match at all. */
  oov: number;
  /**
   * The best chunk is about the question, not merely a text in which one of
   * its words occurs: it holds two of the question's words as written, or one
   * of them in its title, heading, tags or questions.
   */
  anchored: boolean;
  terms: QueryTerm[];
}

export function search(index: Index, query: string): SearchResult {
  const scores = new Float32Array(index.size);
  const seen = new Set<string>();
  const terms: QueryTerm[] = [];
  for (const { raw, term } of tokens(query)) {
    if (seen.has(term)) continue;
    seen.add(term);
    const known = index.idf.get(term);
    terms.push(known === undefined ? { term, matches: expand(index, raw), exact: false, idf: index.maxIdf } : { term, matches: [term], exact: true, idf: known });
  }
  for (const { exact, matches } of terms) {
    const weight = exact ? 1 : EXPANSION_WEIGHT;
    for (const match of matches) {
      const idf = index.idf.get(match)!;
      for (const [doc, wtf] of index.postings.get(match)!) {
        scores[doc] += (weight * idf * wtf * (K1 + 1)) / (wtf + K1 * (1 - B + (B * index.len[doc]) / index.avglen));
      }
    }
  }
  let best = -1;
  for (let doc = 0; doc < scores.length; doc++) if (scores[doc] > 0 && (best < 0 || scores[doc] > scores[best])) best = doc;
  const inBest = (match: string) => index.postings.get(match)!.find(([doc]) => doc === best);
  const present = best < 0 ? [] : terms.filter((t) => t.matches.some(inBest));
  const total = terms.reduce((sum, t) => sum + t.idf, 0);
  const exact = present.filter((t) => t.exact);
  return {
    scores,
    coverage: total ? present.reduce((sum, t) => sum + t.idf, 0) / total : 0,
    // A question with no searchable word at all (another script, or only function words) matched nothing either.
    oov: terms.length ? terms.filter((t) => t.matches.length === 0).length / terms.length : 1,
    anchored: exact.length >= 2 || exact.some((t) => inBest(t.term)![2] === 1),
    terms,
  };
}
