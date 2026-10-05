/** Foreground clock timing and retained-aircraft isolation, in an isolated desktop browser. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startBrowser } from '../watch-language/browser-helper.mjs';
const url = process.env.WATCH_QA_URL ?? 'http://127.0.0.1:4331';
const output = process.env.WATCH_QA_OUTPUT ?? '/tmp/chronos-qa';
await mkdir(output, { recursive: true });
const browser = await startBrowser(`${url}/smart-watch/`, { width: 1440, height: 1100 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const planeWorkerPaths = [];
for (const name of (await readdir('build/_astro')).filter(name => /^worker[-.].*\.js$/.test(name))) {
  if ((await readFile(join('build/_astro', name), 'utf8')).includes('planeRadialHalfWidth')) planeWorkerPaths.push(`/_astro/${name}`);
}
assert.ok(planeWorkerPaths.length > 0, 'The aircraft trainer code remains in the build');
const aircraftState = String.raw`(()=>{
  const root=document.querySelector('[data-watch]'),settings=root.querySelector('.chronos__settings');
  const previous=settings.open;settings.open=true;
  const selector='[data-watch-plane],[data-watch-clouds],[data-watch-plane-toggle],[data-watch-clouds-toggle],[data-watch-learn],[data-watch-reset-learn],[data-watch-learning],[data-watch-metrics]';
  const visible=[...root.querySelectorAll(selector)].filter(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
    return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';}).map(n=>n.outerHTML.slice(0,120));
  settings.open=previous;
  return {enabled:root.dataset.watchAircraft,visible,downloads:performance.getEntriesByType('resource').map(r=>r.name)
    .filter(n=>/\/watch\/plane\//.test(n)||${JSON.stringify(planeWorkerPaths)}.includes(new URL(n).pathname))};
})()`;
const assertAircraftDisabled = state => {
  assert.equal(state.enabled, 'false');
  assert.deepEqual(state.visible, []);
  assert.deepEqual(state.downloads, [], 'Retained aircraft policies and workers must not load on public watches');
};
try {
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  for (let i = 0; i < 100; i++) {
    if (await browser.evaluate('document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")')) break;
    await wait(100);
  }
  assert.match(await browser.evaluate('document.querySelector("[data-watch-status]").textContent'), /Reviewed thought/);
  await browser.evaluate('document.querySelector("[data-watch]").scrollIntoView({block:"center"})');
  await wait(1200);
  assertAircraftDisabled(await browser.evaluate(aircraftState));
  const frames = await browser.evaluate(`new Promise(resolve=>{const intervals=[];let last=performance.now(),start=last,previous='',handChanges=0;
    const tick=now=>{intervals.push(now-last);last=now;
      const second=document.querySelector('[data-watch-hand="second"]').getAttribute('transform');
      if(previous&&second!==previous)handChanges++;previous=second;
      if(now-start<8000)requestAnimationFrame(tick);else{intervals.sort((a,b)=>a-b);const at=p=>intervals[Math.min(intervals.length-1,Math.floor(intervals.length*p))];resolve({frames:intervals.length,medianMs:at(.5),p95Ms:at(.95),p99Ms:at(.99),handChanges,maxPhaseErrorRadians:null,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null});}
    };requestAnimationFrame(tick);})`);
  assert.ok(frames.handChanges > 0, 'The analogue clock continues moving while aircraft is disabled');
  console.log(JSON.stringify({ frameSample: frames }));
  const app = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).find(name=>/\\/app\\.[^/]+\\.js/.test(name))');
  assert.ok(app, 'Public watch module must have loaded');
  await browser.evaluate(`(async()=>{window.watchModule=await import(${JSON.stringify(app)});window.detachedWatch=document.querySelector('[data-watch]').cloneNode(true);document.body.append(window.detachedWatch);window.watchHandle=window.watchModule.mountSmartWatch(window.detachedWatch);})()`);
  await wait(500);
  for (let i = 0; i < 4; i++) {
    await browser.evaluate('window.watchHandle.unmount();window.watchHandle=window.watchModule.mountSmartWatch(window.detachedWatch)'); await wait(100);
  }
  await browser.evaluate('window.watchHandle.unmount();window.detachedWatch.remove()');
  const disabled = await browser.evaluate(aircraftState);
  assertAircraftDisabled(disabled);
  const version = (await browser.send('Browser.getVersion')).product;
  const appFile = new URL(app).pathname.split('/').at(-1);
  const appSha256 = createHash('sha256').update(await readFile(`build/_astro/${appFile}`)).digest('hex');
  const result = { version, device: 'Apple M3 Pro, macOS 27.2, isolated headless Chrome', viewport: '1440×1100', frames,
    aircraftEnabled: false, aircraftDownloads: disabled.downloads, learningEnabled: false, repeatedMountUnmount: 5,
    appAsset: { file: appFile, sha256: appSha256 }, methodology: '8-second foreground RAF sample of the visible analogue clock; aircraft phase and learning are disabled on public watches. Five mount/unmount cycles retain that isolation. Desktop only; browser heap excludes process RSS, GPU and WASM.' };
  await writeFile(join(output, 'ui-benchmark.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
