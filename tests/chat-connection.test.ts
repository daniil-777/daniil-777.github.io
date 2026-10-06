import assert from 'node:assert/strict';
import test from 'node:test';
import { chatConnection } from '../src/lib/chat/connection.ts';
import { createCloud } from '../src/scripts/chat/cloud.ts';
import { generateAnswer } from '../src/scripts/chat/pipeline.ts';

test('Ask AI retains its cloud configuration and validates local endpoint overrides', () => {
  const cloud = 'https://assistant.example';
  assert.deepEqual(chatConnection({ PUBLIC_CHAT_ENDPOINT: ` ${cloud} ` }), { local: '', endpoint: cloud });
  assert.deepEqual(chatConnection({ PUBLIC_CHAT_ENDPOINT: cloud, PUBLIC_LOCAL_CHAT_ENDPOINT: ' http://127.0.0.1:8788/ ' }), {
    local: 'http://127.0.0.1:8788/', endpoint: 'http://127.0.0.1:8788/',
  });
  for (const invalid of ['https://untrusted.example', 'http://localhost.evil.example', 'http://localhost:8788/private', 'http://user:secret@localhost:8788']) {
    assert.deepEqual(chatConnection({ PUBLIC_CHAT_ENDPOINT: cloud, PUBLIC_LOCAL_CHAT_ENDPOINT: invalid }), { local: '', endpoint: cloud });
  }
});

test('Ask AI cloud transport sends only the explicit prompt with no browser API key', async () => {
  const endpoint = chatConnection({ PUBLIC_CHAT_ENDPOINT: 'https://assistant.example' }).endpoint;
  const question = 'Explain transformer attention in one sentence.';
  const text = 'A transformer uses attention to connect tokens and build useful representations from the context around them.';
  let calls = 0;
  const generator = createCloud(endpoint, (async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(input), `${endpoint}/v1/chat`);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.deepEqual(JSON.parse(String(init?.body)), { v: 1, q: question, locale: 'en' });
    const stream = `event: block\ndata: ${JSON.stringify({ t: text, c: [] })}\n\nevent: done\ndata: {"stop":"end_turn"}\n\n`;
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch);
  assert.equal(calls, 0, 'constructing a provider never asks the model');
  const answer = await generateAnswer({ generator, question, prev: [], chunks: [], byId: new Map(), locale: 'en', stop: new AbortController().signal });
  assert.equal(calls, 1);
  assert.equal(answer.kind, 'answer');
  if (answer.kind === 'answer') { assert.deepEqual(answer.blocks, [text]); assert.deepEqual(answer.cites, []); }
});
