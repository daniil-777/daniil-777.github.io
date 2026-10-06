/** Exercise production UI/provider switching with isolated, non-billable provider doubles. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startBrowser } from '../watch-language/browser-helper.mjs';
import { providerFixture } from './provider-browser-fixture.mjs';
const base = process.env.ASK_AI_QA_URL ?? 'http://127.0.0.1:4359';
const browser = await startBrowser('about:blank', { width: 1440, height: 1000 });
const results = [], output = '/tmp/ask-ai-provider-qa';
let visit = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = test => results.push({ test, passed: true });
async function until(expression, ms = 15_000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await browser.evaluate(expression)) return; await sleep(30); }
  throw new Error(`Timed out: ${expression}\n${await browser.evaluate('JSON.stringify({body:document.querySelector("[data-chat-body]")?.innerText,errors:window.__qa?.errors,csp:window.__qa?.csp})')}`);
}
async function open(scenario) {
  await browser.send('Page.navigate', { url: `${base}/?lang=en&qa=${++visit}#qa-${scenario}` });
  await until('document.querySelector(".nav__ask[data-chat-open]")');
  await sleep(300);
  await browser.evaluate('document.querySelector(".nav__ask[data-chat-open]").click()');
  await until('document.querySelector("[data-model-select]")');
  if (scenario !== 'delayed') await sleep(150);
}
const state = () => browser.evaluate('JSON.parse(sessionStorage.getItem("chat:turns")||"[]")');
const mode = () => browser.evaluate('document.querySelector("[data-model-select]").textContent');
const answer = () => browser.evaluate('[...document.querySelectorAll(".turn--a")].at(-1)?.innerText');
async function choose(mode) {
  await browser.evaluate(`document.querySelector('[data-model-select]').click();document.querySelector('[data-model-option=${mode}]').click()`);
}
async function begin(q) {
  await browser.evaluate(`document.querySelector('#chat-q').value=${JSON.stringify(q)};document.querySelector('[data-chat-form]').requestSubmit()`);
}
async function settled() { await until('!document.querySelector(".turn--a[aria-busy=true]")&&!document.querySelector("[data-model-select]").disabled'); }
async function ask(q) { await begin(q); await settled(); return answer(); }
async function clean() {
  assert.deepEqual(await browser.evaluate('({errors:__qa.errors,csp:__qa.csp})'), { errors: [], csp: [] });
  assert.ok(!(await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name)')).some(url => /api.openai|huggingface|model_q4/.test(url)));
}
try {
  await mkdir(output, { recursive: true });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: providerFixture });
  await open('builtin');
  assert.equal((await mode()).trim(), 'OpenAI');
  const geometry = await browser.evaluate('(()=>{const p=document.querySelector("[data-model-select]").getBoundingClientRect(),f=document.querySelector("[data-chat-form]").getBoundingClientRect();return {picker:p.top,composer:f.bottom};})()');
  assert.ok(geometry.picker >= geometry.composer);
  check('OpenAI is the default; model button is below the composer');
  assert.match(await ask('Explain overfitting in two sentences.'), /OpenAI[\s\S]*training data/);
  await browser.evaluate('__qa.provider="credits-stream"');
  const count = (await state()).length;
  assert.match(await ask('Give a small example of it.'), /Our local model[\s\S]*memorize/);
  assert.equal((await state()).length, count + 1);
  assert.equal((await state()).at(-1).answer.mode, 'device');
  assert.ok(!(await answer()).includes('partial cloud answer'));
  assert.match(await browser.evaluate('__qa.prompts.at(-1)'), /Explain overfitting[\s\S]*generalizing poorly/);
  assert.equal((await mode()).trim(), 'Our local model');
  check('streaming credit exhaustion retries the same turn locally, removes partial cloud text and preserves conversation');
  await ask('Give another example.');
  assert.equal(await browser.evaluate('__qa.calls.length'), 2);
  check('later turns remain local after credit exhaustion');
  await choose('cloud'); await browser.evaluate('__qa.provider="ok"');
  await ask('Explain cross validation.');
  const call = await browser.evaluate('__qa.calls.at(-1)');
  assert.ok(!JSON.stringify(call).includes('Give another example')); assert.ok(!JSON.stringify(call).includes('Give a small example'));
  check('manual OpenAI selection resumes cloud without uploading local turns');
  await ask('Show me videos of AI Proctor');
  const before = await browser.evaluate('__qa.calls.length');
  assert.match(await ask('Explain it in more detail.'), /AI Proctor/);
  assert.equal(await browser.evaluate('__qa.calls.length'), before + 1);
  assert.match((await browser.evaluate('__qa.calls.at(-1)')).q, /Public portfolio topic: AI Proctor/);
  assert.ok(!JSON.stringify(await browser.evaluate('__qa.calls.at(-1)')).includes('Show me videos'));
  check('public video topic survives cloud follow-up without uploading the resource-only question');
  for (const width of [375, 1440]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: width === 375 });
    for (const theme of ['light', 'dark']) {
      await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('[data-model-select]').click()`);
      await sleep(200);
      const fit = await browser.evaluate('(()=>{const r=document.querySelector("[role=menu]").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight};})()');
      assert.ok(fit.left >= 0 && fit.right <= fit.w && fit.top >= 0 && fit.bottom <= fit.h);
      const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(`${output}/models-${width}-${theme}.png`, Buffer.from(shot.data, 'base64'));
      await browser.evaluate('document.querySelector("[data-model-select]").click()');
    }
    check(`model menu fits ${width}px in light and dark themes`);
  }
  await clean();
  await open('builtin'); await browser.evaluate('__qa.provider="rate"');
  assert.match(await ask('Explain overfitting.'), /busy/); assert.equal((await mode()).trim(), 'OpenAI');
  assert.equal(await browser.evaluate('__qa.prompts.length'), 0);
  check('temporary rate limits keep OpenAI selected and do not invoke local inference');
  await browser.evaluate('__qa.provider="budget"');
  assert.match(await ask('Explain overfitting.'), /Our local model/);
  check('daily service budget also hands off to local inference'); await clean();
  await open('unsupported'); await browser.evaluate('__qa.provider="credits-http"');
  assert.match(await ask('Explain overfitting.'), /cannot run on this device/);
  assert.equal((await mode()).trim(), 'Portfolio search');
  assert.equal(await browser.evaluate('document.querySelector("[data-model-option=device]").disabled'), true);
  const calls = await browser.evaluate('__qa.calls.length'); await ask('Show me his CV');
  assert.equal(await browser.evaluate('__qa.calls.length'), calls);
  assert.match(await answer(), /Download CV/);
  check('unsupported device keeps fast portfolio answers and files without a model download'); await clean();
  await open('download'); await browser.evaluate('__qa.provider="credits-http"');
  await begin('Explain overfitting.'); await until('!document.querySelector(".chat__consent").hidden');
  assert.equal(await browser.evaluate('__qa.workers.length'), 0);
  assert.equal(await browser.evaluate('document.querySelector("[data-model-select]").disabled'), true);
  await browser.evaluate('[...document.querySelectorAll(".chat__consent button")].find(b=>b.textContent==="Download").click()');
  await until('__qa.workers.length===1'); await browser.evaluate('__qa.release()'); await settled();
  assert.equal((await state()).at(-1).answer.mode, 'device');
  check('first fallback waits for explicit download consent and then answers the original turn');
  await browser.evaluate('document.querySelector(".chat__hint button").click()');
  assert.equal(await browser.evaluate('__qa.workers[0].dead'), true); await clean();
  for (const action of ['decline', 'stop', 'close', 'reset', 'stop-download', 'reset-download']) {
    await open('download'); await browser.evaluate('__qa.provider="credits-http"');
    await begin('Explain overfitting.'); await until('!document.querySelector(".chat__consent").hidden');
    const downloading = action.endsWith('-download');
    if (downloading) {
      await browser.evaluate('[...document.querySelectorAll(".chat__consent button")].find(b=>b.textContent==="Download").click()');
      await until('__qa.workers.length===1');
    }
    await browser.evaluate(action === 'decline' ? '[...document.querySelectorAll(".chat__consent button")].find(b=>b.textContent==="Cancel").click()' : action.startsWith('stop') ? 'document.querySelector("[data-chat-form]").requestSubmit()' : action === 'close' ? 'document.querySelector("[data-chat-close]").click()' : 'document.querySelector("[data-chat-new]").click()');
    await settled(); assert.equal(await browser.evaluate('__qa.workers.length'), downloading ? 1 : 0);
    if (downloading) assert.equal(await browser.evaluate('__qa.workers[0].dead'), true);
    assert.equal(await browser.evaluate('document.querySelector(".chat__consent").hidden'), true);
    if (action.startsWith('reset')) assert.equal((await state()).length, 0);
    check(`${action} during automatic download choice releases retry and leaves no stale work`); await clean();
  }
  await open('delayed'); await choose('quotes');
  await until('typeof __qa.probeReady==="function"'); await browser.evaluate('__qa.probeReady()'); await sleep(200);
  assert.equal((await mode()).trim(), 'Portfolio search');
  check('delayed capability probing preserves a model choice made by the visitor'); await clean();
  await open('saved-device-delayed');
  assert.equal((await mode()).trim(), 'Portfolio search');
  await ask('Explain overfitting.'); assert.equal(await browser.evaluate('__qa.calls.length'), 0);
  await until('typeof __qa.probeReady==="function"'); await browser.evaluate('__qa.probeReady()');
  await until('document.querySelector("[data-model-select]").textContent.includes("Our local model")');
  assert.match(await ask('Explain overfitting.'), /Our local model/);
  assert.equal(await browser.evaluate('__qa.calls.length'), 0);
  check('saved local preference never uploads a question while capability probing is pending'); await clean();
  const kb = await (await fetch(`${base}/chat/kb.json`)).json();
  await writeFile('docs/ask-ai/provider-browser-evaluation.json', JSON.stringify({ v: 1, kb: kb.hash, date: new Date().toISOString(), base, provider: 'Isolated HTTP/SSE and browser inference doubles; no billed requests', results }, null, 2) + '\n');
  console.log(`Provider browser QA passed ${results.length} flows. Screenshots: ${output}`);
} finally { await browser.close(); }
