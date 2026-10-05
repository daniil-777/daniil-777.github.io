/** The actual Worker, OpenAI adapter, browser transport and answer guard in one flow. */
import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import worker, { Budget, type Env } from '../../worker/src/index.ts';
import { createCloud } from '../../src/scripts/chat/cloud.ts';
import { generateAnswer } from '../../src/scripts/chat/pipeline.ts';
import { parseSse } from '../../src/lib/chat/protocol.ts';
import type { Kb } from '../../src/lib/chat/kb.ts';

const kb: Kb = JSON.parse(await readFile(new URL('../../build/chat/kb.json', import.meta.url), 'utf8'));
const byId = new Map(kb.chunks.map((chunk) => [chunk.id, chunk]));
const ORIGIN = 'https://demtsev.com';
const wire = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
let sequence = 0;

function fixture(t: TestContext, output: string, extra: Partial<Env> = {}, failure?: number, stall = false) {
  const requests: { url: string; headers: Headers; body: Record<string, any> }[] = [];
  const logs: string[] = [];
  let cancelled = false;
  const stored = new Map();
  const budget = new Budget({ storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); } } } as never);
  const env = {
    CHAT_PROVIDER: 'openai', OPENAI_API_KEY: 'server-secret', OPENAI_BASE_URL: 'https://api-test.example/v1',
    ALLOWED_ORIGINS: ORIGIN, KB_URL: `https://kb-test.example/${sequence++}.json`, DAILY_LIMIT: '100',
    RL_IP: { limit: async () => ({ success: true }) }, RL_ALL: { limit: async () => ({ success: true }) },
    BUDGET: { idFromName: (name: string) => name, get: () => ({ fetch: (url: string) => budget.fetch(new Request(url)) }) }, ...extra,
  } as unknown as Env;
  t.mock.method(console, 'log', (line: string) => logs.push(line));
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === env.KB_URL) return Response.json(kb);
    const body = JSON.parse(await request.clone().text());
    requests.push({ url: request.url, headers: request.headers, body });
    if (request.url === 'https://worker-test.example/v1/chat') {
      const headers = new Headers(request.headers);
      headers.set('Origin', ORIGIN); // browsers add this automatically
      return worker.fetch(new Request(request, { headers }), env);
    }
    assert.equal(request.url, 'https://api-test.example/v1/responses');
    if (failure) return new Response('Upstream unavailable', { status: failure });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(wire({ type: 'response.output_text.delta', delta: output }));
        if (stall) return;
        controller.enqueue(wire({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 20000, output_tokens: 100, input_tokens_details: { cached_tokens: 18000 } } } }));
        controller.close();
      },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const ask = (q: string, history: { q: string; a: string }[] = []) => generateAnswer({
    generator: createCloud('https://worker-test.example'), question: q, prev: [], history,
    chunks: kb.chunks, byId, stop: new AbortController().signal,
  });
  const direct = (body = { v: 1, q: 'What does he do?' }, origin = ORIGIN) => worker.fetch(new Request('https://worker-test.example/v1/chat', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  return { ask, direct, requests, logs, get cancelled() { return cancelled; } };
}

it('answers a hiring question through the OpenAI Worker and preserves grounded conversation history', async (t) => {
  const f = fixture(t, 'Daniil works at VirtaMed in machine-learning research. [[journey:virtamed]]\n\nFinancial managers generally oversee budgeting and reporting. This portfolio does not establish accounting experience.');
  const history = [{ q: 'What is FX Regime Radar?', a: 'A currency-market analytics project.' }];
  const result = await f.ask('Can I hire u for financial manager position?', history);
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') assert.deepEqual(result.cites, ['journey:virtamed']);
  const browser = f.requests.find((r) => r.url.includes('worker-test'))!;
  const api = f.requests.find((r) => r.url.includes('api-test'))!;
  assert.ok(!JSON.stringify(browser.body).includes('server-secret'));
  assert.equal(browser.headers.get('Authorization'), null);
  assert.equal(api.headers.get('Authorization'), 'Bearer server-secret');
  assert.equal(api.body.model, 'gpt-6-luna');
  assert.equal(api.body.store, false);
  assert.equal(JSON.parse(api.body.input[0].content[0].text.split('\n')[1]).length, kb.chunks.length);
  assert.deepEqual(api.body.prompt_cache_options, { mode: 'explicit', ttl: '30m' });
  assert.equal(api.body.service_tier, 'default');
  assert.ok(api.body.input[1].content.includes(history[0].q));
  assert.ok(api.body.input[2].content.includes(history[0].a));
  assert.ok(f.logs.every((line) => !line.includes('financial manager') && !line.includes('server-secret')));
});

it('accepts a general professional explanation without fake personal citations', async (t) => {
  const f = fixture(t, 'A transformer uses attention to relate tokens in a sequence.');
  const result = await f.ask('Explain how a transformer works.');
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') assert.deepEqual(result.cites, []);
});

it('falls back when a model supplies an unsupported personal claim or invented source', async (t) => {
  const f = fixture(t, 'Daniil was employed by Tesla in 2040. [[invented-source]]');
  assert.deepEqual(await f.ask('Where did he work?'), { kind: 'fallback', reason: 'unverified' });
});

it('maps an OpenAI rate-limit error to a useful client fallback', async (t) => {
  const f = fixture(t, '', {}, 429);
  assert.deepEqual(await f.ask('What does he do?'), { kind: 'fallback', reason: 'busy' });
});

it('refuses missing OpenAI configuration and foreign origins before billing calls', async (t) => {
  const f = fixture(t, '', { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: 'other-provider' });
  assert.equal((await f.direct()).status, 503);
  assert.equal((await f.direct(undefined, 'https://evil.example')).status, 403);
  assert.deepEqual(f.requests, []);
});

it('enforces the daily budget with the OpenAI provider', async (t) => {
  const f = fixture(t, 'Daniil works at VirtaMed. [[journey:virtamed]]', { DAILY_LIMIT: '1' });
  assert.equal((await f.ask('What does he do?')).kind, 'answer');
  assert.deepEqual(await f.ask('And his projects?'), { kind: 'fallback', reason: 'budget' });
  assert.equal(f.requests.filter((r) => r.url.includes('api-test')).length, 1);
});

it('ends a stalled OpenAI stream and cancels the upstream response', async (t) => {
  const f = fixture(t, 'Working', { ANSWER_MS: '20' }, undefined, true);
  const response = await f.direct();
  const parser = parseSse();
  const events = [];
  for await (const bytes of response.body!) events.push(...parser.push(bytes));
  assert.equal(events.at(-1)?.event, 'error');
  assert.equal(events.some((event) => event.event === 'done'), false);
  assert.equal(f.cancelled, true);
});
