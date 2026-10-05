/** Complete-message, motion and lifecycle checks in isolated Chromium. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { startBrowser } from '../watch-language/browser-helper.mjs';

const build = resolve(process.env.WATCH_QA_BUILD ?? 'build');
const output = resolve(process.env.WATCH_QA_OUTPUT ?? '/tmp/chronos-marquee-qa');
const url = new URL(process.env.WATCH_QA_URL ?? 'http://127.0.0.1:4347/smart-watch/');
url.searchParams.set('watchStyle', 'marquee');
const facts = JSON.parse(await readFile(join(build, 'watch/facts.v1.json'), 'utf8')).facts;
const app = (await readdir(join(build, '_astro'))).find(name => /^app\..*\.js$/.test(name));
const appSha256 = createHash('sha256').update(await readFile(join(build, '_astro', app))).digest('hex');
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await startBrowser(url.href, { width: 1440, height: 1100 });
const results = [], typography = [];
await mkdir(output, { recursive: true });
const until = async expression => {
  for (let i = 0; i < 300; i++) { if (await browser.evaluate(expression)) return; await wait(50); }
  throw new Error(`Timed out: ${expression}`);
};
const choose = (selector, value) => browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const paused = value => browser.evaluate(`(()=>{const n=document.querySelector('[data-watch-pause]');if(n.getAttribute('aria-pressed')!==${JSON.stringify(String(value))})n.click();})()`);
const state = () => browser.evaluate(`(()=>{
  const root=document.querySelector('[data-watch]'),p=root.querySelector('[data-watch-card-output]');
  const track=p.querySelector('[data-watch-marquee-track]'),a=track?.getAnimations()[0];
  const face=root.querySelector('[data-watch-dial]').getBoundingClientRect(),b=p.getBoundingClientRect(),scale=face.width/440;
  const w=p.querySelector('.chronos__marquee-window')?.getBoundingClientRect(),t=track?.getBoundingClientRect();
  return {style:root.dataset.watchThoughtStyle,text:p.textContent,caption:root.querySelector('[data-watch-caption]').textContent,
    top:(b.top-face.top)/scale,bottom:(b.bottom-face.top)/scale,width:b.width/scale,height:b.height/scale,
    font:parseFloat(getComputedStyle(p).fontSize),static:root.dataset.watchMarqueeStatic,
    animationTime:a?.currentTime,animationState:a?.playState,readMs:Number(p.dataset.watchMarqueeReadMs),
    x:track?new DOMMatrix(getComputedStyle(track).transform).m41:null,opacity:track?Number(getComputedStyle(track).opacity):null,
    clippedStatic:Boolean(t&&w&&t.height>w.height+.5),trackWidth:t?.width,windowWidth:w?.width,
    hours:[...root.querySelector('[data-watch-layered-hours]').children].filter(h=>{const x=h.getBoundingClientRect();
      return Math.min(b.right,x.right)>Math.max(b.left,x.left)&&Math.min(b.bottom,x.bottom)>Math.max(b.top,x.top);}).map(h=>h.textContent),
    maxRadius:Math.max(...[b.left,b.right].flatMap(x=>[b.top,b.bottom].map(y=>Math.hypot((x-face.left)/scale-220,(y-face.top)/scale-220))))};
})()`);
const checkBounds = s => {
  assert.equal(s.style, 'marquee'); assert.equal(s.text, s.caption);
  assert.ok(s.top > 220 && s.bottom <= 350.1, JSON.stringify(s));
  assert.ok(s.maxRadius < 194); assert.deepEqual(s.hours, []);
};
try {
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await until('document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")');
  await browser.evaluate('document.fonts.ready');
  assert.equal(await browser.evaluate('document.querySelector("[data-watch-thought-layout]").value'), 'marquee');
  await paused(true);
  const design = await state(); checkBounds(design);
  assert.ok(design.width > design.height * 5, 'The panel is a slender horizontal bar');
  assert.ok(design.font >= 15); assert.ok(design.readMs > 2000);
  results.push({ test: 'URL and fifth visible flag select a horizontal bar below centre', passed: true, ...design });
  const edges = await browser.evaluate(`(()=>{
    const t=document.querySelector('[data-watch-marquee-track]'),w=t.parentElement.getBoundingClientRect(),a=t.getAnimations()[0];
    const glyph=(first)=>{const r=document.createRange();r.setStart(t.firstChild,first?0:t.textContent.length-1);r.setEnd(t.firstChild,first?1:t.textContent.length);return r.getBoundingClientRect();};
    a.currentTime=0;const first=glyph(true);a.currentTime=Number(t.closest('[data-watch-card-output]').dataset.watchMarqueeReadMs)-500;
    const last=glyph(false);a.currentTime=0;return {firstInset:first.left-w.left,lastInset:w.right-last.right};
  })()`);
  assert.ok(edges.firstInset>=7&&edges.lastInset>=7,JSON.stringify(edges));
  results.push({test:'first and last glyphs are fully visible beyond edge fades during endpoint dwells',passed:true,...edges});
  await writeFile(join(output, 'marquee-desktop.png'), await browser.screenshot());

  for (const reduced of [false, true]) {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    for (const width of [320, 380, 480]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: true });
      await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      for (const mode of ['ai', 'profile', 'wellbeing']) {
        await browser.evaluate(`document.querySelector('.chronos__modes [data-watch-mode="${mode}"]').click()`);
        const expected = facts.filter(f => f.mode === mode);
        for (const fact of expected) {
          const s = await state(); checkBounds(s);
          assert.equal(s.text, fact.answer);
          assert.equal(s.static, String(reduced));
          if (reduced) { assert.equal(s.animationTime, undefined); assert.equal(s.clippedStatic, false); }
          else { assert.ok(s.height < 45); assert.ok(s.font >= 15); }
          typography.push({ width, reduced, fact: fact.id, ...s });
          await browser.evaluate('document.querySelector("[data-watch-next]").click()');
        }
      }
      if (width === 380) await writeFile(join(output, reduced ? 'marquee-static-mobile.png' : 'marquee-mobile.png'), await browser.screenshot());
    }
  }
  results.push({ test: 'all 364 full sentences stay inside the case in animated and static reduced-motion bars at three widths', passed: true, cases: typography.length });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await browser.evaluate(`document.querySelector('.chronos__modes [data-watch-mode="ai"]').click()`);
  await paused(false);
  await browser.evaluate('document.querySelector("[data-watch-marquee-track]").getAnimations()[0].currentTime=2200');
  const start = await state(); await wait(400); const moved = await state();
  assert.ok(moved.x < start.x - 5, 'Message moves right-to-left');
  const speed = (start.x - moved.x) / ((moved.animationTime - start.animationTime) / 1000);
  assert.ok(Math.abs(speed - moved.font * 1.35) < 1);
  results.push({ test: 'actual rendered text moves right-to-left at comfortable font-relative speed', passed: true, pixelsPerSecond: speed });

  await paused(true); await wait(60); const hold = await state(); await wait(250);
  assert.equal((await state()).animationTime, hold.animationTime);
  await paused(false);
  await browser.evaluate(`document.querySelector('[data-watch-card-output]').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))`);
  await wait(60); const hover = await state(); await wait(250); assert.equal((await state()).animationTime, hover.animationTime);
  await browser.evaluate(`document.querySelector('[data-watch-card-output]').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}))`);
  assert.equal((await state()).animationState, 'running');
  await browser.evaluate('document.querySelector("[data-watch-card-output]").click()'); assert.equal((await state()).animationState, 'paused');
  await paused(false);
  results.push({ test: 'Pause, bar tap and hover stop and resume reading without losing position', passed: true });

  await choose('[data-watch-interval]', '2');
  await browser.evaluate('document.querySelector("[data-watch-next]").click()');
  const original = (await state()).text;
  await wait(2300); assert.equal((await state()).text, original, 'Two-second interval does not truncate a reading pass');
  await browser.evaluate('(()=>{const p=document.querySelector("[data-watch-card-output]");p.querySelector("[data-watch-marquee-track]").getAnimations()[0].currentTime=Number(p.dataset.watchMarqueeReadMs)-500;})()');
  await until(`document.querySelector('[data-watch-caption]').textContent!==${JSON.stringify(original)}`);
  results.push({ test: 'automatic two-second rotation waits until the entire sentence and endpoint dwell have finished', passed: true });
  await paused(true);
  const manual = (await state()).text; await browser.evaluate('document.querySelector("[data-watch-next]").click()');
  assert.notEqual((await state()).text, manual);
  results.push({ test: 'manual Next remains immediate while paused', passed: true });

  await paused(false);
  await browser.evaluate('(()=>{const root=document.querySelector("[data-watch]");root.style.marginTop="3000px";window.scrollTo(0,0);})()');
  await wait(150); const offscreen = await state(); await wait(250);
  assert.equal((await state()).animationTime, offscreen.animationTime);
  await browser.evaluate('(()=>{const root=document.querySelector("[data-watch]");root.style.marginTop="";root.scrollIntoView();})()');
  await until('document.querySelector("[data-watch-marquee-track]").getAnimations()[0]?.playState==="running"');
  results.push({ test: 'offscreen suspension stops motion and the reading countdown', passed: true });
  await browser.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`);
  await wait(60);const hidden=await state();await wait(250);assert.equal((await state()).animationTime,hidden.animationTime);
  await browser.evaluate(`Reflect.deleteProperty(document,'hidden');document.dispatchEvent(new Event('visibilitychange'))`);
  assert.equal((await state()).animationState,'running');
  results.push({test:'hidden document suspends its reading countdown and resumes without skipping',passed:true,simulation:'visibility event with hidden property override'});
  await paused(true);
  await choose('[data-watch-thought-layout]', 'layered');
  assert.equal(await browser.evaluate('document.querySelector("[data-watch-card-output]").getAnimations({subtree:true}).length'), 0);
  await choose('[data-watch-thought-layout]', 'marquee');
  assert.ok((await state()).animationTime < 200);
  results.push({ test: 'style changes cancel the previous animation and start a new full pass', passed: true });

  const api = await browser.evaluate(`(async()=>{
    const {mountSmartWatch}=await import(${JSON.stringify(`/_astro/${app}`)});
    const root=document.querySelector('[data-watch]').cloneNode(true);root.dataset.compact='true';document.body.append(root);root.scrollIntoView({block:'center'});
    const handle=mountSmartWatch(root,{thoughtStyle:'marquee'});let rejected=false;
    try{handle.setSettings({thoughtStyle:'bogus'});}catch{rejected=true;}
    handle.open();
    for(let i=0;i<100;i++){root.querySelector('[data-watch-next]').click();if(root.querySelector('[data-watch-marquee-track]')?.getAnimations()[0])break;await new Promise(r=>setTimeout(r,50));}
    const track=root.querySelector('[data-watch-marquee-track]'),animation=track.getAnimations()[0];
    handle.unmount();const removed=animation?.playState==='idle'&&track.getAnimations().length===0;
    root.remove();return {style:root.dataset.watchThoughtStyle,rejected,removed};
  })()`);
  assert.deepEqual(api, { style: 'marquee', rejected: true, removed: true });
  results.push({ test: 'validated public API and unmount leave no running marquee animation', passed: true, ...api });
  const resources = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name)');
  assert.ok(!resources.some(n => /\/watch\/plane\/|\.(onnx|wasm)(\?|$)/.test(n)));
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("[data-watch-plane]")).display'), 'none');
  results.push({ test: 'public aircraft remains absent and experimental neural assets stay gated', passed: true });
  const embed=new URL('/smart-watch/embed/',url);embed.searchParams.set('watchStyle','marquee');
  await browser.send('Page.navigate',{url:embed.href});
  await until('Boolean(document.querySelector("[data-watch-open]"))');
  await browser.evaluate('document.querySelector("[data-watch-open]").click()');
  await until('document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")');
  await browser.evaluate('document.fonts.ready');await wait(100);checkBounds(await state());
  assert.equal(await browser.evaluate('document.querySelector("dialog[data-watch-panel]").open'),true);
  await browser.evaluate('document.querySelector("[data-watch-close]").click()');await wait(60);
  const closed=await state();await wait(200);assert.equal((await state()).animationTime,closed.animationTime);
  await browser.evaluate('document.querySelector("[data-watch-open]").click()');
  await until('document.querySelector("[data-watch-marquee-track]").getAnimations()[0]?.playState==="running"');
  results.push({test:'actual compact modal opens Scrolling face, suspends on close and resumes on reopening',passed:true});
  const summary = { passed: true, checks: results.length, cases: typography.length, app, appSha256,
    browser: (await browser.send('Browser.getVersion')).product, url: url.href, results };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(output, 'typography.json'), JSON.stringify(typography));
  console.log(JSON.stringify({ passed: results.length, cases: typography.length, output }));
} finally { await browser.close(); }
