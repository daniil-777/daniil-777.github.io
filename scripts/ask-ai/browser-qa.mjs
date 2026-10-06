/** Actual isolated browser flows under the production CSP. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startBrowser } from '../watch-language/browser-helper.mjs';
const base = process.env.ASK_AI_QA_URL ?? 'http://127.0.0.1:4359';
const output = '/tmp/ask-ai-browser-qa', results = [];
const browser = await startBrowser('about:blank', { width: 1440, height: 1000 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression, maxMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { if (await browser.evaluate(expression)) return; await wait(50); }
  throw new Error(`Timed out: ${expression}`);
}
await mkdir(output, { recursive: true });
try {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__qaErrors=[];window.__qaCsp=[];addEventListener('error',e=>window.__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));document.addEventListener('securitypolicyviolation',e=>window.__qaCsp.push({directive:e.effectiveDirective,url:e.blockedURI}));` });
  await browser.send('Page.navigate', { url: `${base}/?lang=en` });
  await until('document.querySelector("[data-chat-open]")');
  await wait(250);
  const eager = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name)');
  assert.ok(!eager.some(url => /\/chat\/(?:kb|vectors|datasets|runtime)|huggingface|\/v1\/chat/.test(url)));
  results.push({ test: 'no chat corpus, model, dataset or inference request before opening', passed: true });
  const start = Date.now();
  await browser.evaluate('document.querySelector(".nav__ask[data-chat-open]").click()');
  await until('document.querySelector("#chat-q")');
  results.push({ test: 'chat opens under CSP', passed: true, ms: Date.now() - start });
  await browser.evaluate('document.querySelector("[data-model-select]").click();document.querySelector("[data-model-option=quotes]").click()');
  async function ask(question) {
    const count = await browser.evaluate('document.querySelectorAll(".turn--a").length');
    const began = Date.now();
    await browser.evaluate(`(()=>{document.querySelector('#chat-q').value=${JSON.stringify(question)};document.querySelector('[data-chat-form]').requestSubmit();})()`);
    await until(`document.querySelectorAll('.turn--a:not([aria-busy="true"])').length>${count}`);
    return { ms: Date.now() - began, answer: await browser.evaluate(`(()=>{const a=[...document.querySelectorAll('.turn--a')].at(-1);return {text:a.innerText,links:[...a.querySelectorAll('[data-resource-link]')].map(l=>({url:l.getAttribute('href'),download:l.hasAttribute('download')})),video:[...a.querySelectorAll('video')].map(v=>({src:v.getAttribute('src'),preload:v.preload,controls:v.controls}))};})()`) };
  }
  const cases = [
    ['Show me his CV', answer => answer.links.some(link => /daniil-emtsev-cv\.pdf/.test(link.url) && link.download)],
    ['Show me videos of AI Proctor', answer => answer.video.length > 0 && answer.video.every(v => v.preload === 'none' && v.controls)],
    ['Show me the Dynamic Plane paper', answer => answer.links.some(link => /dynamic-plane-onet-paper\.pdf/.test(link.url))],
    ['What is his current role?', answer => /VirtaMed/.test(answer.text)],
    ['Where did he study?', answer => /ETH|MIPT/.test(answer.text)],
    ['Did the owner of this website graduate from Stanford in 2014?', answer => /ETH Zurich|MIPT/.test(answer.text) && !/Stanford|2014|OCR transcription/.test(answer.text)],
    ['Is his patent already granted?', answer => /application/.test(answer.text)],
    ['When can he start?', answer => /not documented/.test(answer.text)],
    ['Explain Ultrasound Anatomy Detection in detail', answer => /60%[\s\S]*90%/.test(answer.text) && answer.text.length > 700],
    ['Which projects run AI in the browser?', answer => /Astro Pilot|Universal AI Proctor|Laparoscopic Skills Trainer/.test(answer.text)],
    ['Compare the results of AI Proctor and Ultrasound Anatomy Detection', answer => /60%[\s\S]*90%/.test(answer.text)],
    ['Show Astro Pilot code', answer => answer.links.some(l => /github.com\/daniil-777\/Universal-Spaceship/i.test(l.url))],
    ['Open Astro Pilot', answer => answer.links.some(l => l.url.split('?')[0] === '/work/astro-pilot/')],
    ['Try its app', answer => answer.links.some(l => /github.io\/Universal-Spaceship/i.test(l.url))],
    ['Show his GitHub and LinkedIn', answer => answer.links.some(l => l.url === 'https://github.com/daniil-777') && answer.links.some(l => /linkedin.com\/in\//.test(l.url))],
    ['Show the camera pose paper', answer => answer.links.some(l => /camera-pose-patent.pdf/.test(l.url))],
    ['Show the Dynamic Plane paper', answer => answer.links.some(l => /dynamic-plane-onet-paper.pdf/.test(l.url))],
    ['And its code?', answer => answer.links.some(l => /github.com\/dsvilarkovic\/dynamic_plane_convolutional_onet/i.test(l.url))],
    ['Send the Dynamic Plane paper and camera pose patent', answer => answer.links.some(l => /dynamic-plane-onet-paper.pdf/.test(l.url)) && answer.links.some(l => /camera-pose-patent.pdf/.test(l.url))],
  ];
  for (const [q, check] of cases) {
    const result = await ask(q); assert.ok(check(result.answer), `${q}: ${JSON.stringify(result)}`);
    assert.ok(result.ms < 1500, `Fast local reply exceeded budget: ${q} ${result.ms} ms`);
    for (const link of result.answer.links.filter(link => link.url.startsWith('/'))) {
      const response = await fetch(new URL(link.url, base), { method: 'HEAD' }); assert.equal(response.status, 200, link.url);
    }
    results.push({ test: q, passed: true, ...result });
  }
  // Actually begin playback, then closing the dialog must pause it.
  await ask('Show me videos of AI Proctor');
  await browser.evaluate(`(()=>{const v=[...document.querySelectorAll('.turn--a video')].at(-1);v.muted=true;return v.play();})()`);
  await until('[...document.querySelectorAll(".turn--a video")].some(v=>v.currentTime>0)');
  await browser.evaluate('document.querySelector("[data-chat-close]").click()');
  await until('[...document.querySelectorAll(".turn--a video")].every(v=>v.paused)');
  results.push({ test: 'video plays; closing chat pauses media', passed: true });
  for (const width of [375, 768, 1440]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: width === 375 });
    await browser.evaluate('document.querySelector(".nav__ask[data-chat-open]").click()');
    await until('document.querySelector("[data-chat-dialog]").open');
    await browser.evaluate('Promise.all(document.querySelector("[data-chat-dialog]").getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>true)');
    const bounds = await browser.evaluate('(()=>{const d=document.querySelector("[data-chat-dialog]").getBoundingClientRect();return {left:d.left,right:d.right,top:d.top,bottom:d.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};})()');
    assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.top >= 0 && bounds.bottom <= bounds.height + 1 && !bounds.overflow, JSON.stringify(bounds));
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`${output}/chat-${width}.png`, Buffer.from(shot.data, 'base64'));
    results.push({ test: `chat fits ${width}px`, passed: true });
    await browser.evaluate('document.querySelector("[data-chat-close]").click()');
  }
  await browser.evaluate('document.querySelector(".nav__ask[data-chat-open]").click()');
  await browser.evaluate('document.querySelector("[data-chat-new]").click()');
  assert.equal(await browser.evaluate('document.querySelectorAll(".turn--a,.turn--q").length'), 0);
  const violations = await browser.evaluate('({errors:window.__qaErrors,csp:window.__qaCsp})');
  assert.deepEqual(violations, { errors: [], csp: [] });
  const resources = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name)');
  assert.ok(!resources.some(url => /datasets|\/api\/chat|openai|anthropic|\/v1\/chat/.test(url)));
  results.push({ test: 'reset, no console/CSP errors, no dataset/provider downloads', passed: true });
  const kb = await (await fetch(`${base}/chat/kb.json`)).json();
  await writeFile('docs/ask-ai/browser-evaluation.json', JSON.stringify({ v: 1, kb: kb.hash, base, date: new Date().toISOString(), results, visualBaseline: 'No historical chat baseline; layout/screenshots checked, visual regression inconclusive.' }, null, 2) + '\n');
  console.log(`Browser QA passed ${results.length} flows. Screenshots: ${output}`);
} finally { await browser.close(); }
