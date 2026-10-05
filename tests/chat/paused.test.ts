import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { type Env } from '../../worker/src/index.ts';

test('paused chat rejects direct and forged-origin requests before body, budget or provider work', async t => {
  let serviceCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { serviceCalls++; throw new Error('Must not fetch any upstream'); });
  t.mock.method(console, 'log', () => {});
  const forbidden = () => { serviceCalls++; throw new Error('Must not call bindings'); };
  for (const enabled of [undefined, 'false', 'TRUE', '1', '']) {
    const env = { CHAT_ENABLED: enabled, OPENAI_API_KEY: 'test-placeholder', ALLOWED_ORIGINS: 'https://demtsev.com',
      RL_IP: { limit: forbidden }, RL_ALL: { limit: forbidden }, BUDGET: { idFromName: forbidden, get: forbidden } } as unknown as Env;
    for (const origin of ['', 'https://demtsev.com', 'https://evil.example']) {
      for (const method of ['POST', 'GET', 'OPTIONS']) {
        const request = new Request('https://chat-test.example/v1/chat', { method,
          headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: 'deliberately invalid JSON' } : {}) });
        const result = await worker.fetch(request, env);
        assert.equal(result.status, 503);
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.equal(result.headers.get('retry-after'), '3600');
        assert.match((await result.json()).error.message, /temporarily paused/);
        assert.equal(request.bodyUsed, false, 'Disabled endpoint does not read untrusted input');
      }
    }
  }
  assert.equal(serviceCalls, 0, 'No paid API, KB, rate limiter or budget call can occur');
});
