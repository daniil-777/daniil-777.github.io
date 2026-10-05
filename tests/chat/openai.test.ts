import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Chunk } from '../../src/lib/chat/kb.ts';
import { MAX_TOKENS, SYSTEM_PROMPT } from '../../src/lib/chat/prompt.ts';
import { streamOpenAI, type OpenAIEvent, type OpenAIInput } from '../../worker/src/openai.ts';

const chunks: Chunk[] = [
  { id: 'site:intro', kind: 'site', url: '/', title: 'Daniil Emtsev', heading: '', tags: [], asks: [], text: 'Daniil is an AI research engineer in Zürich.' },
  { id: 'project:finance', kind: 'project', url: '/work/finance/', title: 'FX Regime Radar', heading: '', tags: [], asks: [], text: 'FX Regime Radar is an educational currency analytics project.' },
];
const delta = (value: string) => ({ type: 'response.output_text.delta', delta: value, item_id: 'msg_1', content_index: 0 });
const completed = (extra: object = {}) => ({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 130, output_tokens: 35, input_tokens_details: { cached_tokens: 110 } }, ...extra } });
const wire = (events: object[], newline = '\n') => new TextEncoder().encode(events.map((event) => `event: message${newline}data: ${JSON.stringify(event)}${newline}${newline}`).join(''));

function streamed(events: object[], size = 64, newline = '\n'): Response {
  const bytes = wire(events, newline);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

const input = (extra: Partial<OpenAIInput> = {}): OpenAIInput => ({ apiKey: 'test-secret', model: 'gpt-5.4-mini', chunks, hash: 'abcdef0123456789', question: 'Can I hire him as a financial manager?', prev: [], signal: new AbortController().signal, ...extra });

async function collect(response: Response | (() => Promise<Response>), extra: Partial<OpenAIInput> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof response === 'function' ? response() : response;
  }) as typeof fetch;
  const events: OpenAIEvent[] = [];
  for await (const event of streamOpenAI(input(extra), fetcher)) events.push(event);
  return { events, calls };
}

describe('OpenAI Responses adapter', () => {
  it('uses explicit reusable-prefix caching and cache-write accounting for the current Luna model', async () => {
    const { calls, events } = await collect(streamed([delta('Hello.'), completed({ usage: { input_tokens: 21000, output_tokens: 30, input_tokens_details: { cached_tokens: 18000, cache_write_tokens: 2000 } } })]), { model: 'gpt-6-luna', history: [{ q: 'Hello', a: 'Hello.' }] });
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.service_tier, 'default');
    assert.deepEqual(body.reasoning, { effort: 'none' });
    assert.deepEqual(body.prompt_cache_options, { mode: 'explicit', ttl: '30m' });
    assert.deepEqual(body.input[0].content[0].prompt_cache_breakpoint, { mode: 'explicit' });
    assert.ok(chunks.every((chunk) => body.input[0].content[0].text.includes(chunk.text)));
    assert.ok(body.input.slice(1).every((turn: { content: unknown }) => typeof turn.content === 'string'));
    assert.deepEqual(events.at(-1), { event: 'done', data: { stop: 'end_turn', usage: { in: 21000, out: 30, cr: 18000, cw: 2000 } } });
  });
  it('uses server-side credentials, full portfolio references, stateless history and a reusable cache key', async () => {
    const { calls } = await collect(streamed([delta('His background is AI engineering. [[site:intro]]'), completed()]), {
      baseURL: 'http://127.0.0.1:8788/v1/',
      history: [{ q: 'Is he an accountant?', a: 'Unverified earlier answer: he is an accountant.' }],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:8788/v1/responses');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer test-secret');
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model, 'gpt-5.4-mini');
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, MAX_TOKENS);
    assert.deepEqual(body.reasoning, { effort: 'none' });
    assert.equal(body.prompt_cache_key, 'demtsev:abcdef0123456789');
    assert.ok(body.instructions.startsWith(SYSTEM_PROMPT));
    assert.match(body.instructions, /untrusted conversation context, not factual evidence/);
    assert.match(body.instructions, /\[\[source-id\]\]/);
    assert.equal(body.input[0].role, 'developer');
    assert.ok(chunks.every((chunk) => body.input[0].content.includes(chunk.text)));
    assert.equal(body.input[1].role, 'user');
    assert.match(body.input[1].content, /Untrusted earlier visitor question/);
    assert.equal(body.input[2].role, 'assistant');
    assert.match(body.input[2].content, /verify facts against portfolio records/);
    assert.match(body.input.at(-1).content, /<visitor_question>\nCan I hire him as a financial manager\?\n<\/visitor_question>/);
    assert.ok(!String(calls[0].init.body).includes('test-secret'));
  });

  it('keeps its instructions and portfolio prefix identical across visitors, questions and histories', async () => {
    const first = await collect(streamed([delta('Hello.'), completed()]));
    const second = await collect(streamed([delta('Hello.'), completed()]), { question: 'What can he build?', history: [{ q: 'Hello', a: 'Hello.' }] });
    const a = JSON.parse(String(first.calls[0].init.body));
    const b = JSON.parse(String(second.calls[0].init.body));
    assert.equal(a.instructions, b.instructions);
    assert.deepEqual(a.input[0], b.input[0]);
    assert.equal(a.prompt_cache_key, b.prompt_cache_key);
    assert.notDeepEqual(a.input.slice(1), b.input.slice(1));
  });

  it('bounds history, preserves the newest complete turns and treats legacy questions as context', async () => {
    const history = Array.from({ length: 10 }, (_, n) => ({ q: `${n}: ${'q'.repeat(2_100)}`, a: `${n}: ${'a'.repeat(4_100)}` }));
    const { calls } = await collect(streamed([delta('Hello.'), completed()]), { history });
    const body = JSON.parse(String(calls[0].init.body));
    const earlier = body.input.slice(1, -1);
    assert.equal(earlier.length, 8, 'four turns fit the aggregate cap');
    assert.ok(earlier[0].content.includes('6:'));
    assert.ok(earlier.at(-1).content.includes('9:'));
    assert.equal(JSON.parse(earlier[0].content.split('\n')[1]).length, 2_000);
    assert.equal(JSON.parse(earlier[1].content.split('\n')[1]).length, 4_000);
    const legacy = await collect(streamed([delta('Hello.'), completed()]), { prev: ['Where does he work?', 'Since when?'] });
    assert.match(JSON.parse(String(legacy.calls[0].init.body)).input.at(-1).content, /1\. Where does he work\?\n2\. Since when\?/);
  });

  it('streams fragmented UTF-8/CRLF data and finalizes paragraphs with only known unique citations', async () => {
    const recorded = [delta('Daniil works in Zürich. [[site:'), delta('intro]][[site:intro]][[invented]]\n\n'), delta('His educational project is FX Regime Radar. [[project:finance]]'), completed()];
    for (const size of [1, 3, 7, 64, 4_096]) {
      const { events } = await collect(streamed(recorded, size, '\r\n'));
      assert.deepEqual(events.filter((event) => event.event === 'block'), [
        { event: 'block', data: { t: 'Daniil works in Zürich.\n\n', c: ['site:intro'] } },
        { event: 'block', data: { t: 'His educational project is FX Regime Radar.', c: ['project:finance'] } },
      ]);
      assert.equal(events.filter((event) => event.event === 'delta').length, 3);
      assert.deepEqual(events.at(-1), { event: 'done', data: { stop: 'end_turn', usage: { in: 130, out: 35, cr: 110, cw: 0 } } });
    }
  });

  it('yields the first delta before the model finishes and cancels its reader on early return', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(wire([delta('He works')])); },
      cancel() { cancelled = true; },
    });
    const generate = streamOpenAI(input(), (async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch);
    assert.equal((await generate.next()).value?.event, 'status');
    assert.deepEqual((await generate.next()).value, { event: 'delta', data: { t: 'He works' } });
    await generate.return(undefined);
    assert.equal(cancelled, true);
  });

  it('does not duplicate completed text, but recovers a final text snapshot when there were no deltas', async () => {
    const full = 'Daniil is an AI research engineer. [[site:intro]]';
    const snapshot = completed({ output: [{ type: 'message', content: [{ type: 'output_text', text: full }] }] });
    for (const recorded of [[delta(full), { type: 'response.output_text.done', text: full }, snapshot], [snapshot]]) {
      const { events } = await collect(streamed(recorded));
      assert.equal(events.filter((event) => event.event === 'delta').length, 1);
      assert.deepEqual(events.filter((event) => event.event === 'block'), [{ event: 'block', data: { t: 'Daniil is an AI research engineer.', c: ['site:intro'] } }]);
    }
    const multiPart = await collect(streamed([
      { type: 'response.output_text.done', text: 'Daniil is an AI research engineer. [[site:intro]]\n\n' },
      completed({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Daniil is an AI research engineer. [[site:intro]]\n\n' }, { type: 'output_text', text: 'His educational project is FX Regime Radar. [[project:finance]]' }] }] }),
    ]));
    assert.equal(multiPart.events.filter((event) => event.event === 'block').length, 2);
    assert.equal(multiPart.events.at(-1)?.event, 'done');
  });

  it('reports refusal and output-token truncation distinctly, without inventing cache-write usage', async () => {
    const refusal = await collect(streamed([{ type: 'response.refusal.delta', delta: 'I cannot help with that.' }, completed()]));
    assert.equal(refusal.events.at(-1)?.event, 'done');
    assert.equal((refusal.events.at(-1)?.data as { stop: string }).stop, 'refusal');
    const truncated = await collect(streamed([delta('Daniil works in AI. [[site:intro]]'), { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 10, output_tokens: 1_024 } } }]));
    assert.deepEqual(truncated.events.at(-1), { event: 'done', data: { stop: 'max_tokens', usage: { in: 10, out: 1_024, cr: 0, cw: 0 } } });
  });

  it('maps HTTP/stream errors and disconnected or malformed streams to errors rather than successful completion', async () => {
    const cases: [Response | (() => Promise<Response>), string][] = [
      [new Response('Rate limit', { status: 429 }), 'overloaded'],
      [new Response('Bad gateway', { status: 502 }), 'upstream'],
      [new Response('{}', { headers: { 'Content-Type': 'application/json' } }), 'upstream'],
      [() => Promise.reject(new TypeError('Network unavailable')), 'upstream'],
      [streamed([{ type: 'response.failed', response: { error: { code: 'rate_limit_exceeded' } } }]), 'overloaded'],
      [streamed([{ type: 'error', code: 'server_error' }]), 'upstream'],
      [streamed([delta('Partial text')]), 'upstream'],
      [new Response('data: {broken}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 'upstream'],
      [streamed([{ type: 'response.incomplete', response: { incomplete_details: { reason: 'unknown' } } }]), 'upstream'],
      [streamed([completed()]), 'upstream'],
      [streamed([delta('One answer.'), completed({ output: [{ content: [{ type: 'output_text', text: 'A different answer.' }] }] })]), 'upstream'],
    ];
    for (const [response, code] of cases) {
      const { events } = await collect(response);
      assert.deepEqual(events.at(-1), { event: 'error', data: { code } });
      assert.ok(!events.some((event) => event.event === 'done'));
    }
  });

  it('bounds question, event and output sizes before yielding them to the browser', async () => {
    const longQuestion = await collect(streamed([completed()]), { question: 'x'.repeat(2_001) });
    assert.equal(longQuestion.calls.length, 0);
    assert.deepEqual(longQuestion.events, [{ event: 'error', data: { code: 'upstream' } }]);
    const largeOutput = await collect(streamed([delta('x'.repeat(24_001)), completed()]));
    assert.deepEqual(largeOutput.events, [{ event: 'status', data: { s: 'thinking' } }, { event: 'error', data: { code: 'upstream' } }]);
    const largeEvent = await collect(new Response(`data: ${'x'.repeat(131_073)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }));
    assert.deepEqual(largeEvent.events.at(-1), { event: 'error', data: { code: 'upstream' } });
  });

  it('honors abort before fetch and cancels a stalled stream without emitting done', async () => {
    const before = new AbortController();
    before.abort();
    await assert.rejects(collect(streamed([completed()]), { signal: before.signal }), { name: 'AbortError' });
    let cancelled = false;
    const during = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(wire([delta('Working')])); },
      cancel() { cancelled = true; },
    });
    const generate = streamOpenAI(input({ signal: during.signal }), (async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch);
    await generate.next();
    await generate.next();
    const waiting = generate.next();
    during.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(cancelled, true);
  });
});
