import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ollamaAnswer } from '../../scripts/ask-ai/ollama.mjs';
import type { Chunk } from '../../src/lib/chat/kb.ts';

const source: Chunk = { id: 'fact:role', kind: 'fact', title: 'Role', heading: '', tags: [], asks: [], url: '/#journey', text: 'Daniil works at VirtaMed.' };
const input = { question: 'Where does Daniil work?', chunks: [source] };
const encoder = new TextEncoder();
function stream(lines: object[], fragment = 7) {
  const bytes = encoder.encode(lines.map(line => JSON.stringify(line)).join('\n'));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += fragment) controller.enqueue(bytes.slice(i, i + fragment));
    controller.close();
  } }));
}
const collect = async (options: object) => { const events = []; for await (const event of ollamaAnswer(input, options)) events.push(event); return events; };

test('local NDJSON survives byte fragmentation, Unicode and split citations', async () => {
  let request: RequestInit | undefined;
  const events = await collect({ fetcher: async (_url: string, options: RequestInit) => {
    request = options;
    return stream([{ message: { content: 'Daniil works at VirtaMed — Zürich. [[fact:' } }, { message: { content: 'role]]\n\nRelated details.' } }, { done: true, done_reason: 'length', eval_count: 10, eval_duration: 1e9 }]);
  } });
  assert.equal(request!.redirect, 'error');
  assert.equal(JSON.parse(request!.body as string).think, false);
  assert.deepEqual(events.filter(e => e.type === 'block'), [
    { type: 'block', text: 'Daniil works at VirtaMed — Zürich.', cites: ['fact:role'] },
    { type: 'block', text: 'Related details.', cites: [] },
  ]);
  const done = events.at(-1); assert.ok(done?.usage);
  assert.equal(done.stop, 'max_tokens');
  assert.equal(done.usage.tokensPerSecond, 10);
});
test('paragraphs stream before completion and returning cancels the reader', async () => {
  let canceled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'Daniil works at VirtaMed. [[fact:role]]\n\n' } }) + '\n')); }, cancel() { canceled = true; } });
  const iterator = ollamaAnswer(input, { fetcher: async () => new Response(body) });
  const delta = await iterator.next(); assert.ok(!delta.done); assert.equal(delta.value.type, 'delta');
  const block = await iterator.next(); assert.ok(!block.done); assert.equal(block.value.type, 'block');
  await iterator.return(); assert.equal(canceled, true);
});
test('unknown citations and incomplete streams fail closed', async () => {
  await assert.rejects(collect({ fetcher: async () => stream([{ message: { content: 'Claim [[private:secret]]' } }, { done: true }]) }), /unknown source/);
  await assert.rejects(collect({ fetcher: async () => stream([{ message: { content: 'No completion' } }]) }), /without completion/);
});
test('remote endpoints, cloud models and redirects cannot become local inference', async () => {
  const fetcher = async () => { throw new Error('unexpected fetch'); };
  for (const base of ['https://example.com', 'file:///tmp/model', 'http://localhost.evil.example']) await assert.rejects(collect({ base, fetcher }), /loopback/);
  for (const model of ['remote-cloud', 'https://example.com/model', 'model with spaces']) await assert.rejects(collect({ model, fetcher }), /local model/);
});
test('output and HTTP failures are bounded and the abort signal is passed through', async () => {
  await assert.rejects(collect({ fetcher: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(collect({ fetcher: async () => stream([{ message: { content: 'x'.repeat(25_000) } }], 100_000) }), /too large/);
  const signal = new AbortController().signal;
  await collect({ signal, fetcher: async (_url: string, options: RequestInit) => { assert.equal(options.signal, signal); return stream([{ done: true }]); } });
});
