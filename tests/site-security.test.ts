import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import gateway from '../worker/site/index.mjs';
import { privatePath, secureHeaders } from '../worker/site/security.mjs';

const request = (path = '/', method = 'GET') => new Request(`https://demtsev.com${path}`, {
  method, headers: { 'CF-Connecting-IP': '192.0.2.1', Cookie: 'private-cookie', Authorization: 'private-token', Range: 'bytes=0-9' },
});

test('CSP pins inline scripts, scopes preview runtimes and restricts browser capabilities', () => {
  const headers = secureHeaders({ 'Set-Cookie': 'upstream-private', 'Content-Type': 'text/html' });
  const csp = headers.get('content-security-policy')!;
  assert.equal(headers.get('set-cookie'), null);
  assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('strict-transport-security'), 'max-age=31536000');
  assert.match(headers.get('permissions-policy')!, /microphone=\(\)/);
  const script = csp.split('; ').find(p => p.startsWith('script-src '))!;
  assert.match(script, /sha256-/);
  assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"));
  assert.ok(!script.includes('cdn.jsdelivr.net'));
  for (const directive of ["script-src-attr 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'none'", "connect-src 'self'", "frame-ancestors 'self'"]) assert.ok(csp.includes(directive));
  for (const path of ['/architecture/', '/architecture/index.html', '/drawings/', '/drawings/index.html']) {
    const preview = secureHeaders({}, path).get('content-security-policy')!;
    assert.equal(preview.match(/https:\/\/cdn.jsdelivr.net/g)?.length, 3);
    assert.ok(!preview.includes("'unsafe-eval'"));
    assert.ok(!preview.includes('https://cdn.jsdelivr.net;'), 'Entire CDN is never trusted');
  }
});

test('configuration, hidden paths and encoded probes are blocked; public assets remain available', () => {
  for (const path of ['/.env', '/.git/config', '/%2eenv', '/%252eenv', '/worker/wrangler.jsonc', '/src/data/chat.ts', '/me/about.txt', '/node_modules/foo', '/package-lock.json', '/AGENTS.md', '/wp-login.php', '/xmlrpc.php', '/%xx']) assert.equal(privatePath(path), true, path);
  for (const path of ['/', '/smart-watch/', '/watch/facts.v1.json', '/docs/daniil-emtsev-cv.pdf', '/.well-known/security.txt', '/architecture/model/config.json']) assert.equal(privatePath(path), false, path);
});

test('gateway rejects probes, disallowed methods and excessive traffic before upstream work', async t => {
  let upstreamCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { upstreamCalls++; throw new Error('No upstream request allowed'); });
  const env = { RL_SITE: { limit: async () => ({ success: false }) } };
  for (const [path, method, expected] of [['/.env', 'GET', 404], ['/.git/config', 'HEAD', 404], ['/', 'POST', 405], ['/', 'GET', 429]] as const) {
    const response = await gateway.fetch(request(path, method), env);
    assert.equal(response.status, expected);
    assert.match(response.headers.get('content-security-policy')!, /object-src 'none'/);
  }
  const rate = await gateway.fetch(request(), env);
  assert.equal(rate.headers.get('retry-after'), '60');
  assert.equal(rate.headers.get('cache-control'), 'no-store');
  const failedLimiter = await gateway.fetch(request(), { RL_SITE: { limit: async () => { throw new Error('private binding details'); } } });
  assert.equal(failedLimiter.status, 503);
  assert.ok(!(await failedLimiter.text()).includes('private binding details'));
  assert.equal(upstreamCalls, 0);
});

test('gateway keeps HEAD/range behavior, strips credentials and protects redirects and failures', async t => {
  let call: { url: string; method: string; headers: Headers } | undefined;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    call = { url: String(url), method: init.method!, headers: init.headers as Headers };
    return new Response(null, { status: 206, headers: { 'Content-Range': 'bytes 0-9/100', 'Set-Cookie': 'private', 'Location': 'https://daniil-777.github.io/work/' } });
  });
  const result = await gateway.fetch(request('/video.mp4?test=1', 'HEAD'), { RL_SITE: { limit: async ({ key }: { key: string }) => { assert.equal(key, '192.0.2.1'); return { success: true }; } } });
  assert.equal(result.status, 206);
  assert.equal(result.headers.get('content-range'), 'bytes 0-9/100');
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(result.headers.get('location'), 'https://demtsev.com/work/');
  assert.equal(call!.url, 'https://daniil-777.github.io/video.mp4?test=1');
  assert.equal(call!.method, 'HEAD');
  assert.equal(call!.headers.get('range'), 'bytes=0-9');
  assert.equal(call!.headers.get('cookie'), null);
  assert.equal(call!.headers.get('authorization'), null);
  const canonical = await gateway.fetch(new Request('http://www.demtsev.com/?lang=en'));
  assert.equal(canonical.status, 308);
  assert.equal(canonical.headers.get('location'), 'https://demtsev.com/?lang=en');
  assert.equal((await gateway.fetch(new Request('https://wrong.example/'))).status, 404);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private upstream failure'); });
  const failed = await gateway.fetch(request());
  assert.equal(failed.status, 502);
  assert.match(failed.headers.get('content-security-policy')!, /default-src 'self'/);
  assert.ok(!(await failed.text()).includes('private upstream failure'));
});

test('published home and answers page freeze every public Ask AI trigger', () => {
  assert.match(readFileSync('src/data/chat-status.ts', 'utf8'), /CHAT_ENABLED = false/);
  assert.match(readFileSync('worker/wrangler.jsonc', 'utf8'), /"CHAT_ENABLED": "false"/);
  assert.match(readFileSync('worker/wrangler.jsonc', 'utf8'), /"DAILY_LIMIT": "0"/);
  for (const path of ['build/index.html', 'build/ask/index.html']) {
    const html = readFileSync(path, 'utf8');
    assert.ok(!html.includes('data-chat-open'), path);
    assert.ok(!html.includes('id="chat-dialog"'), path);
    assert.match(html, /<button[^>]*disabled[^>]*data-chat-paused/);
    assert.ok(html.includes('temporarily paused') || html.includes('Assistant paused'));
  }
});

test('book model downloads have a narrow CDN allowlist without cloud chat or local services', () => {
  const csp = secureHeaders(new Headers(), '/').get('Content-Security-Policy')!;
  const connect = csp.split(';').find(rule => rule.trim().startsWith('connect-src'))!.trim();
  assert.equal(connect, "connect-src 'self' https://huggingface.co https://us.aws.cdn.hf.co");
  assert.ok(!csp.includes('demtsev-chat') && !csp.includes('127.0.0.1') && !csp.includes('localhost'));
});
