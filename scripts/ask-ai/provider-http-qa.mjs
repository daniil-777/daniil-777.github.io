/** Actual browser-to-Worker CSP/CORS transport, with invalid input to avoid inference. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { startBrowser } from '../watch-language/browser-helper.mjs';
const base = process.env.ASK_AI_QA_URL ?? 'http://127.0.0.1:4359';
const endpoint = process.env.ASK_AI_PROVIDER_QA_URL ?? 'http://127.0.0.1:8787/v1/chat';
const browser = await startBrowser('about:blank');
const results = [];
try {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__qaCsp=[];document.addEventListener("securitypolicyviolation",e=>__qaCsp.push(e.blockedURI));' });
  await browser.send('Page.navigate', { url: base });
  for (let i = 0; i < 100; i++) {
    if (await browser.evaluate('document.readyState==="complete"&&!!document.querySelector("[data-chat-open]")')) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const response = await browser.evaluate(`fetch(${JSON.stringify(endpoint)}, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({v:1,q:''})}).then(async r=>({status:r.status,code:(await r.json()).error?.code}))`);
  assert.deepEqual(response, { status: 400, code: 'invalid' });
  assert.deepEqual(await browser.evaluate('__qaCsp'), []);
  results.push({ test: 'real browser request reaches enabled Worker through CSP and CORS; invalid input prevents provider work', passed: true });
  const wrong = await fetch(endpoint, { method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, q: '' }) });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.headers.get('access-control-allow-origin'), null);
  results.push({ test: 'unrelated origins are rejected before inference', passed: true });
  const kb = await (await fetch(`${base}/chat/kb.json`)).json();
  await writeFile('docs/ask-ai/provider-http-evaluation.json', JSON.stringify({ v: 1, kb: kb.hash, date: new Date().toISOString(), base, endpoint, providerRequests: 0, results }, null, 2) + '\n');
  console.log(`Provider HTTP QA passed ${results.length} checks without inference.`);
} finally { await browser.close(); }
