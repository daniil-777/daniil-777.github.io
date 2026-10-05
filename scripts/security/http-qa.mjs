/** Small, benign read-only probes and invalid-body pause checks; never an attack flood. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.SECURITY_QA_URL ?? 'https://demtsev.com';
const endpoint = process.env.CHAT_PAUSE_QA_URL ?? 'https://demtsev-chat.demtsev-com.workers.dev/v1/chat';
const output = process.env.SECURITY_QA_OUTPUT ?? '/tmp/portfolio-security-live-http';
const results = [];
const get = (url, init = {}) => fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) });
function secured(response) {
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.match(response.headers.get('permissions-policy'), /microphone=\(\)/);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.ok(!csp.split('; ').find(s=>s.startsWith('script-src ')).includes("'unsafe-eval'"));
  return csp;
}
for (const path of ['/', '/ask/', '/smart-watch/', '/architecture/', '/drawings/', '/architecture/index.html', '/drawings/index.html']) {
  const response = await get(`${base}${path}`, { method: 'HEAD' });
  assert.equal(response.status, 200, path);
  const csp = secured(response);
  assert.equal(csp.includes('cdn.jsdelivr.net'), path.startsWith('/architecture') || path.startsWith('/drawings'));
  results.push({ path, method: 'HEAD', status: response.status, csp });
}
for (const path of ['/.env', '/.git/config', '/%252eenv', '/worker/wrangler.jsonc', '/src/data/chat-status.ts', '/package-lock.json', '/does-not-exist-security-review-20261006/']) {
  const response = await get(`${base}${path}`);
  assert.equal(response.status, 404, path); secured(response);
  results.push({ path, status: response.status });
}
const refused = await get(`${base}/`, { method: 'POST', body: 'invalid body' });
assert.equal(refused.status, 405); secured(refused);
results.push({ test: 'site refuses non-read methods', status: 405 });
const www = await get('https://www.demtsev.com/?lang=de');
assert.equal(www.status, 308); assert.equal(www.headers.get('location'), 'https://demtsev.com/?lang=de'); secured(www);
results.push({ test: 'secured canonical redirect preserves the query', status: 308 });
for (const origin of ['', 'https://demtsev.com', 'https://stranger.example']) {
  for (const method of ['POST', 'OPTIONS']) {
    // Invalid JSON ensures this check cannot generate a billable answer even if the gate regresses.
    const response = await get(endpoint, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: 'invalid JSON' } : {}) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('retry-after'), '3600');
    assert.equal(response.headers.get('access-control-allow-origin'), origin === 'https://demtsev.com' ? origin : null);
    assert.match((await response.json()).error.message, /temporarily paused/);
    results.push({ test: 'public backend paused before input handling', origin, method, status: 503 });
  }
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/summary.json`, JSON.stringify({ base, endpoint, checkedAt: new Date().toISOString(), passed: results.length, results }, null, 2)+'\n');
console.log(`Live security HTTP QA passed ${results.length} checks.`);
