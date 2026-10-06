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
  const css=getComputedStyle(p),ctx=document.createElement('canvas').getContext('2d');ctx.font=css.fontStyle+' '+css.fontWeight+' '+css.fontSize+' '+css.fontFamily;
  const glyphs=ctx.measureText(p.textContent);
  return {style:root.dataset.watchThoughtStyle,text:p.textContent,caption:root.querySelector('[data-watch-caption]').textContent,
    scale,top:(b.top-face.top)/scale,bottom:(b.bottom-face.top)/scale,width:b.width/scale,height:b.height/scale,
    font:parseFloat(getComputedStyle(p).fontSize),static:root.dataset.watchMarqueeStatic,
    animationTime:a?.currentTime,animationState:a?.playState,readMs:Number(p.dataset.watchMarqueeReadMs),
    x:track?new DOMMatrix(getComputedStyle(track).transform).m41:null,opacity:track?Number(getComputedStyle(track).opacity):null,
    glyphHeight:glyphs.actualBoundingBoxAscent+glyphs.actualBoundingBoxDescent,lineHeight:parseFloat(getComputedStyle(p).lineHeight),whiteSpace:track?getComputedStyle(track).whiteSpace:null,
    trackWidth:t?.width,windowWidth:w?.width,windowHeight:w?.height,scrollWidth:track?.parentElement.scrollWidth,
    copyWidth:track?parseFloat(getComputedStyle(track,'::after').width):0,
    hours:[...root.querySelector('[data-watch-layered-hours]').children].filter(h=>{const x=h.getBoundingClientRect();
      return Math.min(b.right,x.right)>Math.max(b.left,x.left)&&Math.min(b.bottom,x.bottom)>Math.max(b.top,x.top);}).map(h=>h.textContent),
    maxRadius:Math.max(...[b.left,b.right].flatMap(x=>[b.top,b.bottom].map(y=>Math.hypot((x-face.left)/scale-220,(y-face.top)/scale-220))))};
})()`);
const checkBounds = s => {
  assert.equal(s.style, 'marquee'); assert.equal(s.text, s.caption);
  assert.ok(s.top > 220 && s.bottom <= 350.1, JSON.stringify(s));
  assert.ok(s.maxRadius < 194); assert.deepEqual(s.hours, []);assert.ok(s.glyphHeight<=s.windowHeight+.5,'Serif letter tops and tails are not clipped');
};
try {
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await until('document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")');
  await browser.evaluate('document.fonts.ready');
  assert.equal(await browser.evaluate('document.querySelector("[data-watch-thought-layout]").value'), 'marquee');
  await paused(true);
  const design = await state(); checkBounds(design);
  assert.ok(Math.abs(design.width-202.4)<1&&Math.abs(design.height-Math.max(39.6,28/design.scale))<1,'Bar stays46%wide and9%high');
  assert.equal(design.whiteSpace,'nowrap');assert.ok(design.windowHeight<design.lineHeight*1.1,'Exactly one line');
  assert.ok(design.windowWidth/design.font<9,'Only a few words fit in the narrow window');
  assert.ok(design.font >= 17); assert.ok(design.readMs > 2000);
  results.push({ test: 'URL and fifth visible flag select unboxed lettering below centre', passed: true, ...design });
  const classic=await browser.evaluate(`(()=>{
    const r=document.querySelector('[data-watch]'),p=r.querySelector('[data-watch-card-output]'),c=getComputedStyle(p);
    const hands=['hour','minute'].map(name=>{const n=r.querySelector('[data-watch-dial] [data-watch-hand="'+name+'"]'),m=new DOMMatrix(getComputedStyle(n.firstElementChild).transform);
      return {name,opacity:Number(getComputedStyle(n).opacity),scale:m.a,tipRadius:(name==='hour'?72:86)*m.a,width:(name==='hour'?12:8)*m.a,centerX:m.a*220+m.e,centerY:m.d*220+m.f};});
    return {background:c.backgroundColor,border:parseFloat(c.borderTopWidth),radius:c.borderRadius,shadow:c.boxShadow,family:c.fontFamily,color:c.color,weight:c.fontWeight,hands,
      textAboveHands:parseInt(c.zIndex)>parseInt(getComputedStyle(r.querySelector('[data-watch-dial]')).zIndex)};
  })()`);
  assert.equal(classic.background,'rgba(0, 0, 0, 0)');assert.equal(classic.border,0);assert.equal(classic.radius,'0px');assert.equal(classic.shadow,'none');
  assert.match(classic.family,/Baskerville.*Georgia.*serif/);assert.equal(classic.color,'rgb(255, 255, 255)');assert.equal(classic.weight,'400');assert.equal(classic.textAboveHands,true);
  for(const h of classic.hands){assert.equal(h.opacity,.9);assert.ok(h.tipRadius>110&&h.tipRadius<166);assert.ok(h.width>14);assert.ok(Math.abs(h.centerX-220)<.01&&Math.abs(h.centerY-220)<.01);}
  results.push({test:'reference styling has unboxed white serif lettering and long polished hands beneath the text',passed:true,...classic});
  const loop=await browser.evaluate(`(()=>{
    const t=document.querySelector('[data-watch-marquee-track]'),a=t.getAnimations()[0],timing=a.effect.getTiming();
    const w=t.parentElement.getBoundingClientRect(),r=document.createRange();r.setStart(t.firstChild,0);r.setEnd(t.firstChild,1);
    a.currentTime=0;const firstInset=r.getBoundingClientRect().left-w.left;
    const frames=a.effect.getKeyframes(),distance=-new DOMMatrix(frames.at(-1).transform).m41;
    const copy=getComputedStyle(t,'::after'),copyStart=parseFloat(copy.left);
    return {firstInset,keyframes:frames.length,distance,copyStart,copyWidth:parseFloat(copy.width)+(copy.boxSizing==='border-box'?0:parseFloat(copy.paddingLeft)+parseFloat(copy.paddingRight)),
      width:t.getBoundingClientRect().width,duration:timing.duration};
  })()`);
  assert.ok(loop.firstInset>=7);assert.equal(loop.keyframes,2,'Continuous linear motion has no dwell keyframes');
  assert.ok(Math.abs(loop.distance-loop.copyStart)<1,'Duplicate copy meets the first exactly at the loop seam');
  assert.ok(Math.abs(loop.copyWidth-loop.width)<1,'Both visual copies use the same glyph spacing');
  results.push({test:'continuous advertising loop keeps the first word clear and joins matching visual copies without a jump',passed:true,...loop});
  await writeFile(join(output, 'marquee-desktop.png'), await browser.screenshot());

  for (const reduced of [false, true]) {
    await choose('[data-watch-motion]','system');
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
          assert.equal(s.whiteSpace,'nowrap');assert.ok(Math.abs(s.width-202.4)<1&&Math.abs(s.height-Math.max(39.6,28/s.scale))<1);
          assert.ok(s.font>=17);
          if (reduced)assert.equal(s.animationTime,undefined);
          else assert.ok(s.animationTime>=0);
          typography.push({ width, reduced, fact: fact.id, ...s });
          await browser.evaluate('document.querySelector("[data-watch-next]").click()');
        }
      }
      if (width === 380) { await wait(260); await writeFile(join(output, reduced ? 'marquee-static-mobile.png' : 'marquee-mobile.png'), await browser.screenshot()); }
    }
  }
  results.push({ test: 'all364complete sentences retain the same narrow single-line viewport under motion and reduced-motion settings at three widths', passed: true, cases: typography.length });
  const manualScroll=await browser.evaluate(`(()=>{const w=document.querySelector('.chronos__marquee-window');w.scrollLeft=w.scrollWidth;return {overflow:getComputedStyle(w).overflowX,position:w.scrollLeft,whiteSpace:getComputedStyle(w.firstChild).whiteSpace};})()`);
  assert.equal(manualScroll.overflow,'auto');assert.ok(manualScroll.position>0);assert.equal(manualScroll.whiteSpace,'nowrap');
  results.push({test:'Respect device keeps the narrow bar manually horizontally scrollable under reduced motion',passed:true,...manualScroll});
  const scrolledSentence=(await state()).text;await browser.evaluate('document.querySelector("[data-watch-next]").click()');
  assert.notEqual((await state()).text,scrolledSentence);assert.equal(await browser.evaluate('document.querySelector(".chronos__marquee-window").scrollLeft'),0,'New sentences restart at their first word');
  await browser.evaluate('document.querySelector(".chronos__marquee-window").scrollLeft=100');
  await choose('[data-watch-motion]','sweep');assert.equal(await browser.evaluate('document.querySelector(".chronos__marquee-window").scrollLeft'),0,'Animated mode starts with the first word');assert.equal((await state()).static,'false');assert.equal((await state()).animationState,'paused');
  results.push({test:'explicit Sweeping opts into ticker motion while device reduction is enabled',passed:true});
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await browser.evaluate(`document.querySelector('.chronos__modes [data-watch-mode="ai"]').click()`);
  await paused(false);
  await browser.evaluate('document.querySelector("[data-watch-marquee-track]").getAnimations()[0].currentTime=2200');
  const start = await state(); await wait(400); const moved = await state();
  assert.ok(moved.x < start.x - 5, 'Message moves right-to-left');
  const speed = (start.x - moved.x) / ((moved.animationTime - start.animationTime) / 1000);
  assert.ok(Math.abs(speed - moved.font * 2.6) < 1);
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
  results.push({ test: 'automatic two-second rotation waits for every word to traverse the advertising ticker', passed: true });
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
