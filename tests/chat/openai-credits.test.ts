import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAIError, openAIHttpError } from '../../worker/src/openai-errors.ts';
import { streamOpenAI } from '../../worker/src/openai.ts';
import { createCloud } from '../../src/scripts/chat/cloud.ts';
import { generateAnswer, conversationHistory, earlier } from '../../src/scripts/chat/pipeline.ts';
import { encodeSse } from '../../src/lib/chat/protocol.ts';

const input = { apiKey: 'test-placeholder', model: 'gpt-6-luna', question: 'Explain overfitting', chunks: [], prev: [], hash: 'fixture', signal: new AbortController().signal };
for (const code of ['credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'insufficient_quota']) {
  test(`HTTP and SSE preserve billing code ${code}`, async () => {
    const error = { code, type: 'insufficient_quota', message: 'secret upstream detail' };
    const responses = [Response.json({ error }, { status: 429 }),
      new Response(`data: ${JSON.stringify({ type: 'error', error })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }),
      new Response(`data: ${JSON.stringify({ type: 'response.failed', response: { error } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })];
    for (const response of responses) {
      const events = [];
      for await (const event of streamOpenAI(input, (async () => response) as typeof fetch)) events.push(event);
      assert.deepEqual(events.at(-1), { event: 'error', data: { code: 'credits' } });
      assert.ok(!JSON.stringify(events).includes('secret upstream detail'));
    }
  });
}
test('type-only quota signals and rate limits remain distinct', async () => {
  assert.equal(openAIError({ type: 'insufficient_quota' }, 429), 'credits');
  for (const code of ['rate_limit_exceeded', 'rate_limit_error', 'slow_down', 'server_is_overloaded']) assert.equal(openAIError({ code }), 'overloaded');
  assert.equal(await openAIHttpError(new Response('not JSON', { status: 429 })), 'overloaded');
  assert.equal(await openAIHttpError(new Response('not JSON', { status: 502 })), 'upstream');
});
test('oversized error bodies are canceled and never treated as proven credits exhaustion', async () => {
  for (const headers of [new Headers(), new Headers({ 'content-length': '20000' })]) {
    let canceled = false;
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20_000)); }, cancel() { canceled = true; } });
    assert.equal(await openAIHttpError(new Response(body, { status: 429, headers })), 'overloaded'); assert.equal(canceled, true);
  }
});
test('provider credit errors pass through the browser transport and guarded pipeline', async () => {
  const upstream = [];
  for await (const event of streamOpenAI(input, (async () => Response.json({ error: { code: 'credit_balance_exhausted' } }, { status: 429 })) as typeof fetch)) upstream.push(event);
  const response = new Response(upstream.map(encodeSse).join(''), { headers: { 'content-type': 'text/event-stream' } });
  const generator = createCloud('https://chat-test.example', (async () => response) as typeof fetch);
  assert.deepEqual(await generateAnswer({ generator, question: input.question, prev: [], chunks: [], byId: new Map(), stop: input.signal }), { kind: 'fallback', reason: 'credits' });
});
test('cloud to local conversation continuity never enables local to cloud uploads', () => {
  const turns = [{ q: 'Explain overfitting', sent: true, answer: { mode: 'cloud', text: ['Training noise is memorized.'] } },
    { q: 'Private local example', sent: true, answer: { mode: 'device', text: ['A local response.'] } }];
  assert.deepEqual(conversationHistory(turns, 'device').map(t => t.q), ['Explain overfitting', 'Private local example']);
  assert.deepEqual(conversationHistory(turns, 'cloud').map(t => t.q), ['Explain overfitting']);
  assert.deepEqual(earlier(turns), ['Explain overfitting']);
});
