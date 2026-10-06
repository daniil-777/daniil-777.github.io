/**
 * Runs one generated answer: time-outs, the guard on every block, and the
 * decision whether the result may be shown or the quotes answer takes its
 * place. No DOM, so the tests drive it with a replayed stream.
 */
import { direct } from '../../lib/chat/answer.ts';
import { search, tokenise, type Index, type SearchResult } from '../../lib/chat/bm25.ts';
import { guardBlock, guardConversationBlock, isAbstention, newGuardState } from '../../lib/chat/guard.ts';
import { JOURNEY_ROLLUP, JOURNEY_URL, type Chunk } from '../../lib/chat/kb.ts';
import { PREV_MAX, HISTORY_MAX, HISTORY_ANSWER_MAX, HISTORY_CHARS_MAX, type HistoryTurn } from '../../lib/chat/protocol.ts';
import { confidence, topK } from '../../lib/chat/retrieve.ts';
import type { Generator, GenEvent } from '../../lib/chat/types.ts';
import type { Resource } from '../../lib/chat/resources.ts';
import { refersToPrevious } from '../../lib/chat/context.ts';

/** The first sign of life must arrive within this time. */
export const FIRST_EVENT_MS = 15_000;
/** The whole answer must be finished within this time. */
export const DONE_MS = 30_000;
/** An on-device answer cites a passage it shares at least this many content words with. */
export const SHARED_TERMS_MIN = 3;

/** Words that point back at the previous answer. "He" and "his" do not: they always mean Daniil. */
const REFERS_BACK = /\b(?:it|its|they|them|their|there)\b/i;
/** "And before that?": the earlier steps of the timeline. */
const EARLIER = /\b(?:before|earlier|previous|previously|prior)\b/i;

/** What the previous answer was about: its question, the title of its first source, and that source's address. */
export interface Last {
  q: string;
  about?: string;
  url?: string;
}

/**
 * The keyword search for one question of a conversation. A question is first
 * taken as it stands. The subject of the previous answer is added only when
 * the new one points back ("What is its stack?"), continues it ("and the
 * result?") or explicitly requests elaboration, so a question
 * on another subject is never bent towards the last topic.
 */
export function searchInContext(index: Index, question: string, last: Last | undefined, subjects: Set<string>, chunks: Chunk[] = []): { query: string; result: SearchResult } {
  const alone = search(index, question);
  if (!last) return { query: question, result: alone };
  const first = chunks[topK(alone.scores, 1)[0]];
  // "And his hobbies?" is answered by a fact or a list of its own; "and the result?" is not.
  const answered = first !== undefined && (direct(first, alone.terms) || (first.kind === 'rollup' && confidence(alone) === 'ok'));
  const named = tokenise(question).some((term) => subjects.has(term));
  const leans = !named && (REFERS_BACK.test(question) || (refersToPrevious(question) && !answered));
  if (!leans) return { query: question, result: alone };

  // After an answer from the timeline, "and before that?" is the timeline itself.
  const timeline = chunks.findIndex((chunk) => chunk.id === JOURNEY_ROLLUP);
  if (EARLIER.test(question) && last.url?.startsWith(JOURNEY_URL) && timeline >= 0) {
    const scores = new Float32Array(index.size);
    scores[timeline] = 1;
    return { query: question, result: { scores, coverage: 1, oov: 0, anchored: true, terms: [] } };
  }
  // "It" is the subject of the last answer; the words of the last question would only pull towards its details.
  const query = leans && last.about ? `${question} ${last.about}` : [question, last.q, last.about ?? ''].join(' ').trim();
  return { query, result: search(index, query) };
}

/** The earlier questions "AI answer" sends along: only those that were themselves sent, never one typed in another mode. */
export function earlier(turns: { q: string; sent?: boolean; answer?: { mode: string } }[], max: number = PREV_MAX): string[] {
  return turns.filter((turn) => turn.sent && turn.answer?.mode === 'cloud').map((turn) => turn.q).slice(-max);
}

/** Only successfully displayed cloud conversations are sent again; search and private replies stay local. */
export function conversationHistory(turns: { q: string; sent?: boolean; answer: { mode: string; text: string[]; chips?: unknown[]; passages?: { text: string }[]; resources?: Resource[] } }[], mode: string = 'cloud'): HistoryTurn[] {
  const history = turns.filter((turn) => (turn.sent && (turn.answer.mode === mode || (mode === 'device' && turn.answer.mode === 'cloud'))) || (mode === 'device' && turn.answer.mode === 'quotes' && (!!turn.answer.chips?.length || !!turn.answer.passages?.length || !!turn.answer.resources?.length)))
    .slice(-HISTORY_MAX).map((turn) => ({ q: turn.q, a: [...turn.answer.text, ...(turn.answer.passages?.map(p => p.text) ?? []), ...(turn.answer.resources?.map(r => `Public ${r.kind}: ${r.title}`) ?? [])].join('\n\n').slice(0, HISTORY_ANSWER_MAX) })).filter(turn => turn.a);
  while (history.reduce((n, turn) => n + turn.q.length + turn.a.length, 0) > HISTORY_CHARS_MAX) history.shift();
  return history;
}

export type FallbackReason = 'failed' | 'busy' | 'budget' | 'credits' | 'unverified' | 'device';

/** What a generator throws when it knows why it could not answer. */
export class ChatError extends Error {
  reason: FallbackReason;
  constructor(reason: FallbackReason) {
    super(reason);
    this.reason = reason;
  }
}

export type Outcome =
  | { kind: 'answer'; blocks: string[]; cites: string[]; abstained: boolean; cutShort: boolean; stopped: boolean }
  /** Show the quotes answer instead. */
  | { kind: 'fallback'; reason: FallbackReason | 'stopped' };

export interface GenerateOptions {
  generator: Generator;
  question: string;
  prev: string[];
  history?: HistoryTurn[];
  locale?: import('../../i18n/core.ts').Locale;
  /** The best chunks for the question; an on-device model sees only these. */
  chunks: Chunk[];
  byId: Map<string, Chunk>;
  /** Aborted when the visitor presses Stop or closes the dialog. */
  stop: AbortSignal;
  /** Called for every block that passed the guard, with the ids of the sources it is the first to cite. */
  onBlock?: (text: string, cites: string[]) => void;
  firstMs?: number;
  doneMs?: number;
}

const TIMED_OUT = Symbol('timed out');

async function within<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T | typeof TIMED_OUT> {
  if (signal.aborted) { void promise.catch(() => {}); return TIMED_OUT; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms))));
  let abort = () => {};
  const stopped = new Promise<typeof TIMED_OUT>(resolve => { abort = () => resolve(TIMED_OUT); signal.addEventListener('abort', abort, { once: true }); });
  try {
    return await Promise.race([promise, limit, stopped]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** The supplied chunks the answer really draws on. */
function sharing(text: string, chunks: Chunk[]): string[] {
  const said = new Set(tokenise(text));
  return chunks.filter((chunk) => new Set(tokenise(chunk.text).filter((term) => said.has(term))).size >= SHARED_TERMS_MIN).map((chunk) => chunk.id);
}

export async function generateAnswer(options: GenerateOptions): Promise<Outcome> {
  if (options.stop.aborted) return { kind: 'fallback', reason: 'stopped' };
  const { generator, question, prev, history, chunks, byId, stop, onBlock, firstMs = FIRST_EVENT_MS, doneMs = generator.timeoutMs ?? DONE_MS } = options;
  // The cloud model cites per block. A model on the device is handed its passages; code decides which it used.
  const citesItself = generator.id === 'cloud' || generator.citesSources === true;
  const supplied = new Set(chunks.map(chunk => chunk.id));
  const request = new AbortController();
  const abort = () => request.abort();
  stop.addEventListener('abort', abort);
  const blocks: string[] = [];
  const cites: string[] = [];
  const state = newGuardState();
  const started = Date.now();
  const fallback = (reason: FallbackReason): Outcome => ({ kind: 'fallback', reason });
  const answer = (extra: { abstained?: boolean; cutShort?: boolean; stopped?: boolean }): Outcome & { kind: 'answer' } => ({
    kind: 'answer',
    blocks,
    // An abstention states nothing, so it has no sources.
    cites: extra.abstained ? [] : citesItself ? cites : sharing(blocks.join(' '), chunks),
    abstained: false,
    cutShort: false,
    stopped: false,
    ...extra,
  });
  const stopped = (): Outcome => (blocks.length ? answer({ stopped: true }) : { kind: 'fallback', reason: 'stopped' });

  let events: AsyncIterator<GenEvent> | undefined;
  let alive = false;
  try {
    events = generator.generate({ question, prev, history, chunks, ...(options.locale ? { locale: options.locale } : {}) }, request.signal)[Symbol.asyncIterator]();
    for (;;) {
      const next = await within(events.next(), alive ? doneMs - (Date.now() - started) : Math.min(firstMs, doneMs), stop);
      if (stop.aborted) return stopped();
      if (next === TIMED_OUT || next.done) return fallback('failed');
      const event = next.value;
      alive = true;
      // Deltas keep the transport alive. Only complete paragraphs can be checked
      // against their citations, so unfinished model text never reaches the view.
      if (event.type === 'block') {
        const cited = event.cites.map((id) => byId.get(id));
        if (cited.some((chunk) => !chunk) || (generator.id !== 'cloud' && event.cites.some(id => !supplied.has(id)))) return fallback('unverified');
        const guard = generator.conversational ? guardConversationBlock : guardBlock;
        if (!guard(event.text, cited as Chunk[], question, state).ok) return fallback('unverified');
        const fresh = citesItself ? event.cites.filter((id) => !cites.includes(id)) : [];
        cites.push(...fresh);
        blocks.push(event.text);
        onBlock?.(event.text, fresh);
      } else if (event.type === 'done') {
        if (event.stop === 'refusal' || blocks.length === 0) return fallback('unverified');
        if (isAbstention(blocks.join(' '))) return answer({ abstained: true });
        const result = answer({ cutShort: event.stop === 'max_tokens' });
        // An answer that names no source cannot be checked by the visitor either.
        return result.cites.length === 0 && !generator.conversational ? fallback('unverified') : result;
      }
    }
  } catch (error) {
    if (stop.aborted) return stopped();
    return fallback(error instanceof ChatError ? error.reason : 'failed');
  } finally {
    stop.removeEventListener('abort', abort);
    request.abort();
    // Not awaited: a generator stuck in a request settles only once the abort reaches it.
    void events?.return?.(undefined)?.catch(() => {});
  }
}
