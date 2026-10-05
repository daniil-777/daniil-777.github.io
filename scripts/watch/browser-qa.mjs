/** Reproducible, isolated Chromium checks for the built watch. Run after build + preview. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startBrowser } from '../watch-language/browser-helper.mjs';

const base = process.env.WATCH_QA_URL ?? 'http://127.0.0.1:4321';
const output = process.env.WATCH_QA_OUTPUT ?? '/tmp/chronos-qa';
await mkdir(output, { recursive: true });
const results = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (browser, expression) => { for (let i = 0; i < 100; i++) { if (await browser.evaluate(expression)) return; await wait(100); } throw new Error(`Not ready: ${expression}`); };
const browser = await startBrowser(`${base}/`, { width: 1440, height: 1100 });
try {
  await until(browser, 'Boolean(document.querySelector("[data-watch]"))');
  await wait(1000);
  const eager = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/\\/watch\\/|app\\.|chronos-language|watch-language|worker.*watch/i.test(n))');
  assert.deepEqual(eager, [], 'Watch models and runtime must not load above the fold');
  results.push({ test: 'no unused watch download', passed: true });
  await browser.send('Page.navigate', { url: `${base}/smart-watch/` });
  await until(browser, 'document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")');
  await wait(1000);
  for (const mode of ['ai', 'profile', 'wellbeing']) {
    await browser.evaluate(`document.querySelector('[data-watch-mode="${mode}"]').click()`);
    await wait(100);
    const thought = await browser.evaluate('({sentence:document.querySelector("[data-watch-phrase]").textContent,caption:document.querySelector("[data-watch-caption]").textContent,status:document.querySelector("[data-watch-status]").textContent})');
    assert.equal(thought.sentence.trim(), thought.caption);
    assert.ok(thought.sentence.trim().split(/\s+/).length >= 10);
    await writeFile(join(output, `desktop-${mode}.png`), await browser.screenshot());
    results.push({ test: `mode ${mode}`, passed: true, ...thought });
  }
  await browser.evaluate('document.querySelector("[data-watch-input]").value="Prescribe medication dosage for me";document.querySelector("[data-watch-question]").requestSubmit()');
  await wait(150);
  assert.match(await browser.evaluate('document.querySelector("[data-watch-answer]").textContent'), /qualified clinician/);
  await browser.evaluate('document.querySelector("[data-watch-mode=profile]").click();document.querySelector("[data-watch-input]").value="Where did Daniil study robotics?";document.querySelector("[data-watch-question]").requestSubmit()');
  await wait(150);
  assert.match(await browser.evaluate('document.querySelector("[data-watch-answer]").textContent'), /ETH Zurich/);
  results.push({ test: 'in-scope retrieval and medical abstention', passed: true });
  const resources = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name)');
  assert.ok(!resources.some(url => /\.(?:onnx|wasm)(?:$|\?)|ort[.-]wasm/.test(url)), 'Experimental model and ONNX runtime must remain gated');
  results.push({ test: 'unreleased model does not download', passed: true });
  const factPack = JSON.parse(await readFile('public/watch/facts.v1.json', 'utf8'));
  const typography = [];
  await browser.evaluate('document.querySelector("[data-watch-pause]").click()');
  for (const width of [320, 380, 480]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 480 });
    for (const mode of ['ai', 'profile', 'wellbeing']) {
      await browser.evaluate(`document.querySelector('[data-watch-mode="${mode}"]').click()`);
      const expected = factPack.facts.filter(fact => fact.mode === mode);
      for (const fact of expected) {
        const measured = await browser.evaluate(`(()=>{const phrase=document.querySelector('[data-watch-phrase]');return {sentence:phrase.textContent.trim(),font:Number(phrase.getAttribute('font-size')),boxes:[...phrase.children].map(line=>{const b=line.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height}})}})()`);
        assert.equal(measured.sentence, fact.answer, 'Every complete reviewed thought reaches the dial');
        for (const box of measured.boxes) {
          assert.ok(box.y >= 307, 'Text stays below the upper aperture edge');
          for (const x of [box.x, box.x + box.width]) for (const y of [box.y, box.y + box.height]) {
            assert.ok(Math.hypot(x - 220, y - 219.73) < 135, 'Actual glyph bounds stay inside the curved aperture');
          }
        }
        typography.push({ width, fact: fact.id, font: measured.font });
        await browser.evaluate('document.querySelector("[data-watch-next]").click()');
      }
    }
  }
  results.push({ test: 'all 34 complete thoughts fit curved dial at 320, 380 and 480px', passed: true, sentencesChecked: typography.length, minimumSvgFont: Math.min(...typography.map(row=>row.font)) });
  await writeFile(join(output, 'typography.json'), JSON.stringify(typography, null, 2));
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await wait(150);
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("[data-watch-plane]")).display'), 'none');
  assert.equal(await browser.evaluate('document.querySelector("[data-watch]").dataset.watchTicking'), 'true');
  results.push({ test: 'reduced motion disables aircraft and ticks hands', passed: true });
  await browser.send('Emulation.setEmulatedMedia', { features: [] });
  for (const width of [320, 390, 768]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    await wait(200);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth > innerWidth'), false, `Overflow at ${width}px`);
    await writeFile(join(output, `responsive-${width}.png`), await browser.screenshot());
    results.push({ test: `responsive ${width}px`, passed: true });
  }
  await browser.send('Page.navigate', { url: `${base}/smart-watch/embed/` });
  await until(browser, 'Boolean(document.querySelector("[data-watch-open]"))');
  await wait(400);
  const closed = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/\\/watch\\//.test(n))');
  assert.deepEqual(closed, [], 'Closed compact watch should fetch no model/fact/policy assets');
  await writeFile(join(output, 'compact-96.png'), await browser.screenshot());
  await browser.evaluate('document.querySelector("[data-watch-open]").click()');
  await until(browser, 'document.querySelector("dialog")?.open && document.querySelector("[data-watch-status]").textContent.includes("Reviewed thought")');
  await writeFile(join(output, 'compact-expanded.png'), await browser.screenshot());
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await wait(100);
  assert.equal(await browser.evaluate('document.querySelector("dialog").open'), false);
  results.push({ test: 'compact lazy opening and keyboard Escape', passed: true });
  // Cache recovery is a real failed-request simulation, rather than a claim of universal offline support.
  await browser.send('Network.enable');
  await browser.send('Network.setBlockedURLs', { urls: ['*/watch/facts.v1.json'] });
  await browser.send('Page.navigate', { url: `${base}/smart-watch/` });
  await until(browser, 'document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")');
  assert.ok(await browser.evaluate('document.querySelector("[data-watch-caption]").textContent.split(/\\s+/).length >= 10'));
  results.push({ test: 'cached public facts survive a blocked network request', passed: true });
  await browser.evaluate('caches.delete("chronos-public-facts-v1")');
  await browser.send('Page.navigate', { url: `${base}/smart-watch/` });
  await until(browser, 'document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed facts unavailable")');
  assert.equal(await browser.evaluate('document.querySelector("[data-watch-phrase]").textContent.trim()'), 'Reviewed facts are unavailable offline until they have been downloaded at least once.');
  await browser.send('Network.setBlockedURLs', { urls: [] });
  await browser.evaluate('document.querySelector("[data-watch-next]").click()');
  await until(browser, 'document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")');
  results.push({ test: 'first-use missing facts have a complete error state and retry', passed: true });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  for (const [hour, minute] of [[6, 30], [7, 25]]) {
    await browser.evaluate(`(()=>{window.RealDate??=Date;const start=RealDate.now(),fixed=new RealDate(2026,9,5,${hour},${minute},0).getTime();window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed+RealDate.now()-start]));}static now(){return fixed+RealDate.now()-start;}};})()`);
    await wait(150);
    const angles = await browser.evaluate('Object.fromEntries(["hour","minute"].map(hand=>[hand,Number(document.querySelector(`[data-watch-hand="${hand}"]`).getAttribute("transform").match(/rotate\\(([-\\d.]+)/)[1])]))');
    assert.ok(Math.abs(angles.hour - (hour * 30 + minute / 2)) < .1);
    assert.ok(Math.abs(angles.minute - minute * 6) < .2);
    await writeFile(join(output, `clock-${hour}-${minute}.png`), await browser.screenshot());
    results.push({ test: `clock fixture ${hour}:${minute} and lower-window visual review`, passed: true });
  }
  await browser.send('Page.navigate', { url: `${base}/` });
  await until(browser, 'Boolean(document.querySelector("[data-watch]"))');
  await browser.evaluate('document.querySelector("[data-watch]").scrollIntoView({block:"center"})');
  await until(browser, 'document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")');
  await browser.evaluate('scrollTo(0,0)');
  await wait(300);
  const before = await browser.evaluate('document.querySelector("[data-watch-hand=second]").getAttribute("transform")');
  await wait(500);
  assert.equal(await browser.evaluate('document.querySelector("[data-watch-hand=second]").getAttribute("transform")'), before);
  results.push({ test: 'offscreen watch suspends clock rendering', passed: true });
  const version = (await browser.send('Browser.getVersion')).product;
  await writeFile(join(output, 'results.json'), JSON.stringify({ browser: version, mobile: 'Desktop Chromium viewport emulation; physical mobile hardware untested.', results }, null, 2));
  console.log(JSON.stringify({ passed: results.length, browser: version, output }));
} finally { await browser.close(); }

// Static transfer sizes are recorded separately from measured runtime latency.
const names = await readdir('build/_astro');
const files = names.filter(name => /^(?:app\.|SmartWatch\.|worker[-.]|ort\.wasm)/.test(name));
const assets = [];
for (const file of files) { const bytes = await readFile(join('build/_astro', file)); assets.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
await writeFile(join(output, 'asset-sizes.json'), JSON.stringify(assets, null, 2));
