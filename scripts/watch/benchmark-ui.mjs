/** UI timing and actual Learn-worker progress, on an isolated desktop browser. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startBrowser } from '../watch-language/browser-helper.mjs';
const url = process.env.WATCH_QA_URL ?? 'http://127.0.0.1:4331';
const browser = await startBrowser(`${url}/smart-watch/`, { width: 1440, height: 1100 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await wait(1200);
  for (let i = 0; i < 100; i++) {
    if (await browser.evaluate('getComputedStyle(document.querySelector("[data-watch-plane]")).display !== "none"')) break;
    await wait(100);
  }
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("[data-watch-plane]")).display === "none"'), false, 'Trained aircraft policy must load before measurement');
  await browser.evaluate('document.querySelector("[data-watch]").scrollIntoView({block:"center"})');
  await wait(1200);
  const frames = await browser.evaluate(`new Promise(resolve=>{const intervals=[];let last=performance.now(),start=last,maxPhaseError=0;
    const tick=now=>{intervals.push(now-last);last=now;
      const second=document.querySelector('[data-watch-hand="second"]').getAttribute('transform').match(/rotate\\(([-\\d.]+)/);
      const plane=document.querySelector('[data-watch-plane]').getAttribute('transform').match(/translate\\(([-\\d.]+) ([-\\d.]+)/);
      if(second&&plane){const theta=Math.atan2(Number(plane[1])-220,220-Number(plane[2]));const expected=Number(second[1])*Math.PI/180;const error=Math.abs(Math.atan2(Math.sin(theta-expected),Math.cos(theta-expected)));maxPhaseError=Math.max(maxPhaseError,error);}
      if(now-start<8000)requestAnimationFrame(tick);else{intervals.sort((a,b)=>a-b);const at=p=>intervals[Math.min(intervals.length-1,Math.floor(intervals.length*p))];resolve({frames:intervals.length,medianMs:at(.5),p95Ms:at(.95),p99Ms:at(.99),maxPhaseErrorRadians:maxPhaseError,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null});}
    };requestAnimationFrame(tick);})`);
  console.log(JSON.stringify({frameSample:frames}));
  assert.ok(frames.maxPhaseErrorRadians < .0001, 'Aircraft remains locked to displayed seconds');
  await browser.evaluate('(()=>{document.querySelector(".chronos__settings").open=true;const learn=document.querySelector("[data-watch-learn]");learn.checked=true;learn.dispatchEvent(new Event("change",{bubbles:true}));})()');
  let progress = '';
  for (let i = 0; i < 40; i++) {
    await wait(1000);
    progress = await browser.evaluate('document.querySelector("[data-watch-learning]").textContent');
    if (/Learning in simulation.*[1-9][\d,]* steps/.test(progress)) break;
  }
  assert.match(progress, /Learning in simulation.*[1-9][\d,]* steps/);
  await browser.evaluate('(()=>{const learn=document.querySelector("[data-watch-learn]");learn.checked=false;learn.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait(1100);
  assert.match(await browser.evaluate('document.querySelector("[data-watch-learning]").textContent'), /Frozen trained policy/);
  const app = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).find(name=>/\\/app\\.[^/]+\\.js/.test(name))');
  await browser.evaluate(`(async()=>{window.watchModule=await import(${JSON.stringify(app)});window.detachedWatch=document.querySelector('[data-watch]').cloneNode(true);document.body.append(window.detachedWatch);window.watchHandle=window.watchModule.mountSmartWatch(window.detachedWatch);})()`);
  await wait(500);
  for (let i = 0; i < 4; i++) {
    await browser.evaluate('window.watchHandle.unmount();window.watchHandle=window.watchModule.mountSmartWatch(window.detachedWatch)'); await wait(100);
  }
  await browser.evaluate('window.watchHandle.unmount();window.detachedWatch.remove()');
  const version = (await browser.send('Browser.getVersion')).product;
  const appFile = new URL(app).pathname.split('/').at(-1);
  const appSha256 = createHash('sha256').update(await readFile(`build/_astro/${appFile}`)).digest('hex');
  const result = { version, device: 'Apple M3 Pro, macOS 27.2, isolated headless Chrome', viewport: '1440×1100', frames, learningProgress: progress,
    learningStopped: true, repeatedMountUnmount: 5, appAsset: { file: appFile, sha256: appSha256 }, methodology: '8-second foreground RAF sample, visible clock/aircraft; phase measured from displayed hand/plane transforms. Desktop only; browser heap excludes process RSS, GPU and WASM.' };
  await writeFile('/tmp/chronos-qa/ui-benchmark.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
