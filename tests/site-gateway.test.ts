import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../worker/site/index.mjs';

test('domain gateway streams video ranges without forwarding credentials', async () => {
  const origin = mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://daniil-777.github.io/media/video/demo.mp4?lang=de');
    assert.equal(init?.redirect, 'manual');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('range'), 'bytes=0-2');
    assert.equal(headers.get('if-range'), 'video-v1');
    assert.equal(headers.get('cookie'), null);
    assert.equal(headers.get('authorization'), null);
    return new Response(new Uint8Array([0, 128, 255]), { status: 206, headers: { 'content-range': 'bytes 0-2/100', 'accept-ranges': 'bytes', etag: 'video-v1', 'set-cookie': 'upstream-session=private' } });
  });
  try {
    const response = await gateway.fetch(new Request('https://demtsev.com/media/video/demo.mp4?lang=de', { headers: { range: 'bytes=0-2', 'if-range': 'video-v1', cookie: 'private=secret', authorization: 'Bearer private' } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-2/100');
    assert.equal(response.headers.get('etag'), 'video-v1');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 128, 255]);
  } finally { origin.mock.restore(); }
});

test('domain gateway canonicalizes HTTPS and www while preserving paths and queries', async () => {
  const origin = mock.method(globalThis, 'fetch', async () => { throw new Error('must not reach origin'); });
  try {
    for (const url of ['http://demtsev.com/work/ai-proctor/?lang=fr', 'https://www.demtsev.com/work/ai-proctor/?lang=fr']) {
      const response = await gateway.fetch(new Request(url));
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), 'https://demtsev.com/work/ai-proctor/?lang=fr');
    }
    assert.equal((await gateway.fetch(new Request('https://demtsev.com/', { method: 'POST', body: 'private question' }))).status, 405);
    assert.equal((await gateway.fetch(new Request('https://unknown.example/'))).status, 404);
    assert.equal(origin.mock.callCount(), 0);
  } finally { origin.mock.restore(); }
});

test('domain gateway keeps slash redirects on the custom domain and HEAD on a fixed origin', async () => {
  const origin = mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new URL(String(input)).hostname, 'daniil-777.github.io');
    assert.equal(init?.method, 'HEAD');
    return new Response(null, { status: 301, headers: { location: 'https://daniil-777.github.io/work/ai-proctor/?lang=ru' } });
  });
  try {
    const response = await gateway.fetch(new Request('https://demtsev.com/work/ai-proctor?lang=ru', { method: 'HEAD' }));
    assert.equal(response.headers.get('location'), 'https://demtsev.com/work/ai-proctor/?lang=ru');
    await gateway.fetch(new Request('https://demtsev.com//other.example/path', { method: 'HEAD' }));
  } finally { origin.mock.restore(); }
});

test('domain gateway reports origin failures without exposing internal errors', async () => {
  const origin = mock.method(globalThis, 'fetch', async () => { throw new Error('private upstream details'); });
  try {
    const response = await gateway.fetch(new Request('https://demtsev.com/'));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /private upstream/);
  } finally { origin.mock.restore(); }
});
