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
const apps = await Promise.all((await readdir(join(build, '_astro'))).filter(name => /^app\..*\.js$/.test(name))
  .map(async name => ({ name, source: await readFile(join(build, '_astro', name), 'utf8') })));
const watchApp = apps.find(entry => entry.source.includes('data-watch-cycle-mode'));
assert.ok(watchApp, 'Built watch runtime is available');
const app = watchApp.name;
const appSha256 = createHash('sha256').update(watchApp.source).digest('hex');
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
  const caseControls = await browser.evaluate(`(()=>{
    const root=document.querySelector('[data-watch]'),mode=root.querySelector('[data-watch-cycle-mode]'),layout=root.querySelector('[data-watch-cycle-layout]');
    const modes=[];for(let i=0;i<3;i++){mode.click();modes.push(root.querySelector('[data-watch-mode-label][data-active="true"]').dataset.watchModeLabel);}
    const styles=[],outside=[];for(let i=0;i<5;i++){layout.click();styles.push(root.dataset.watchThoughtStyle);
      const face=root.querySelector('.chronos__watch').getBoundingClientRect();
      outside.push([...root.querySelectorAll('[data-watch-mode-label]')].every(label=>label.getBoundingClientRect().right<=face.left-3));}
    root.querySelector('.chronos__transport [data-watch-pause]').click();
    const resumed=[...root.querySelectorAll('[data-watch-pause]')].every(button=>button.getAttribute('aria-pressed')==='false');
    root.querySelector('[data-watch-case-pause]').click();
    const paused=[...root.querySelectorAll('[data-watch-pause]')].every(button=>button.getAttribute('aria-pressed')==='true');
    const before=root.querySelector('[data-watch-caption]').textContent;root.querySelector('.chronos__case-button--top-right').click();
    return {modes,styles,outside,resumed,paused,next:root.querySelector('[data-watch-caption]').textContent!==before,
      pauseName:root.querySelector('[data-watch-case-pause]').getAttribute('aria-label')};
  })()`);
  assert.deepEqual(caseControls.modes,['profile','wellbeing','ai']);
  assert.deepEqual(caseControls.styles,['dial','arc','card','layered','marquee']);
  assert.ok(caseControls.outside.every(Boolean),'Mode labels remain outside every watch face');
  assert.equal(caseControls.resumed,true);assert.equal(caseControls.paused,true);assert.equal(caseControls.next,true);assert.equal(caseControls.pauseName,'Resume thoughts');
  results.push({test:'four case buttons cycle modes and faces, advance thoughts, and synchronize pause state',passed:true,...caseControls});
  await browser.evaluate(`Promise.all([...document.querySelectorAll('.chronos__case-cap')].flatMap(cap=>cap.getAnimations().map(animation=>animation.finished.catch(()=>{}))))`);
  for(const mode of ['profile','wellbeing','ai']){
    const point=await browser.evaluate(`(()=>{const r=document.querySelector('[data-watch-mode-label="${mode}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await until(`document.querySelector('[data-watch]').dataset.watchModeValue==='${mode}'`);
    const selection=await browser.evaluate(`(()=>{const r=document.querySelector('[data-watch]'),cap=r.querySelector('.chronos__case-button--top-left .chronos__case-cap');
      const animation=cap.getAnimations().find(a=>!(a instanceof CSSTransition));return {mode:r.dataset.watchModeValue,selected:[...r.querySelectorAll('[data-watch-mode-label][aria-pressed="true"]')].map(b=>b.dataset.watchMode),
        duration:animation?.effect.getTiming().duration,frames:animation?.effect.getKeyframes().length,
        animations:cap.getAnimations().filter(a=>!(a instanceof CSSTransition)).length,
        otherCapsAnimated:[...r.querySelectorAll('.chronos__case-button:not(.chronos__case-button--top-left) .chronos__case-cap')].flatMap(n=>n.getAnimations().filter(a=>!(a instanceof CSSTransition)).map(a=>({button:n.parentElement.className,state:a.playState,time:a.currentTime,duration:a.effect.getTiming().duration}))),
        mirrored:[...r.querySelectorAll('[data-watch-mode]')].every(b=>b.getAttribute('aria-pressed')===String(b.dataset.watchMode===r.dataset.watchModeValue))};})()`);
    assert.equal(selection.mode,mode);assert.deepEqual(selection.selected,[mode]);assert.equal(selection.mirrored,true);
    assert.ok(selection.duration>=480&&selection.duration<=650);assert.equal(selection.frames,4,'Selecting text performs the complete inward press and release');
    assert.equal(selection.animations,1,'Repeated selection replaces the preceding press');assert.deepEqual(selection.otherCapsAnimated,[]);
  }
  await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  results.push({test:'mouse selection of every exterior mode synchronizes both mode groups and animates a slower complete upper-left press',passed:true});
  await browser.evaluate('document.querySelector("[data-watch-mode-label=profile]").focus()');
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until('document.querySelector("[data-watch]").dataset.watchModeValue==="profile"');
  assert.equal(await browser.evaluate('document.querySelector("[data-watch]").dataset.watchModeValue'),'profile');
  await browser.evaluate('document.activeElement.blur()');
  results.push({test:'exterior mode controls accept keyboard selection',passed:true});
  const pressMotion=await browser.evaluate(`(()=>{
    const root=document.querySelector('[data-watch]');return [...root.querySelectorAll('.chronos__case-button')].map(button=>{
      button.click();const cap=button.querySelector('.chronos__case-cap'),animation=cap.getAnimations().find(a=>a instanceof Animation&&!(a instanceof CSSTransition));
      const duration=animation.effect.getTiming().duration;
      animation.pause();animation.effect.updateTiming({easing:'linear'});animation.currentTime=duration*.25;
      const pressed=new DOMMatrix(getComputedStyle(cap).transform);animation.currentTime=duration;
      const rest=new DOMMatrix(getComputedStyle(cap).transform);animation.cancel();
      return {position:button.className,x:pressed.e,y:pressed.f,restX:rest.e,restY:rest.f};
    });
  })()`);
  for(const button of pressMotion){
    assert.ok(button.position.includes('left')?button.x>2:button.x<-2);
    assert.ok(button.position.includes('top')?button.y>1:button.y<-1);
    assert.ok(Math.abs(button.restX)<.01&&Math.abs(button.restY)<.01);
  }
  // The mode and layout buttons above each advanced once; restore the scrolling AI face.
  await choose('[data-watch-thought-layout]','marquee');
  await browser.evaluate(`document.querySelector('.chronos__modes [data-watch-mode="ai"]').click()`);
  await paused(true);
  results.push({test:'each steel button depresses toward the case and returns to its seated position',passed:true,buttons:pressMotion});
  const design = await state(); checkBounds(design);
  assert.ok(Math.abs(design.width-202.4)<1&&Math.abs(design.height-Math.max(39.6,28/design.scale))<1,'Bar stays46%wide and9%high');
  assert.equal(design.whiteSpace,'nowrap');assert.ok(design.windowHeight<design.lineHeight*1.1,'Exactly one line');
  assert.ok(design.windowWidth/design.font<9,'Only a few words fit in the narrow window');
  assert.ok(design.font >= 17); assert.ok(design.readMs > 2000);
  results.push({ test: 'URL and fifth visible flag select unboxed lettering below centre', passed: true, ...design });
  const classic=await browser.evaluate(`(()=>{
    const r=document.querySelector('[data-watch]'),p=r.querySelector('[data-watch-card-output]'),c=getComputedStyle(p);
    const hands=['hour','minute'].map(name=>{const n=r.querySelector('.chronos__scrolling-hands [data-watch-hand="'+name+'"]'),box=n.getBBox();
      return {name,opacity:Number(getComputedStyle(n).opacity),tipRadius:220-box.y,width:box.width};});
    return {background:c.backgroundColor,border:parseFloat(c.borderTopWidth),radius:c.borderRadius,shadow:c.boxShadow,family:c.fontFamily,color:c.color,weight:c.fontWeight,hands,
      classicDisplay:getComputedStyle(r.querySelector('.chronos__hands')).display,scrollingDisplay:getComputedStyle(r.querySelector('.chronos__scrolling-hands')).display,
      textAboveHands:parseInt(c.zIndex)>parseInt(getComputedStyle(r.querySelector('[data-watch-dial]')).zIndex)};
  })()`);
  assert.equal(classic.background,'rgba(0, 0, 0, 0)');assert.equal(classic.border,0);assert.equal(classic.radius,'0px');assert.equal(classic.shadow,'none');
  assert.match(classic.family,/Baskerville.*Georgia.*serif/);assert.equal(classic.color,'rgb(255, 255, 255)');assert.equal(classic.weight,'400');assert.equal(classic.textAboveHands,true);
  for(const h of classic.hands){assert.equal(h.opacity,.95);assert.ok(h.tipRadius>110&&h.tipRadius<166);assert.ok(h.width>=5&&h.width<=9);}
  assert.ok(classic.hands[1].tipRadius>classic.hands[0].tipRadius);
  assert.ok(classic.hands[1].width<classic.hands[0].width);
  assert.equal(classic.classicDisplay,'none');assert.equal(classic.scrollingDisplay,'block');
  results.push({test:'unboxed white serif lettering sits above slender tapered steel hands',passed:true,...classic});
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
      const caseLayout=await browser.evaluate(`(()=>{
        const root=document.querySelector('[data-watch]');return {overflow:document.documentElement.scrollWidth>innerWidth,
          buttons:[...root.querySelectorAll('.chronos__case-button')].map(button=>{const box=button.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
            return {width:box.width,height:box.height,hit:hit?.closest('.chronos__case-button')===button};}),
          faceLeft:root.querySelector('.chronos__watch').getBoundingClientRect().left,
          labels:[...root.querySelectorAll('[data-watch-mode-label]')].map(label=>{const box=label.getBoundingClientRect();return {text:label.textContent,top:box.top,left:box.left,right:box.right,width:box.width,height:box.height,
            hit:[[box.left+2,box.top+box.height/2],[box.right-2,box.top+box.height/2],[box.left+box.width/2,box.top+box.height/2]].every(([x,y])=>document.elementFromPoint(x,y)?.closest('[data-watch-mode-label]')===label)};})};
      })()`);
      assert.equal(caseLayout.overflow,false);assert.ok(caseLayout.buttons.every(button=>button.width>=44&&button.height>=44&&button.hit));
      assert.deepEqual(caseLayout.labels.map(label=>label.text),['AI','About me','Wellbeing']);
      assert.ok(caseLayout.labels.every(label=>label.left>=0&&label.right<=caseLayout.faceLeft-3));
      assert.ok(caseLayout.labels.every(label=>label.height>=40&&label.width>=44&&label.hit),'Mouse and finger targets cover the full mode row');
      assert.ok(caseLayout.labels[0].top<caseLayout.labels[1].top&&caseLayout.labels[1].top<caseLayout.labels[2].top);
      if(reduced){
        const animated=await browser.evaluate(`(()=>{const b=document.querySelector('[data-watch-case-pause]');b.click();b.click();return b.querySelector('.chronos__case-cap').getAnimations().length;})()`);
        assert.equal(animated,0,'Reduced motion disables button spring animation');
        const selectedAnimated=await browser.evaluate(`(()=>{document.querySelector('[data-watch-mode-label="ai"]').click();return document.querySelector('.chronos__case-button--top-left .chronos__case-cap').getAnimations().length;})()`);
        assert.equal(selectedAnimated,0,'Reduced motion disables mode-selection animation');
      }else{
        await browser.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
        const point=await browser.evaluate(`(()=>{const r=document.querySelector('[data-watch-mode-label="wellbeing"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
        await browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await until('document.querySelector("[data-watch]").dataset.watchModeValue==="wellbeing"');
        await browser.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      }
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
