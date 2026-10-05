/**
 * The Worker's decisions that need neither Cloudflare nor the Anthropic SDK,
 * kept apart so that `npm test` can check them (tests/chat/worker.test.ts).
 */
import type { Chunk } from '../../src/lib/chat/kb.ts';
import type { ChatEvent, Usage } from '../../src/lib/chat/protocol.ts';

/** The origin itself when it is on the comma-separated allowlist. Stops other sites using the endpoint; it is not authentication. */
export function allowedOrigin(origin: string | null, allowed: string): string | undefined {
  const list = allowed.split(',').map((entry) => entry.trim()).filter(Boolean);
  return origin && list.includes(origin) ? origin : undefined;
}

/** The request body as text, or nothing when it is longer than `max` bytes. Never reads past the cap. */
export async function readCapped(request: Request, max: number): Promise<string | undefined> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}

export const KB_CHUNKS_MAX = 400;
export const KB_CHARS_MAX = 300_000;

/**
 * The knowledge base is fetched from the site, so it is checked like any
 * other input: right version, a sane size, and sources only on the site itself.
 */
export function checkKb(value: unknown): { hash: string; chunks: Chunk[] } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { v, hash, chunks } = value as { v?: unknown; hash?: unknown; chunks?: unknown };
  if (v !== 1 || typeof hash !== 'string' || !Array.isArray(chunks) || chunks.length < 1 || chunks.length > KB_CHUNKS_MAX) return undefined;
  let chars = 0;
  for (const chunk of chunks as Partial<Chunk>[]) {
    if (typeof chunk !== 'object' || chunk === null) return undefined;
    const { id, url, title, heading, text } = chunk;
    if (typeof id !== 'string' || typeof url !== 'string' || typeof title !== 'string' || typeof heading !== 'string' || typeof text !== 'string') return undefined;
    if (!url.startsWith('/') || url.startsWith('//')) return undefined;
    chars += title.length + heading.length + text.length;
  }
  return chars > KB_CHARS_MAX ? undefined : { hash, chunks: chunks as Chunk[] };
}

export interface Day {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  count: number;
}

/** One more request against the daily cap: the new count to store, or a refusal. */
export function take(stored: Day | undefined, day: string, limit: number): { ok: true; next: Day } | { ok: false } {
  const count = stored?.day === day ? stored.count : 0;
  return count < limit ? { ok: true, next: { day, count: count + 1 } } : { ok: false };
}

/** Token counts as the Messages API reports them; a stream repeats some of them at the end. */
interface UpstreamUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** The fields of the Messages API's stream events that are read here. The SDK's event types fit this shape. */
export interface UpstreamEvent {
  type: string;
  index?: number;
  message?: { usage?: UpstreamUsage };
  content_block?: { type: string };
  delta?: { type?: string; text?: string; citation?: { type: string; document_index?: number }; stop_reason?: string | null };
  usage?: UpstreamUsage | null;
}

/**
 * The model's stream as the site's own events. A text block is released only
 * once it is complete, with the chunks it cites: every chunk was sent as one
 * document, in order, so a citation's `document_index` is the chunk's index.
 * Thinking, fallback markers and anything unknown are dropped.
 */
export async function* convert(events: AsyncIterable<UpstreamEvent>, chunks: Chunk[]): AsyncGenerator<ChatEvent> {
  const blocks = new Map<number, { text: string; cites: Set<number> }>();
  const usage: Usage = { in: 0, out: 0, cr: 0, cw: 0 };
  const count = (from: UpstreamUsage | null | undefined) => {
    usage.in = from?.input_tokens ?? usage.in;
    usage.out = from?.output_tokens ?? usage.out;
    usage.cr = from?.cache_read_input_tokens ?? usage.cr;
    usage.cw = from?.cache_creation_input_tokens ?? usage.cw;
  };
  let stop: string | null | undefined;

  for await (const event of events) {
    const block = event.index === undefined ? undefined : blocks.get(event.index);
    if (event.type === 'message_start') {
      count(event.message?.usage);
      yield { event: 'status', data: { s: 'thinking' } };
    } else if (event.type === 'content_block_start' && event.index !== undefined) {
      if (event.content_block?.type === 'text') blocks.set(event.index, { text: '', cites: new Set() });
    } else if (event.type === 'content_block_delta' && block) {
      if (event.delta?.type === 'text_delta') block.text += event.delta.text ?? '';
      else if (event.delta?.type === 'citations_delta' && typeof event.delta.citation?.document_index === 'number') block.cites.add(event.delta.citation.document_index);
    } else if (event.type === 'content_block_stop' && block && event.index !== undefined) {
      blocks.delete(event.index);
      if (block.text.trim()) yield { event: 'block', data: { t: block.text, c: [...block.cites].flatMap((index) => chunks[index]?.id ?? []) } };
    } else if (event.type === 'message_delta') {
      stop = event.delta?.stop_reason;
      count(event.usage);
    }
  }

  // No stop reason: the connection broke off, and what was shown is not a finished answer.
  if (!stop) yield { event: 'error', data: { code: 'upstream' } };
  else yield { event: 'done', data: { stop: stop === 'max_tokens' || stop === 'refusal' ? stop : 'end_turn', usage } };
}
