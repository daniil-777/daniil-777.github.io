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

const freshGateway = async () => (await import(`../worker/site/index.mjs?test=${Math.random()}`)).default;
function fallbackEnvironment(release: string, stored?: string) {
  const values = new Map(stored ? [[`origin-ready:${release}`, stored]] : []);
  return {
    FALLBACK_RELEASE: release,
    ORIGIN_STATE: { get: async (key: string) => values.get(key), put: async (key: string, value: string) => { values.set(key, value); } },
    ASSETS: { fetch: async (_request: Request) => new Response('tested snapshot', { headers: { 'set-cookie': 'never=forward' } }) },
    values,
  };
}

test('fallback serves sanitized assets on wrong release, coalesces probes and preserves canonical redirects', async () => {
  const worker = await freshGateway();
  const env = fallbackEnvironment('tested-release');
  let assetCalls = 0;
  env.ASSETS.fetch = async (request) => {
    assetCalls++;
    assert.equal(request.headers.get('cookie'), null);
    assert.equal(request.headers.get('authorization'), null);
    assert.equal(request.headers.get('range'), 'bytes=0-2');
    return new Response('abc', { status: 206, headers: { 'content-range': 'bytes 0-2/100', 'set-cookie': 'never=forward' } });
  };
  const origin = mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://daniil-777.github.io/watch/release.json');
    assert.equal(new Headers(init?.headers).get('cookie'), null);
    return Response.json({ release: 'other-release' });
  });
  try {
    const responses = await Promise.all([1, 2].map(() => worker.fetch(new Request('https://demtsev.com/file.mp4', { headers: { range: 'bytes=0-2', cookie: 'private=1', authorization: 'private' } }), env)));
    for (const response of responses) { assert.equal(response.status, 206); assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('content-range'), 'bytes 0-2/100'); }
    assert.equal(assetCalls, 2);
    assert.equal(origin.mock.callCount(), 1);
    assert.equal(env.values.size, 0);
    assert.equal((await worker.fetch(new Request('https://www.demtsev.com/file?x=1'), env)).headers.get('location'), 'https://demtsev.com/file?x=1');
  } finally { origin.mock.restore(); }
});

test('matching release records durable handoff and future isolates use origin without probing', async () => {
  const worker = await freshGateway();
  const env = fallbackEnvironment('tested-release');
  env.ASSETS.fetch = async () => { throw new Error('snapshot must not be used'); };
  let probes = 0;
  const origin = mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/watch/release.json')) { probes++; return Response.json({ release: 'tested-release' }); }
    return new Response('future origin');
  });
  try {
    assert.equal(await (await worker.fetch(new Request('https://demtsev.com/'), env)).text(), 'future origin');
    assert.equal(env.values.get('origin-ready:tested-release'), 'true');
    const restarted = await freshGateway();
    assert.equal(await (await restarted.fetch(new Request('https://demtsev.com/next/'), env)).text(), 'future origin');
    assert.equal(probes, 1);
  } finally { origin.mock.restore(); }
});

test('fallback misses proxy large videos, external demos and genuine missing pages', async () => {
  const worker = await freshGateway();
  const env = fallbackEnvironment('tested-release');
  env.ASSETS.fetch = async () => new Response('missing snapshot', { status: 404 });
  const origin = mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/watch/release.json')) return new Response('missing', { status: 404 });
    assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-2');
    const path = new URL(String(input)).pathname;
    return new Response(path, { status: path === '/missing/' ? 404 : path.endsWith('.mp4') ? 206 : 200 });
  });
  try {
    for (const [path, status] of [['/media/video/large.mp4', 206], ['/Universal-Spaceship/', 200], ['/missing/', 404]] as const) {
      const response = await worker.fetch(new Request(`https://demtsev.com${path}`, { headers: { range: 'bytes=0-2' } }), env);
      assert.equal(response.status, status); assert.equal(await response.text(), path);
    }
  } finally { origin.mock.restore(); }
});

test('origin probe network failure keeps the tested assets available', async () => {
  const worker = await freshGateway();
  const env = fallbackEnvironment('tested-release');
  const origin = mock.method(globalThis, 'fetch', async () => { throw new Error('private failure'); });
  try {
    const response = await worker.fetch(new Request('https://demtsev.com/'), env);
    assert.equal(response.status, 200); assert.equal(await response.text(), 'tested snapshot');
    assert.equal(env.values.size, 0);
  } finally { origin.mock.restore(); }
});
