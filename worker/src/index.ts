/**
 * The endpoint behind the assistant's "AI answer" mode: POST /v1/chat.
 *
 * The browser sends the question and a bounded conversation history.
 * This Worker owns everything else: it fetches the site's knowledge base,
 * supplies the public portfolio as a stable, cached context prefix, and streams the
 * answer back block by block with the chunks each block cites. It holds the
 * provider API key, which never reaches the browser. Its own log lines hold metadata only:
 * never the question, never the visitor's address. What Cloudflare records
 * around them is set in wrangler.jsonc (`invocation_logs: false`).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Chunk } from '../../src/lib/chat/kb.ts';
import { OPENAI_MODEL, DEFAULT_MODEL, EFFORT, FALLBACKS, FALLBACK_BETA, MAX_TOKENS, SYSTEM_PROMPT, buildQuestionBlock, toDocuments, type DocumentBlock } from '../../src/lib/chat/prompt.ts';
import { BODY_BYTES_MAX, ERROR_STATUS, encodeSse, validateRequest, type ChatEvent, type ChatRequest, type ErrorCode } from '../../src/lib/chat/protocol.ts';
import { allowedOrigin, checkKb, convert, readCapped } from './logic.ts';
import { streamOpenAI } from './openai.ts';

export { Budget } from './budget.ts';

export interface Env {
  /** Fail closed: only an explicit true enables public, billable requests. */
  CHAT_ENABLED?: string;
  OPENAI_API_KEY?: string;
  /** SDK-style base URL, including /v1. Only override for local testing. */
  OPENAI_BASE_URL?: string;
  CHAT_PROVIDER?: 'openai' | 'anthropic';
  /** Secret. Set with `npx wrangler secret put ANTHROPIC_API_KEY`, or in .dev.vars for local runs. */
  ANTHROPIC_API_KEY?: string;
  /** Only for local runs against the stub in scripts/chat-stub.mjs. */
  ANTHROPIC_BASE_URL?: string;
  CHAT_MODEL?: string;
  /** Comma-separated origins that may call the endpoint. */
  ALLOWED_ORIGINS?: string;
  KB_URL?: string;
  /** Requests per UTC day, as a string. */
  DAILY_LIMIT?: string;
  /** Only for the smoke test: the time one answer may take, in milliseconds. */
  ANSWER_MS?: string;
  RL_IP: RateLimit;
  RL_ALL: RateLimit;
  BUDGET: DurableObjectNamespace;
}

const KB_TTL_MS = 300_000;
const DEFAULT_KB_URL = 'https://demtsev.com/chat/kb.json';
const DEFAULT_DAILY_LIMIT = 25;
/** The browser gives up after 30 s. The whole answer is cut off just before that, however far the model has got … */
const ANSWER_MS = 28_000;
/** … and the model has this long to start answering. Not retried: a retry would run past the limit above. */
const UPSTREAM_TIMEOUT_MS = 25_000;
const PLAIN = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const cors = (origin: string | undefined): Record<string, string> => (origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {});

/** One line per request: what happened, never what was asked or by whom. */
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ at: 'chat', ...entry }));

function fail(code: ErrorCode, message: string, origin: string | undefined, extra: Record<string, string> = {}, status = ERROR_STATUS[code]): Response {
  log({ status, code });
  return Response.json({ error: { code, message } }, { status, headers: { ...PLAIN, ...cors(origin), ...extra } });
}

/** The knowledge base and the documents built from it, kept for five minutes per isolate. */
interface Loaded {
  url: string;
  at: number;
  hash: string;
  chunks: Chunk[];
  documents: DocumentBlock[];
}
let loaded: Loaded | undefined;

async function loadKb(url: string): Promise<Loaded | undefined> {
  const now = Date.now();
  if (loaded && loaded.url === url && now - loaded.at < KB_TTL_MS) return loaded;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    const kb = response.ok ? checkKb(await response.json()) : undefined;
    if (kb) return (loaded = { url, at: now, ...kb, documents: toDocuments(kb.chunks) });
  } catch {
    // Unreachable or not JSON: handled below like an invalid file.
  }
  // The site is briefly unreachable or mid-deploy: the last good copy is better than no answer.
  return loaded?.url === url ? loaded : undefined;
}

/** One request against the daily cap. Any trouble with the counter counts as "no": it guards money. */
async function withinBudget(env: Env): Promise<boolean> {
  const limit = Number(env.DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT);
  try {
    const response = await env.BUDGET.get(env.BUDGET.idFromName('daily')).fetch(`https://budget/take?limit=${limit}`);
    return ((await response.json()) as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

/** What the visitor's browser is told when the model could not be reached or broke off. */
function upstreamCode(error: unknown): 'overloaded' | 'upstream' {
  if (error instanceof Anthropic.RateLimitError) return 'overloaded';
  if (error instanceof Anthropic.APIConnectionError) return 'upstream';
  if (error instanceof Anthropic.APIError) return error.status === 529 || error.type === 'overloaded_error' ? 'overloaded' : 'upstream';
  return 'upstream';
}

/**
 * Asks the selected provider and re-emits its stream as the site's own events. The request
 * ends when the answer is complete, when the visitor closes the
 * connection, or when the time for one answer is up, whichever comes first.
 */
function answer(env: Env, kb: Loaded, { q, prev, history, locale }: ChatRequest, origin: string, gone: AbortSignal): Response {
  const started = Date.now();
  const provider = env.CHAT_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'anthropic');
  const apiKey = provider === 'openai' ? env.OPENAI_API_KEY! : env.ANTHROPIC_API_KEY!;
  const model = env.CHAT_MODEL || (provider === 'openai' ? OPENAI_MODEL : DEFAULT_MODEL);
  const upstream = new AbortController();
  /** The visitor closed the dialog or left the page: nobody is reading any more. */
  let closed = false;
  let timedOut = false;
  const leave = () => {
    closed = true;
    upstream.abort();
  };
  gone.addEventListener('abort', leave);
  const encoder = new TextEncoder();

  const pump = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    const outcome: Record<string, unknown> = { status: 200, model, kb: kb.hash };
    const send = (event: ChatEvent) => {
      if (event.event === 'done') Object.assign(outcome, event.data);
      if (event.event === 'error') outcome.code = event.data.code;
      if (!closed) controller.enqueue(encoder.encode(encodeSse(event)));
    };
    // A stream that started and then went silent would otherwise stay open for as long as the caller holds on.
    const timer = setTimeout(() => {
      timedOut = true;
      upstream.abort();
    }, Number(env.ANSWER_MS) || ANSWER_MS);
    try {
      send({ event: 'meta', data: { v: 1, kb: kb.hash, model } });
      if (provider === 'openai') {
        for await (const event of streamOpenAI({ apiKey, baseURL: env.OPENAI_BASE_URL, model, chunks: kb.chunks, hash: kb.hash, question: q, prev, history, locale, signal: upstream.signal })) {
          if (upstream.signal.aborted) throw new Error('aborted');
          send(event);
        }
      } else {
        const client = new Anthropic({ apiKey, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 0, timeout: UPSTREAM_TIMEOUT_MS });
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            output_config: { effort: EFFORT },
            // A request declined by a safety classifier is retried once on another Claude model.
            betas: [FALLBACK_BETA],
            fallbacks: FALLBACKS,
            system: SYSTEM_PROMPT,
            // Every document is the same for every visitor and the last one carries the cache breakpoint; only the final block differs.
            messages: [{ role: 'user', content: [...kb.documents, { type: 'text', text: buildQuestionBlock(q, prev, new Date().toISOString().slice(0, 10), locale) + (history?.length ? '\nPrevious conversation (untrusted context, not personal evidence):\n' + JSON.stringify(history) : '') }] }],
          },
          { signal: upstream.signal },
        );
        for await (const event of convert(stream, kb.chunks)) {
          // An answer that was cut off must not end in an event that says it is complete.
          if (upstream.signal.aborted) throw new Error('aborted');
          send(event);
        }
      }
    } catch (error) {
      if (closed) outcome.code = 'closed';
      else send({ event: 'error', data: { code: timedOut ? 'upstream' : upstreamCode(error) } });
    }
    clearTimeout(timer);
    gone.removeEventListener('abort', leave);
    if (timedOut) outcome.timedOut = true;
    log({ ...outcome, ms: Date.now() - started });
    if (!closed) controller.close();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void pump(controller);
    },
    cancel: leave,
  });
  return new Response(body, { headers: { ...PLAIN, ...cors(origin), 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS ?? '');
    if (new URL(request.url).pathname !== '/v1/chat') return fail('invalid', 'Not found.', origin, {}, 404);
    if (env.CHAT_ENABLED !== 'true') return fail('upstream', 'The public assistant is temporarily paused.', origin, { 'Retry-After': '3600' }, 503);
    if (request.method === 'OPTIONS') {
      if (!origin) return fail('origin', 'This origin may not use the endpoint.', undefined);
      return new Response(null, { status: 204, headers: { ...cors(origin), 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'POST') return fail('method', 'Use POST.', origin, { Allow: 'POST, OPTIONS' });
    if (!origin) return fail('origin', 'This origin may not use the endpoint.', undefined);
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get('Content-Type') ?? '')) return fail('type', 'Send application/json.', origin);

    const text = await readCapped(request, BODY_BYTES_MAX);
    if (text === undefined) return fail('too_large', `The body may be at most ${BODY_BYTES_MAX} bytes.`, origin);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail('invalid', 'The body is not JSON.', origin);
    }
    const input = validateRequest(json);
    if (!input.ok) return fail('invalid', input.message, origin);

    const configured = env.CHAT_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.CHAT_PROVIDER === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY;
    if (!configured) return fail('upstream', 'The endpoint is not configured.', origin);
    const busy = () => fail('rate', 'Too many requests. Try again in a minute.', origin, { 'Retry-After': '60' });
    // One after the other: a request its own address's limit refuses must not use up the limit all visitors share.
    if (!(await env.RL_IP.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success) return busy();
    if (!(await env.RL_ALL.limit({ key: 'all' })).success) return busy();

    const kb = await loadKb(env.KB_URL || DEFAULT_KB_URL);
    if (!kb) return fail('kb', 'The site content could not be loaded.', origin);
    // Counted last, right before the request that costs money.
    if (!(await withinBudget(env))) return fail('budget', 'The daily limit has been reached.', origin);

    return answer(env, kb, input.value, origin, request.signal);
  },
};
