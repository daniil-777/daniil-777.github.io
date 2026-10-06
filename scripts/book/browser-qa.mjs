/** Real contour inference and page turns; local language-model streams are mocked. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startBrowser } from '../watch-language/browser-helper.mjs';

const base = (process.env.BOOK_QA_URL ?? 'http://127.0.0.1:4357').replace(/\/+$/, '');
const directory = process.env.BOOK_QA_OUTPUT ?? '/tmp/ai-book-qa';
const checkpointSha256 = 'ea1150ccac1836b3dc2a054c93685eab45823b0baf23db83abba448182fdad8e';
await mkdir(directory, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await startBrowser('about:blank', { width: 1440, height: 1100 });
const until = async expression => {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await browser.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Not ready: ${expression}`);
};
const screenshot = async name => writeFile(`${directory}/${name}.png`, Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
try {
  // Install the local adapter before navigation, including before Next page can infer.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__bookSessions=0; window.__bookDestroyed=0; window.__bookCloudCalls=0;
    window.__bookFetchUrls=[]; window.__bookContourFetches=[];
    window.__bookSentence="A patient hand turns the smallest task into a quiet lantern that lights the way forward.";
    window.LanguageModel={
      availability:async()=>window.__bookAvailability ?? "available",
      create:async()=>{window.__bookSessions++;return {
        promptStreaming:()=>new ReadableStream({start(controller){controller.enqueue(window.__bookSentence);controller.close();}}),
        destroy:()=>{window.__bookDestroyed++;}
      };}
    };
    const realFetch=window.fetch;
    window.fetch=async(input,options)=>{
      const url=new URL(input instanceof Request?input.url:String(input),location.href);
      window.__bookFetchUrls.push(url.href);
      if(url.pathname==='/v1/chat'||/(?:^|\\.)openai\\.com$|(?:^|\\.)anthropic\\.com$/.test(url.hostname)){
        window.__bookCloudCalls++;
        throw new Error('The book must not request a cloud provider.');
      }
      const response=await realFetch(input,options);
      if(url.pathname==='/book/contour/contour-decoder.json'){
        window.__bookContourFetches.push(url.href);
        window.__bookContourMetadata=await response.clone().json();
      }else if(url.pathname==='/book/contour/contour-decoder.bin'){
        window.__bookContourFetches.push(url.href);
        const bytes=await response.clone().arrayBuffer();
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        window.__bookContourWeights={bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};
      }
      return response;
    };
  ` });
  // Reproduce the user's system setting: explicit book animation still writes.
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.send('Page.navigate', { url: `${base}/` });
  await until('Boolean(document.querySelector("[data-widget-tab]") && document.querySelector("#ai-book")?.hidden)');
  assert.equal(await browser.evaluate('document.querySelector("[data-widget-tab=watch]").getAttribute("aria-selected")'), 'true');
  assert.equal(await browser.evaluate('document.querySelector("#ai-book").hidden'), true);
  assert.deepEqual(await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/italianno|book\\/contour|\\.(onnx|wasm)(\\?|$)/.test(n))'), []);

  await browser.evaluate('document.querySelector("[data-widget-tab=book]").click(); document.querySelector("#ai-book").scrollIntoView({block:"start"})');
  await browser.evaluate('document.fonts.ready.then(()=>true)');
  await wait(500);
  await browser.evaluate('document.querySelector("#ai-book").scrollIntoView({block:"start"})');
  await until('document.querySelector("[data-book]").dataset.bookWriting === "true"');
  await until('Boolean(document.querySelector("[data-book-contour]").getAttribute("d"))');
  const servedCheckpoint = await browser.evaluate('({metadata:window.__bookContourMetadata,weights:window.__bookContourWeights,fetches:window.__bookContourFetches})');
  assert.equal(servedCheckpoint.metadata.version, 2, 'The live page loads the v2 contour checkpoint');
  assert.equal(servedCheckpoint.metadata.architecture.points, 96);
  assert.equal(servedCheckpoint.metadata.shapes.length, 16);
  assert.equal(servedCheckpoint.metadata.sha256, checkpointSha256, 'Live metadata identifies the frozen trained weights');
  assert.deepEqual(servedCheckpoint.weights, { bytes: 208520, sha256: checkpointSha256 }, 'Actual live binary bytes match the frozen checkpoint');
  assert.equal(servedCheckpoint.fetches.length, 2, 'The real model loads exactly two same-origin assets');
  assert.ok(servedCheckpoint.fetches.every(url => new URL(url).origin === new URL(base).origin));
  assert.deepEqual(await browser.evaluate('[...document.querySelector("[data-book-topic]").options].map(o=>o.value)'), ['ai', 'profile', 'wellbeing']);
  assert.equal(await browser.evaluate('document.querySelector("[data-book-model]")'), null, 'The book offers only the local model');
  assert.match(await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")'), /^M.*C/);
  await wait(400);
  const before = await browser.evaluate('({text:document.querySelector("[data-book-output]").textContent,quill:document.querySelector("[data-book-quill]").style.cssText})');
  await wait(300);
  const after = await browser.evaluate('({text:document.querySelector("[data-book-output]").textContent,quill:document.querySelector("[data-book-quill]").style.cssText})');
  assert.ok(after.text.length > before.text.length, 'Ink advances');
  assert.notEqual(before.quill, after.quill, 'The feather follows the text');
  const featherMotion = await browser.evaluate('(()=>{const s=getComputedStyle(document.querySelector("[data-book-quill] svg"));return {duration:s.animationDuration,iterations:s.animationIterationCount}})()');
  assert.equal(featherMotion.duration, '0.38s', 'The feather stroke overrides global reduced-motion suppression');
  assert.equal(featherMotion.iterations, 'infinite');
  await browser.evaluate('document.querySelector("[data-book-pause]").click()');
  const paused = await browser.evaluate('document.querySelector("[data-book-output]").textContent');
  await wait(200);
  assert.equal(await browser.evaluate('document.querySelector("[data-book-output]").textContent'), paused);
  await browser.evaluate('document.querySelector("[data-book-replay]").click()');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-pause]").getAttribute("aria-pressed")'), 'false', 'Replay resumes paused writing');
  await until('document.querySelector("[data-book-status]").textContent === "Ready to write"');
  await browser.evaluate('document.querySelector("#ai-book").scrollIntoView({block:"start"})');
  await screenshot('desktop');
  const firstThought = await browser.evaluate('document.querySelector("[data-book-accessible]").textContent');
  const firstArt = await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")');
  await browser.evaluate('document.querySelector("[data-book-next]").click()');
  await until('document.querySelector("[data-book]").dataset.bookTurning === "true"');
  assert.equal(await browser.evaluate(`document.querySelector('.ai-book__turn-face--front').textContent.includes(${JSON.stringify(firstThought)})`), true, 'The turning front retains the outgoing inscription');
  await wait(250);
  assert.notEqual(await browser.evaluate('getComputedStyle(document.querySelector(".ai-book__turn-sheet")).transform'), 'none');
  await screenshot('turn-forward');
  await browser.evaluate('document.querySelector("[data-book-pause]").click()');
  await wait(50); // WAAPI commits its paused hold-time on the following frame.
  const turnPaused = await browser.evaluate('getComputedStyle(document.querySelector(".ai-book__turn-sheet")).transform');
  await wait(150);
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".ai-book__turn-sheet")).transform'), turnPaused, 'Pause holds the curling page');
  await browser.evaluate('document.querySelector("[data-book-pause]").click()');
  await until(`document.querySelector("[data-book]").dataset.bookTurning !== "true" && document.querySelector("[data-book-accessible]").textContent !== ${JSON.stringify(firstThought)}`);
  await until('document.querySelector("[data-book]").dataset.bookGenerated === "true"');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-accessible]").textContent'), await browser.evaluate('window.__bookSentence'), 'Next page writes local-model output');
  await until('document.querySelector("[data-book]").dataset.bookWriting === "true"');
  assert.notEqual(await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")'), firstArt, 'The next drawing is newly generated');
  const contourBefore = await browser.evaluate('parseFloat(getComputedStyle(document.querySelector("[data-book-contour]")).strokeDashoffset)');
  await wait(300);
  assert.ok(await browser.evaluate('parseFloat(getComputedStyle(document.querySelector("[data-book-contour]")).strokeDashoffset)') < contourBefore, 'The learned contour is progressively drawn');
  await browser.evaluate('document.querySelector("[data-book-previous]").click()');
  await until('Boolean(document.querySelector(".ai-book__turn-sheet--backward"))');
  await wait(250); await screenshot('turn-backward');
  await until('document.querySelector("[data-book-accessible]").textContent.startsWith("Attention compares") && document.querySelector("[data-book]").dataset.bookTurning !== "true"');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-accessible]").textContent'), firstThought);
  assert.equal(await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")'), firstArt);
  assert.equal(await browser.evaluate('document.querySelector("[data-book-origin]").textContent'), 'Reviewed thought');
  await browser.evaluate('var theme=document.querySelector("[data-book-topic]");theme.value="profile";theme.dispatchEvent(new Event("change"))');
  await until('document.querySelector("[data-book-accessible]").textContent.startsWith("Daniil Emtsev")');
  assert.match(await browser.evaluate('document.querySelector("[data-book-sources] a").href'), /demtsev.com\/#about/);
  await browser.evaluate('var theme=document.querySelector("[data-book-topic]");theme.value="wellbeing";theme.dispatchEvent(new Event("change"))');
  await until('document.querySelector("[data-book-accessible]").textContent.startsWith("Even a little physical activity")');
  assert.match(await browser.evaluate('document.querySelector("[data-book-sources] a").href'), /who.int/);
  await browser.evaluate('var theme=document.querySelector("[data-book-topic]");theme.value="ai";theme.dispatchEvent(new Event("change"))');
  await until('document.querySelector("[data-book-accessible]").textContent.startsWith("Attention compares") && document.querySelector("[data-book]").dataset.bookTurning !== "true"');

  // The same browser-provided model adapter verifies the complete inference-to-ink path.
  const sessionsBefore = await browser.evaluate('window.__bookSessions');
  await browser.evaluate('document.querySelector("[data-book-generate]").click()');
  await until('document.querySelector("[data-book]").dataset.bookGenerated === "true"');
  await until('document.querySelector("[data-book-status]").textContent === "Ready to write"');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-origin]").textContent'), 'Written by local AI');
  assert.equal(await browser.evaluate('window.__bookSessions'), sessionsBefore + 1);
  assert.equal(await browser.evaluate('window.__bookDestroyed'), await browser.evaluate('window.__bookSessions'), 'Each local inference session is released');
  assert.match(await browser.evaluate('document.querySelector("[data-book-output]").textContent'), /^A patient hand/);

  // Portfolio grounding and verified source links also stay on the local inference path.
  await browser.evaluate(`window.__bookSentence='Daniil completed a master’s in Computational Science and Engineering at ETH Zurich, focusing on robotics. [[site:bio-2]]';var theme=document.querySelector('[data-book-topic]');theme.value='profile';theme.dispatchEvent(new Event('change'));`);
  await until('document.querySelector("[data-book-accessible]").textContent.startsWith("Daniil Emtsev") && document.querySelector("[data-book]").dataset.bookTurning !== "true"');
  await browser.evaluate('document.querySelector("[data-book-generate]").click()');
  await until('document.querySelector("[data-book-origin]").textContent === "Written by local AI"');
  assert.match(await browser.evaluate('document.querySelector("[data-book-accessible]").textContent'), /^Daniil completed a master/);
  assert.match(await browser.evaluate('document.querySelector("[data-book-sources] a").href'), /#about/);
  assert.equal(await browser.evaluate('window.__bookCloudCalls'), 0, 'Portfolio generation never calls a cloud provider');
  await browser.evaluate('var theme=document.querySelector("[data-book-topic]");theme.value="ai";theme.dispatchEvent(new Event("change"))');
  await until('document.querySelector("[data-book-accessible]").textContent.startsWith("Attention compares") && document.querySelector("[data-book]").dataset.bookTurning !== "true"');

  // Real input events verify that the curl follows the hand, returns, then lands.
  await browser.evaluate('window.__bookSentence="A patient hand turns the smallest task into a quiet lantern that lights the way forward.";document.querySelector(".ai-book__stage").scrollIntoView({block:"center"})');
  const originalSpread = await browser.evaluate('({count:document.querySelector("[data-book-page-count]").textContent,text:document.querySelector("[data-book-accessible]").textContent,art:document.querySelector("[data-book-contour]").getAttribute("d"),sessions:window.__bookSessions})');
  const bookBox = await browser.evaluate('document.querySelector(".ai-book__volume").getBoundingClientRect().toJSON()');
  const mouseStart = { x: bookBox.right - bookBox.width * .1, y: bookBox.top + bookBox.height * .6 };
  const mouse = (type, x, buttons = 1) => browser.send('Input.dispatchMouseEvent', { type, x, y: mouseStart.y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  await mouse('mousePressed', mouseStart.x);
  await mouse('mouseMoved', mouseStart.x - 20);
  await until('Boolean(document.querySelector(".ai-book__turn-sheet"))');
  await wait(200);
  await mouse('mouseReleased', mouseStart.x - 20, 0);
  await until('document.querySelector("[data-book]").dataset.bookTurning !== "true"');
  assert.deepEqual(await browser.evaluate('({count:document.querySelector("[data-book-page-count]").textContent,text:document.querySelector("[data-book-accessible]").textContent,art:document.querySelector("[data-book-contour]").getAttribute("d"),sessions:window.__bookSessions})'), originalSpread, 'A short slow drag returns without new text, artwork or inference');

  await mouse('mousePressed', mouseStart.x);
  await mouse('mouseMoved', mouseStart.x - 20);
  await until('Boolean(document.querySelector(".ai-book__turn-sheet"))');
  await mouse('mouseMoved', mouseStart.x - bookBox.width * .225);
  await wait(60);
  const held = await browser.evaluate('({times:document.querySelector(".ai-book__turn-sheet").getAnimations().map(a=>a.currentTime),state:document.querySelector(".ai-book__turn-sheet").getAnimations()[0].playState,transform:getComputedStyle(document.querySelector(".ai-book__turn-sheet")).transform})');
  assert.equal(held.state, 'paused');
  assert.ok(Math.abs(held.times[0] - 405) < 10, 'Paper progress follows the actual mouse distance');
  await wait(100);
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".ai-book__turn-sheet")).transform'), held.transform, 'The held page stays under the mouse');
  await screenshot('mouse-curl');
  await mouse('mouseReleased', mouseStart.x - bookBox.width * .225, 0);
  await until('document.querySelector("[data-book]").dataset.bookTurning !== "true" && document.querySelector("[data-book]").dataset.bookGenerated === "true"');
  assert.equal(await browser.evaluate('window.__bookSessions'), originalSpread.sessions + 1, 'A successful new spread generates exactly once');
  assert.notEqual(await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")'), originalSpread.art);
  assert.equal(await browser.evaluate('document.querySelector("[data-book-page-count]").textContent'), '03 — 04');
  const nextArt = await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")');
  const mouseBackX = bookBox.left + bookBox.width * .1;
  await mouse('mousePressed', mouseBackX);
  await mouse('mouseMoved', mouseBackX + 20);
  await until('Boolean(document.querySelector(".ai-book__turn-sheet--backward"))');
  await mouse('mouseMoved', mouseBackX + bookBox.width * .3);
  await mouse('mouseReleased', mouseBackX + bookBox.width * .3, 0);
  await until('document.querySelector("[data-book-page-count]").textContent === "01 — 02" && document.querySelector("[data-book]").dataset.bookTurning !== "true"');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")'), originalSpread.art, 'Dragging backward restores retained artwork');
  await mouse('mousePressed', mouseStart.x);
  await mouse('mouseReleased', mouseStart.x, 0);
  await until('document.querySelector("[data-book-page-count]").textContent === "03 — 04" && document.querySelector("[data-book]").dataset.bookTurning !== "true"');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")'), nextArt, 'An edge click turns a retained page');
  assert.equal(await browser.evaluate('window.__bookSessions'), originalSpread.sessions + 1, 'History navigation does not repeat inference');

  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await browser.evaluate('window.__bookSentence="Small moments of patient attention give a curious mind room to discover a fresh and useful possibility.";document.querySelector(".ai-book__stage").scrollIntoView({block:"center"})');
  await wait(100);
  const touchBox = await browser.evaluate('document.querySelector(".ai-book__volume").getBoundingClientRect().toJSON()');
  const touchX = touchBox.right - touchBox.width * .1, touchY = touchBox.top + touchBox.height * .6;
  const touch = (type, x) => browser.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: touchY, id: 1 }] });
  await touch('touchStart', touchX);
  await touch('touchMove', touchX - 20);
  await until('Boolean(document.querySelector(".ai-book__turn-sheet"))');
  await touch('touchMove', touchX - touchBox.width * .32);
  await screenshot('finger-curl');
  await touch('touchEnd', touchX - touchBox.width * .32);
  await until('document.querySelector("[data-book-page-count]").textContent === "05 — 06" && document.querySelector("[data-book]").dataset.bookGenerated === "true" && document.querySelector("[data-book]").dataset.bookTurning !== "true"');
  assert.match(await browser.evaluate('document.querySelector("[data-book-accessible]").textContent'), /^Small moments/);
  assert.notEqual(await browser.evaluate('document.querySelector("[data-book-contour]").getAttribute("d")'), nextArt, 'A finger turn generates new contour artwork');
  assert.equal(await browser.evaluate('window.__bookSessions'), originalSpread.sessions + 2);
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.evaluate('document.querySelector(".ai-book__stage").scrollIntoView({block:"center"})');
  await wait(200); // Settle the new viewport and the book's visibility observer.

  await browser.evaluate('document.querySelector("[data-book-replay]").click()');
  await until('document.querySelector("[data-book]").dataset.bookWriting === "true"');
  await browser.evaluate('var animation=document.querySelector("[data-book-animate]");animation.checked=false;animation.dispatchEvent(new Event("change"))');
  assert.equal(await browser.evaluate('document.querySelector("[data-book]").dataset.bookWriting'), 'false');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-output]").textContent'), await browser.evaluate('document.querySelector("[data-book-accessible]").textContent'), 'Animation opt-out leaves a complete inscription');
  await browser.evaluate('document.querySelector("[data-widget-tab=book]").focus()');
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft' });
  assert.equal(await browser.evaluate('document.querySelector("[data-widget-tab=watch]").getAttribute("aria-selected")'), 'true');
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
  assert.equal(await browser.evaluate('document.querySelector("[data-widget-tab=book]").getAttribute("aria-selected")'), 'true');

  for (const width of [390, 320]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate('document.querySelector("#ai-widgets").scrollIntoView({block:"start"})');
    await wait(150);
    const fit = await browser.evaluate(`(()=>{const p=document.querySelector('[data-book-output]'),area=p.parentElement;return {overflow:document.documentElement.scrollWidth>innerWidth,textHeight:p.scrollHeight,available:area.clientHeight,font:parseFloat(getComputedStyle(p).fontSize)}})()`);
    assert.equal(fit.overflow, false, `No horizontal overflow at ${width}px`);
    assert.ok(fit.textHeight <= fit.available + 2, `The inscription fits at ${width}px`);
    assert.ok(fit.font >= 17, 'Handwriting stays readable');
    await screenshot(`mobile-${width}`);
  }
  await browser.evaluate('window.__bookSentence="With patient hands and a curious heart, the maker follows the quiet grain of each ordinary day, finding in every small imperfection a promise that careful attention can turn simple beginnings into something beautiful enough to share with the world.";document.querySelector("[data-book-generate]").click()');
  await until('document.querySelector("[data-book-output]").textContent.startsWith("With patient hands")');
  const longFit = await browser.evaluate('(()=>{const p=document.querySelector("[data-book-output]"),volume=document.querySelector(".ai-book__volume"),stage=document.querySelector(".ai-book__stage");return {height:p.scrollHeight,available:p.parentElement.clientHeight,font:getComputedStyle(p).fontSize,volume:volume.getBoundingClientRect().toJSON(),stage:stage.getBoundingClientRect().toJSON()}})()');
  assert.ok(longFit.height <= longFit.available + 2, 'A long accepted model sentence fits the narrowest book');
  assert.ok(longFit.volume.left >= longFit.stage.left && longFit.volume.right <= longFit.stage.right, 'Taller pages keep both leaves inside the book stage');
  await screenshot('mobile-long');
  await browser.evaluate('document.documentElement.dataset.theme="dark"');
  await screenshot('mobile-dark');

  // Visit complete mode cycles through the product UI. Only language output is mocked;
  // every SVG remains a real browser rollout from the verified trained checkpoint.
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const coverage = [];
  for (const mode of ['ai', 'profile', 'wellbeing']) {
    const sentence = mode === 'profile'
      ? 'Daniil completed a master’s in Computational Science and Engineering at ETH Zurich, focusing on robotics. [[site:bio-2]]'
      : 'Small moments of patient attention give a curious mind room to discover a fresh and useful possibility.';
    await browser.evaluate(`window.__bookSentence=${JSON.stringify(sentence)};var theme=document.querySelector('[data-book-topic]');theme.value=${JSON.stringify(mode === 'ai' ? 'wellbeing' : 'ai')};theme.dispatchEvent(new Event('change'));theme.value=${JSON.stringify(mode)};theme.dispatchEvent(new Event('change'));document.querySelector('.ai-book__writing-area').scrollIntoView({block:'center'});`);
    await until('document.querySelector("[data-book]").dataset.bookTurning !== "true" && document.querySelector("[data-book-page-count]").textContent === "01 — 02"');
    await browser.evaluate('document.querySelector(".ai-book__writing-area").scrollIntoView({block:"center"})');
    await wait(150);
    const drawings = [];
    for (let index = 0; index < 16; index++) {
      if (index) {
        const oldCounter = await browser.evaluate('document.querySelector("[data-book-page-count]").textContent');
        await browser.evaluate('document.querySelector("[data-book-next]").click()');
        await until(`document.querySelector('[data-book-page-count]').textContent !== ${JSON.stringify(oldCounter)} && document.querySelector('[data-book]').dataset.bookTurning !== 'true' && document.querySelector('[data-book]').dataset.bookGenerated === 'true'`);
      }
      const drawing = await browser.evaluate(`(()=>{const svg=document.querySelector('[data-book-artwork]');return {kind:svg.dataset.contourKind,seed:Number(svg.dataset.contourSeed),path:svg.querySelector('[data-book-contour]').getAttribute('d'),accent:svg.querySelector('[data-book-contour-accent]').getAttribute('d')}})()`);
      assert.ok(servedCheckpoint.metadata.shapes.includes(drawing.kind), `${mode}: known trained family`);
      assert.equal((drawing.path.match(/C/g) ?? []).length, 95, `${mode}: a complete 96-point learned contour`);
      assert.equal(drawing.path.endsWith('Z'), servedCheckpoint.metadata.closed[servedCheckpoint.metadata.shapes.indexOf(drawing.kind)]);
      assert.ok(!/NaN|Infinity/.test(drawing.path));
      drawings.push(drawing);
    }
    assert.equal(new Set(drawings.map(drawing => drawing.path)).size, 16, `${mode}: all visited spreads have distinct real artwork`);
    assert.equal(new Set(drawings.map(drawing => drawing.kind)).size, mode === 'wellbeing' ? 16 : 8, `${mode}: a complete cycle covers the mode's trained family pool`);
    coverage.push({ mode, drawings });
  }
  assert.equal(new Set(coverage.flatMap(item => item.drawings.map(drawing => drawing.kind))).size, 16, 'The live UI exposes all sixteen trained contour families');
  assert.equal(await browser.evaluate('window.__bookContourFetches.length'), 2, 'Forty-eight distinct spreads reuse the same verified checkpoint');
  await writeFile(`${directory}/contour-mode-coverage.json`, JSON.stringify({ base, checkpointSha256, weightBytes: 208520, points: 96, modes: coverage }, null, 2));
  assert.deepEqual(await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/\\.(onnx|wasm)(\\?|$)/.test(n))'), []);
  assert.equal(await browser.evaluate('window.__bookCloudCalls'), 0, 'The book never requests a cloud provider');
  assert.deepEqual(await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/api\\.(?:openai|anthropic)\\.com|\\/v1\\/chat(?:[?#]|$)/.test(n))'), [], 'No cloud requests appear in browser resources');

  // A fresh local-device offer must stop at consent: no real LLM is downloaded.
  // This only mocks capability probing; the existing widget and download lifecycle are real.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__bookAvailability='downloadable';
    Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:async()=>({features:{has:()=>true}})}});
    Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:8});
    Object.defineProperty(navigator,'connection',{configurable:true,value:{saveData:false,effectiveType:'4g'}});
    navigator.storage.estimate=async()=>({quota:4000000000,usage:0});
  ` });
  await browser.send('Page.navigate', { url: `${base}/` });
  await until('Boolean(document.querySelector("[data-widget-tab=book]") && document.querySelector("#ai-book")?.hidden)');
  await browser.evaluate('document.querySelector("[data-widget-tab=book]").click();document.querySelector(".ai-book__writing-area").scrollIntoView({block:"center"})');
  await until('Boolean(document.querySelector("[data-book-contour]").getAttribute("d"))');
  await browser.evaluate('document.querySelector("[data-book-generate]").click()');
  await until('document.querySelector("[data-book-consent]").hidden === false');
  assert.match(await browser.evaluate('document.querySelector("[data-book-consent]").textContent'), /885 MB.*huggingface\.co/s);
  assert.equal(await browser.evaluate('window.__bookSessions'), 0, 'A downloadable browser model is never created implicitly');
  assert.deepEqual(await browser.evaluate('window.__bookFetchUrls.filter(url=>/huggingface\\.co|cdn\\.hf\\.co|\\.(?:onnx|wasm)(?:[?#]|$)/.test(url))'), [], 'Opening consent downloads no language weights or runtime');
  await browser.evaluate('document.querySelector("[data-book-cancel]").click()');
  assert.equal(await browser.evaluate('document.querySelector("[data-book-consent]").hidden'), true);
  assert.equal(await browser.evaluate('window.__bookCloudCalls'), 0);
  assert.deepEqual(await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/\\.(onnx|wasm)(\\?|$)/.test(n))'), []);
  await screenshot('local-download-consent-cancelled');
  console.log('Browser checks passed: live frozen v2 weight hash, sixteen trained families across forty-eight real spreads, shared thought modes and sources, mouse/touch seeking and release, snap-back, edge taps and history, curl and pause, lazy cached assets, moving feather, local-only output and citations, consent without downloads, zero cloud requests, keyboard, animation opt-out, mobile fit and dark appearance.');
} catch (error) {
  console.error(await browser.evaluate('({status:document.querySelector("[data-book-status]")?.textContent,note:document.querySelector("[data-book-model-note]")?.textContent,origin:document.querySelector("[data-book-origin]")?.textContent,count:document.querySelector("[data-book-page-count]")?.textContent,book:document.querySelector("[data-book]")?.dataset,sessions:window.__bookSessions,cloud:window.__bookCloudCalls})'));
  await screenshot('failure');
  throw error;
} finally { await browser.close(); }
