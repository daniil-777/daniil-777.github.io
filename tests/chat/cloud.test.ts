import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeSse, validateRequest, type ChatEvent } from '../../src/lib/chat/protocol.ts';
import type { GenEvent } from '../../src/lib/chat/types.ts';
import { createCloud } from '../../src/scripts/chat/cloud.ts';
import { ChatError } from '../../src/scripts/chat/pipeline.ts';

const usage = { in: 12000, out: 80, cr: 11900, cw: 0 };
const recorded: ChatEvent[] = [
  { event: 'meta', data: { v: 1, kb: '0123456789abcdef', model: 'claude-opus-5-5' } },
  { event: 'status', data: { s: 'thinking' } },
  { event: 'block', data: { t: 'Daniil works at VirtaMed.', c: ['journey:virtamed'] } },
  { event: 'block', data: { t: 'He is based in Zürich.', c: [] } },
  { event: 'done', data: { stop: 'end_turn', usage } },
];

/** A reply whose body arrives in pieces of `size` bytes. */
function streamed(events: ChatEvent[], size: number): Response {
  const bytes = new TextEncoder().encode(`: hello\n\n${events.map(encodeSse).join('')}`);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

const failure = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: 'no' } }), { status, headers: { 'Content-Type': 'application/json' } });

async function collect(reply: Response | (() => Promise<Response>), input = { question: 'Where does he work?', prev: [] as string[] }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof reply === 'function' ? reply() : reply;
  }) as typeof fetch;
  const events: GenEvent[] = [];
  for await (const event of createCloud('https://chat.example', fetcher).generate({ ...input, chunks: [] }, new AbortController().signal)) events.push(event);
  return { events, calls };
}

const reasonOf = (reply: Response | (() => Promise<Response>)) =>
  collect(reply).then(
    () => 'no error',
    (error) => (error instanceof ChatError ? error.reason : `other: ${error}`),
  );

describe('cloud generator', () => {
  it('transports conversation context and immediate text deltas', async () => {
    const history = [{ q: 'What is Pixel Morph?', a: 'It runs generative models in the browser.' }];
    const response = streamed([recorded[0], { event: 'delta', data: { t: 'Here is' } }, recorded[4]], 1);
    let body = '';
    const fetcher = (async (_url: string, init: RequestInit) => { body = String(init.body); return response; }) as typeof fetch;
    const events = [];
    for await (const event of createCloud('https://chat.example', fetcher).generate({ question: 'Show its demo', prev: [], history, chunks: [] }, new AbortController().signal)) events.push(event);
    assert.deepEqual(JSON.parse(body).history, history);
    assert.deepEqual(events[1], { type: 'delta', text: 'Here is' });
    assert.equal(createCloud('https://chat.example').conversational, true);
  });
  it('sends only the question and earlier questions, in the shape the Worker accepts', async () => {
    const { calls } = await collect(streamed(recorded, 64), { question: 'What did he build there?', prev: ['Where does he work?'] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://chat.example/v1/chat');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body, { v: 1, q: 'What did he build there?', prev: ['Where does he work?'] });
    assert.equal(validateRequest(body).ok, true);
  });

  it('leaves out an empty list of earlier questions', async () => {
    const { calls } = await collect(streamed(recorded, 64));
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { v: 1, q: 'Where does he work?' });
  });

  it('turns the stream into events, however it is cut', async () => {
    for (const size of [1, 3, 7, 64, 4096]) {
      const { events } = await collect(streamed(recorded, size));
      assert.deepEqual(events, [
        { type: 'status' },
        { type: 'status' },
        { type: 'block', text: 'Daniil works at VirtaMed.', cites: ['journey:virtamed'] },
        { type: 'block', text: 'He is based in Zürich.', cites: [] },
        { type: 'done', stop: 'end_turn', usage },
      ]);
    }
  });

  it('reports why the service did not answer', async () => {
    assert.equal(await reasonOf(failure(429, 'rate')), 'busy');
    // Cloudflare's own rate limiting answers without the Worker's JSON body.
    assert.equal(await reasonOf(new Response('Too many requests', { status: 429 })), 'busy');
    assert.equal(await reasonOf(failure(503, 'rate')), 'busy');
    assert.equal(await reasonOf(failure(503, 'budget')), 'budget');
    assert.equal(await reasonOf(failure(429, 'credits')), 'credits');
    assert.equal(await reasonOf(failure(503, 'upstream')), 'failed');
    assert.equal(await reasonOf(new Response('<html>Bad gateway</html>', { status: 502 })), 'failed');
    assert.equal(await reasonOf(new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })), 'failed');
    assert.equal(await reasonOf(() => Promise.reject(new TypeError('Failed to fetch'))), 'other: TypeError: Failed to fetch');
  });

  it('reports an error sent inside the stream', async () => {
    assert.equal(await reasonOf(streamed([recorded[0], { event: 'error', data: { code: 'credits' } }], 16)), 'credits');
    assert.equal(await reasonOf(streamed([recorded[0], { event: 'error', data: { code: 'budget' } }], 16)), 'budget');
    assert.equal(await reasonOf(streamed([recorded[0], { event: 'error', data: { code: 'overloaded' } }], 16)), 'busy');
    assert.equal(await reasonOf(streamed([recorded[0], recorded[2], { event: 'error', data: { code: 'upstream' } }], 16)), 'failed');
  });

  it('closes the connection when the answer is read, and when the reader stops early', async () => {
    const cancelled = { count: 0 };
    const watched = () => {
      const bytes = new TextEncoder().encode(recorded.map(encodeSse).join(''));
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(bytes);
        },
        cancel() {
          cancelled.count += 1;
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const generate = () => createCloud('https://chat.example', (async () => watched()) as unknown as typeof fetch).generate({ question: 'q', prev: [], chunks: [] }, new AbortController().signal);
    // The body never ends by itself: only cancelling the reader closes it.
    for await (const event of generate()) if (event.type === 'done') break;
    assert.equal(cancelled.count, 1);
    for await (const event of generate()) if (event.type === 'block') break;
    assert.equal(cancelled.count, 2);
  });

  it('ignores a block that is not text and ids that are not strings', async () => {
    const odd = [{ event: 'block', data: { t: 5, c: [] } }, { event: 'block', data: { t: 'Fine.', c: ['a', 7] } }, recorded[4]] as unknown as ChatEvent[];
    const { events } = await collect(streamed(odd, 32));
    assert.deepEqual(events.slice(0, 1), [{ type: 'block', text: 'Fine.', cites: ['a', '7'] }]);
  });
});
