/**
 * The contract between the browser and the Worker: the request body, its
 * validation, and the server-sent events of the reply. Used on both sides.
 */
import { INPUT_MAX } from '../../data/chat.ts';
import { isLocale, type Locale } from '../../i18n/core.ts';

export const PROTOCOL_VERSION = 1;
// Up to 24,000 history characters plus the question/legacy context may use
// four UTF-8 bytes each. Decoded field limits still bound the actual content.
export const BODY_BYTES_MAX = 131_072;
export const PREV_MAX = 3;
export const HISTORY_MAX = 6;
export const HISTORY_ANSWER_MAX = 4000;
export const HISTORY_CHARS_MAX = 24_000;

export interface HistoryTurn {
  q: string;
  a: string;
}

export interface ChatRequest {
  v: 1;
  q: string;
  /** Up to three earlier questions of the same visitor. Never answers, never passages. */
  prev: string[];
  /** Conversation context only; never trusted as evidence about the portfolio. */
  history?: HistoryTurn[];
  locale?: Locale;
}

export type ErrorCode = 'invalid' | 'origin' | 'method' | 'too_large' | 'type' | 'rate' | 'budget' | 'kb' | 'upstream';
export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  origin: 403,
  method: 405,
  too_large: 413,
  type: 415,
  rate: 429,
  budget: 503,
  kb: 503,
  upstream: 503,
};

export interface Usage {
  in: number;
  out: number;
  /** Tokens read from the prompt cache. */
  cr: number;
  /** Tokens written to the prompt cache. */
  cw: number;
}

export type ChatEvent =
  | { event: 'meta'; data: { v: 1; kb: string; model: string } }
  | { event: 'status'; data: { s: 'thinking' } }
  | { event: 'delta'; data: { t: string } }
  | { event: 'block'; data: { t: string; c: string[] } }
  | { event: 'done'; data: { stop: 'end_turn' | 'max_tokens' | 'refusal'; usage: Usage } }
  | { event: 'error'; data: { code: 'upstream' | 'kb' | 'overloaded' } };

/** Control characters other than a line break never reach a model. */
const clean = (text: string) => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();

const question = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = clean(value);
  return text.length >= 1 && text.length <= INPUT_MAX ? text : undefined;
};

/** Only questions and bounded conversation context can be supplied, never system instructions or content. */
export function validateRequest(body: unknown): { ok: true; value: ChatRequest } | { ok: false; message: string } {
  const no = (message: string) => ({ ok: false as const, message });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return no('The body must be a JSON object.');
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!['v', 'q', 'prev', 'history', 'locale'].includes(key)) return no(`Unknown field "${key.slice(0, 20)}".`);
  if (input.locale !== undefined && !isLocale(input.locale)) return no('Unsupported language.');
  if (input.v !== PROTOCOL_VERSION) return no('Unsupported version.');
  const q = question(input.q);
  if (q === undefined) return no(`"q" must be a string of 1 to ${INPUT_MAX} characters.`);
  const prev: string[] = [];
  if (input.prev !== undefined) {
    if (!Array.isArray(input.prev) || input.prev.length > PREV_MAX) return no(`"prev" must be an array of at most ${PREV_MAX} questions.`);
    for (const item of input.prev) {
      const text = question(item);
      if (text === undefined) return no(`Every item of "prev" must be a string of 1 to ${INPUT_MAX} characters.`);
      prev.push(text);
    }
  }
  const history: HistoryTurn[] = [];
  if (input.history !== undefined) {
    if (!Array.isArray(input.history) || input.history.length > HISTORY_MAX) return no(`"history" must contain at most ${HISTORY_MAX} turns.`);
    let chars = 0;
    for (const item of input.history) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => key !== 'q' && key !== 'a')) return no('Each history turn must contain only q and a.');
      const q = question(item.q);
      const a = typeof item.a === 'string' ? clean(item.a) : '';
      if (!q || !a || a.length > HISTORY_ANSWER_MAX) return no('Invalid history question or answer.');
      chars += q.length + a.length;
      if (chars > HISTORY_CHARS_MAX) return no('Conversation history is too long.');
      history.push({ q, a });
    }
  }
  return { ok: true, value: { v: 1, q, prev, ...(input.history !== undefined ? { history } : {}), ...(input.locale !== undefined ? { locale: input.locale as Locale } : {}) } };
}

export function encodeSse(event: ChatEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

const EVENTS = new Set(['meta', 'status', 'delta', 'block', 'done', 'error']);

/**
 * An incremental parser for the event stream. Feed it the chunks as they
 * arrive, cut anywhere, even inside a character; it returns the events each
 * chunk completes. Unknown events, comments and malformed data are skipped.
 */
export function parseSse(): { push(chunk: Uint8Array | string): ChatEvent[]; end(): ChatEvent[] } {
  const decoder = new TextDecoder();
  let buffer = '';
  let name = '';
  let data: string[] = [];

  const drain = (final: boolean): ChatEvent[] => {
    const events: ChatEvent[] = [];
    const lines = buffer.split(/\r\n|\n|\r/);
    // The last piece may be an unfinished line.
    buffer = final ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (line === '') {
        if (EVENTS.has(name) && data.length) {
          try {
            events.push({ event: name, data: JSON.parse(data.join('\n')) } as ChatEvent);
          } catch {
            // Not JSON: skip the event.
          }
        }
        name = '';
        data = [];
      } else if (line.startsWith(':')) {
        continue;
      } else if (line.startsWith('event:')) {
        name = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    return events;
  };

  return {
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      // Hold back a trailing "\r": the "\n" of the pair may be in the next chunk.
      const held = buffer.endsWith('\r') ? '\r' : '';
      buffer = buffer.slice(0, buffer.length - held.length);
      const events = drain(false);
      buffer += held;
      return events;
    },
    end() {
      buffer += decoder.decode();
      return drain(true);
    },
  };
}
