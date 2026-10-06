/** Real Chrome + trained contour inference. Browser LanguageModel availability/streams are mocked. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startBrowser } from '../watch-language/browser-helper.mjs';

const base = (process.env.BOOK_QA_URL ?? 'http://127.0.0.1:4357').replace(/\/+$/, '');
const directory = process.env.BOOK_QA_OUTPUT ?? '/tmp/ai-book-autoplay-review/receipt';
const expectedSha = 'ea1150ccac1836b3dc2a054c93685eab45823b0baf23db83abba448182fdad8e';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(directory, { recursive: true });
const browser = await startBrowser('about:blank', { width: 1440, height: 1100 });
const receipt = { url: base, started: new Date().toISOString(), languageModel: 'mocked availability and text streams', contour: 'real same-origin trained v2 inference', checks: [] };
async function until(expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await browser.evaluate(expression)) return;
    await sleep(70);
  }
  throw new Error(`Timed out after ${timeout} ms: ${expression}`);
}
async function snapshot() { return browser.evaluate('window.__qaSnapshot()'); }
async function shot(name) {
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${directory}/${name}.png`, Buffer.from(data, 'base64'));
}
const forbidden = /(?:huggingface\.co|(?:^|\.)hf\.co|(?:^|\.)openai\.com|(?:^|\.)anthropic\.com|jsdelivr\.net)|\.(?:onnx|wasm)(?:[?#]|$)|\/chat\/runtime\/|\/v1\/chat|\/api\/chat/i;
async function noDownloads(label) {
  const requests = await browser.evaluate('({fetches:window.__qa.fetches,xhrs:window.__qa.xhrs,workers:window.__qa.workers,resources:performance.getEntriesByType("resource").map(r=>r.name),blocked:window.__qa.blocked})');
  const bad = [...requests.fetches, ...requests.xhrs, ...requests.resources].filter(url => forbidden.test(url));
  assert.deepEqual(bad, [], `${label}: no language weights, runtime, paid/cloud API or external model download`);
  assert.deepEqual(requests.blocked, [], `${label}: no attempted forbidden request`);
  assert.deepEqual(requests.workers.filter(worker => worker.name !== 'chronos-language'), [], `${label}: no book language worker starts without consent`);
  (receipt.requestChecks ??= []).push({ label, ...requests });
  return requests;
}
const bootstrap = `
  window.__qa={availability:0,sessions:0,streams:0,destroyed:0,fetches:[],xhrs:[],workers:[],blocked:[],turns:[],sheets:[],sentences:[]};
  window.__qaMode='available'; window.__qaDelay=false;
  window.__qaSentences=[
    'A patient hand turns the smallest task into a quiet lantern that lights the way forward.',
    'Learning from a small mistake can reveal a clearer path toward the next thoughtful experiment.',
    'Attention gives useful details a stronger voice when a model gathers context from many words.'
  ];
  window.LanguageModel={
    availability:async()=>{window.__qa.availability++;if(window.__qaDelay)return new Promise(resolve=>{window.__qaRelease=()=>{window.__qaDelay=false;resolve(window.__qaMode);};});return window.__qaMode;},
    create:async()=>{window.__qa.sessions++;let destroyed=false;return {
      promptStreaming:()=>{const text=window.__qaSentences[window.__qa.streams++%window.__qaSentences.length];window.__qa.sentences.push(text);return new ReadableStream({start(c){c.enqueue(text);c.close();}});},
      destroy:()=>{if(!destroyed){destroyed=true;window.__qa.destroyed++;}}
    };}
  };
  Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:async()=>({features:{has:()=>true}})}});
  Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:16});
  Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:async()=>({quota:4e9,usage:0})});
  const forbidden=/(?:huggingface\\.co|(?:^|\\.)hf\\.co|(?:^|\\.)openai\\.com|(?:^|\\.)anthropic\\.com|jsdelivr\\.net)|\\.(?:onnx|wasm)(?:[?#]|$)|\\/chat\\/runtime\\/|\\/v1\\/chat|\\/api\\/chat/i;
  const fetchOriginal=window.fetch;
  window.fetch=async(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href).href;window.__qa.fetches.push(url);
    if(forbidden.test(url)){window.__qa.blocked.push(url);throw new Error('QA blocked unexpected model/runtime/cloud request');}
    const response=await fetchOriginal(input,options);
    if(new URL(url).pathname==='/book/contour/contour-decoder.json')window.__qa.metadata=await response.clone().json();
    if(new URL(url).pathname==='/book/contour/contour-decoder.bin'){
      const bytes=await response.clone().arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);
      window.__qa.weights={bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};
    }
    return response;
  };
  const xhrOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,...rest){const full=new URL(String(url),location.href).href;window.__qa.xhrs.push(full);if(forbidden.test(full)){window.__qa.blocked.push(full);throw new Error('QA blocked unexpected XHR');}return xhrOpen.call(this,method,url,...rest);};
  const WorkerOriginal=window.Worker;
  window.Worker=new Proxy(WorkerOriginal,{construct(target,args){window.__qa.workers.push({url:String(args[0]),name:args[1]?.name??''});return Reflect.construct(target,args);}});
  window.__qaSnapshot=()=>{
    const root=document.querySelector('[data-book]');const left=root?.querySelector('.ai-book__spread > .ai-book__page--left');const artwork=left?.querySelector('[data-book-artwork]');
    return {count:root?.querySelector('[data-book-page-count]')?.textContent,text:root?.querySelector('[data-book-accessible]')?.textContent,ink:root?.querySelector('[data-book-output]')?.textContent,
      art:left?.querySelector('[data-book-contour]')?.getAttribute('d'),seed:artwork?.dataset.contourSeed,kind:artwork?.dataset.contourKind,
      turning:root?.dataset.bookTurning==='true',writing:root?.dataset.bookWriting==='true',busy:root?.dataset.bookBusy==='true',generated:root?.dataset.bookGenerated==='true',
      consent:root?.querySelector('[data-book-consent]')?.hidden===false,origin:root?.querySelector('[data-book-origin]')?.textContent,
      availability:window.__qa.availability,sessions:window.__qa.sessions,streams:window.__qa.streams,destroyed:window.__qa.destroyed,
      turns:window.__qa.turns.length,sheets:window.__qa.sheets.length};
  };
  window.__qaObserve=()=>{
    window.__qaObserver?.disconnect();const root=document.querySelector('[data-book]');let turning=root.dataset.bookTurning==='true',sheet=Boolean(root.querySelector('.ai-book__turn-sheet'));
    window.__qaObserver=new MutationObserver(()=>{
      const next=root.dataset.bookTurning==='true',nextSheet=Boolean(root.querySelector('.ai-book__turn-sheet'));
      if(next&&!turning)window.__qa.turns.push({at:performance.now(),count:window.__qaSnapshot().count});
      if(nextSheet&&!sheet)window.__qa.sheets.push({at:performance.now(),count:window.__qaSnapshot().count});
      turning=next;sheet=nextSheet;
    });window.__qaObserver.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-book-turning']});
  };
`;
let navigation = 0;
async function loadDeepLink() {
  // A changed query forces a new document; revisiting the same fragment can keep old model state.
  await browser.send('Page.navigate', { url: `${base}/?book-qa=${++navigation}#ai-book` });
  await until('document.querySelector("[data-widget-tab=book]")?.getAttribute("aria-selected")==="true" && document.querySelector("[data-book]")?.dataset.bookBusy!==undefined');
  assert.equal(await browser.evaluate('document.querySelector("#ai-book").hidden'), false, 'Deep link activates the book panel');
  await browser.evaluate('(()=>{const box=document.querySelector("[data-book-animate]");if(!box.checked){box.checked=true;box.dispatchEvent(new Event("change"));}document.querySelector(".ai-book__writing-area").scrollIntoView({block:"center"});})()');
  await browser.evaluate('document.fonts.ready.then(()=>true)');
  await until('Boolean(window.__qa.weights && window.__qaSnapshot().art && window.__qaSnapshot().writing)');
  await browser.evaluate('window.__qaObserve()');
}
try {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await loadDeepLink();
  const checkpointReceipt = await browser.evaluate('({metadata:window.__qa.metadata,weights:window.__qa.weights})');
  assert.equal(checkpointReceipt.metadata.version, 2);
  assert.equal(checkpointReceipt.metadata.architecture.points, 96);
  assert.equal(checkpointReceipt.metadata.shapes.length, 16);
  assert.equal(checkpointReceipt.metadata.sha256, expectedSha);
  assert.deepEqual(checkpointReceipt.weights, { bytes: 208520, sha256: expectedSha });
  receipt.checkpoint = checkpointReceipt;
  const first = await snapshot();
  await until(`(()=>{const s=window.__qaSnapshot();return s.count!==${JSON.stringify(first.count)}&&!s.turning&&s.ink.length>0&&s.art!==${JSON.stringify(first.art)};})()`, 45000);
  const autoplay = await snapshot();
  assert.notEqual(autoplay.text, first.text, 'First autoplay writes a different reviewed thought');
  assert.notEqual(autoplay.seed, first.seed, 'First autoplay generates a fresh learned drawing');
  assert.equal(autoplay.availability, 0, 'Reviewed autoplay never probes/prepares a language model');
  assert.equal(autoplay.sessions, 0);
  await noDownloads('Initial autoplay');
  receipt.checks.push({ check: 'deep link + reviewed autoplay', first, result: autoplay });
  await shot('01-reviewed-autoplay');

  // Keep the availability promise unresolved while the physical book turns and begins drawing/writing.
  const beforeNew = await snapshot();
  const mark = await browser.evaluate('(()=>{window.__qaDelay=true;const at=performance.now();document.querySelector("[data-book-generate]").click();return at;})()');
  await until(`window.__qa.sheets.length>${beforeNew.sheets}`, 3000);
  const curlMs = await browser.evaluate(`window.__qa.sheets[${beforeNew.sheets}].at-${mark}`);
  assert.ok(curlMs < 300, `New thought creates the actual curl within 300 ms (${curlMs.toFixed(1)} ms)`);
  await shot('02-new-thought-immediate-curl');
  await until(`(()=>{const s=window.__qaSnapshot();return typeof window.__qaRelease==='function'&&s.count!==${JSON.stringify(beforeNew.count)}&&!s.turning&&s.ink.length>0&&s.art!==${JSON.stringify(beforeNew.art)};})()`);
  const pending = await snapshot();
  assert.equal(pending.busy, true, 'Inference is still waiting during fresh ink');
  assert.equal(pending.generated, false, 'The destination first writes reviewed ink');
  assert.equal(pending.sessions, 0, 'No language session before availability resolves');
  const offset = await browser.evaluate('parseFloat(getComputedStyle(document.querySelector(".ai-book__spread > .ai-book__page--left [data-book-contour]")).strokeDashoffset)');
  await sleep(180);
  assert.ok(await browser.evaluate('parseFloat(getComputedStyle(document.querySelector(".ai-book__spread > .ai-book__page--left [data-book-contour]")).strokeDashoffset)') < offset, 'Fresh trained contour is being drawn before inference');
  await shot('03-fresh-art-and-ink-before-inference');
  await browser.evaluate('window.__qaRelease()');
  await until('window.__qaSnapshot().generated && !window.__qaSnapshot().busy && window.__qaSnapshot().ink.length>0');
  const generated = await snapshot();
  assert.equal(generated.count, pending.count, 'Local output lands in the reserved destination spread');
  assert.equal(generated.art, pending.art, 'Local output keeps its fresh trained contour');
  assert.equal(generated.turns, pending.turns, 'Inference completion starts no second curl');
  assert.equal(generated.sheets, pending.sheets);
  assert.equal(generated.text, await browser.evaluate('window.__qaSentences[0]'));
  assert.equal(generated.sessions, 1);
  assert.equal(generated.destroyed, 1, 'Completed local session is released');
  await sleep(250);
  assert.equal((await snapshot()).sheets, pending.sheets, 'No delayed second curl after local output');
  receipt.checks.push({ check: 'immediate New + delayed local availability + same-spread completion', curlMs, before: beforeNew, pending, result: generated });
  await shot('04-local-generated-thought');

  await until(`(()=>{const s=window.__qaSnapshot();return s.count!==${JSON.stringify(generated.count)}&&s.generated&&!s.busy&&s.streams>=2&&s.ink.length>0;})()`, 45000);
  const generatedAutoplay = await snapshot();
  assert.notEqual(generatedAutoplay.art, generated.art);
  assert.notEqual(generatedAutoplay.seed, generated.seed);
  assert.equal(generatedAutoplay.text, await browser.evaluate('window.__qaSentences[1]'));
  assert.equal(generatedAutoplay.sessions, 2);
  assert.equal(generatedAutoplay.destroyed, 2);
  assert.equal(generatedAutoplay.availability, generated.availability + 1, 'Autoplay reuses the prepared adapter; only per-inference availability is checked');
  await noDownloads('Generated autoplay');
  receipt.checks.push({ check: 'generated autoplay + reused prepared local adapter', previous: generated, result: generatedAutoplay });
  await shot('05-generated-autoplay');

  // A fresh narrow viewport checks the visible button, offscreen writing area, and consent-only offer.
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__qaMode="downloadable";' });
  await loadDeepLink();
  const consentBefore = await snapshot();
  const clickPoint = await browser.evaluate('(()=>{const button=document.querySelector("[data-book-generate]");button.scrollIntoView({block:"start",behavior:"instant"});const r=button.getBoundingClientRect();const ink=document.querySelector(".ai-book__writing-area").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,writingArea:ink.toJSON(),height:innerHeight};})()');
  await sleep(180); // Let the genuine intersection observer see the controls-only view.
  assert.ok(clickPoint.writingArea.bottom <= 0 || clickPoint.writingArea.top >= clickPoint.height || Math.max(0, Math.min(clickPoint.writingArea.bottom, clickPoint.height)-Math.max(0, clickPoint.writingArea.top))/clickPoint.writingArea.height < .15, 'Mobile New is clicked while writing area is outside its visibility threshold');
  const mobileMark = await browser.evaluate('performance.now()');
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickPoint.x, y: clickPoint.y, button: 'left', buttons: 1, clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickPoint.x, y: clickPoint.y, button: 'left', buttons: 0, clickCount: 1 });
  await until(`window.__qa.sheets.length>${consentBefore.sheets}`, 3000);
  const mobileCurlMs = await browser.evaluate(`window.__qa.sheets[${consentBefore.sheets}].at-${mobileMark}`);
  assert.ok(mobileCurlMs < 300, `Physical mobile New starts visible curl within 300 ms (${mobileCurlMs.toFixed(1)} ms)`);
  await until(`(()=>{const s=window.__qaSnapshot();return s.consent&&!s.turning&&s.count!==${JSON.stringify(consentBefore.count)}&&s.ink.length>0&&s.art!==${JSON.stringify(consentBefore.art)};})()`);
  const offer = await snapshot();
  assert.equal(offer.sessions, 0);
  assert.equal(offer.streams, 0);
  assert.match(await browser.evaluate('document.querySelector("[data-book-consent]").textContent'), /885 MB/);
  await noDownloads('Download consent offer');
  receipt.checks.push({ check: 'physical mobile New + offscreen ink + consent without download', mobileCurlMs, clickPoint, before: consentBefore, result: offer });
  await shot('06-mobile-consent-fresh-spread');

  await browser.evaluate('document.querySelector("[data-book-pause]").click()');
  await sleep(60);
  const paused = await snapshot();
  const pausedArt = await browser.evaluate('getComputedStyle(document.querySelector(".ai-book__spread > .ai-book__page--left [data-book-contour]")).strokeDashoffset');
  await sleep(1700);
  assert.deepEqual(await snapshot(), paused, 'Pause holds ink, spread and language counts');
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".ai-book__spread > .ai-book__page--left [data-book-contour]")).strokeDashoffset'), pausedArt, 'Pause holds the drawing');
  await browser.evaluate('document.querySelector("[data-book-pause]").click();document.querySelector("[data-widget-tab=watch]").click()');
  await sleep(80);
  const hidden = await snapshot();
  await sleep(1700);
  assert.deepEqual(await snapshot(), hidden, 'Hidden book holds ink, spread and language counts');
  assert.equal(await browser.evaluate('document.querySelector("#ai-book").hidden'), true);
  await noDownloads('Pause and hide');
  receipt.checks.push({ check: 'pause + hidden panel remain still', paused, hidden });
  receipt.passed = true;
  receipt.finished = new Date().toISOString();
  await writeFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ passed: true, checks: receipt.checks.length, receipt: `${directory}/receipt.json`, screenshots: directory }));
} catch (error) {
  receipt.passed = false; receipt.error = error.stack ?? String(error); receipt.finished = new Date().toISOString();
  try { receipt.failedState = await snapshot(); await shot('failure'); } catch {}
  await writeFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2));
  throw error;
} finally { await browser.close(); }
