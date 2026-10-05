/** Source-bound Chromium regression checks. Build and serve the site before running. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { startBrowser } from '../watch-language/browser-helper.mjs';

const build = resolve(process.env.WATCH_QA_BUILD ?? 'build');
const output = resolve(process.env.WATCH_QA_OUTPUT ?? '/tmp/chronos-layout-qa');
const url = new URL(process.env.WATCH_QA_URL ?? 'http://127.0.0.1:4347/smart-watch/');
const factBytes = await readFile(join(build, 'watch/facts.v1.json'));
const pack = JSON.parse(factBytes.toString('utf8'));
const facts = pack.facts;
const app = (await readdir(join(build, '_astro'))).find(name => /^app\..*\.js$/.test(name));
assert.ok(app, 'Build must include the public watch app');
const appBytes = await readFile(join(build, '_astro', app));
const planeWorkerPaths = [];
for (const name of (await readdir(join(build, '_astro'))).filter(name => /^worker[-.].*\.js$/.test(name))) {
  if ((await readFile(join(build, '_astro', name), 'utf8')).includes('planeRadialHalfWidth')) planeWorkerPaths.push(`/_astro/${name}`);
}
assert.ok(planeWorkerPaths.length > 0, 'The aircraft trainer code remains in the build');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
const results = [], typography = [];
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const readyExpression = 'document.querySelector("[data-watch-status]")?.textContent.includes("Reviewed thought")';
const until = async (browser, expression) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await browser.evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Browser not ready: ${expression}`);
};
const settle = browser => browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const choose = (browser, selector, value) => browser.evaluate(`(()=>{
  const control=document.querySelector(${JSON.stringify(selector)});
  control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
const clickMode = (browser, mode) => browser.evaluate(`document.querySelector('.chronos__modes [data-watch-mode="${mode}"]').click()`);
const setPaused = async (browser, paused) => {
  await browser.evaluate(`(()=>{const button=document.querySelector('[data-watch-pause]');
    if(button.getAttribute('aria-pressed')!==${JSON.stringify(String(paused))})button.click();})()`);
};
const styleUrl = (style, domain = 'all') => {
  const target = new URL(url); target.searchParams.set('watchStyle', style);
  target.searchParams.set('watchField', domain); return target.href;
};
const browser = await startBrowser(styleUrl('arc'), { width: 1440, height: 1100 });

async function navigate(style, domain = 'all') {
  await browser.send('Page.navigate', { url: styleUrl(style, domain) });
  await until(browser, readyExpression);
  await browser.evaluate('document.fonts.ready');
  await settle(browser);
  assert.equal(await browser.evaluate('document.querySelector("[data-watch]").dataset.watchThoughtStyle'), style);
  assert.equal(await browser.evaluate('document.querySelector("[data-watch-thought-layout]").value'), style);
  assert.equal(await browser.evaluate('document.querySelector("select[data-watch-domain]").value'), domain);
}

async function circularCase(style) {
  const measured = await browser.evaluate(`(()=>{
    const face=document.querySelector('[data-watch-dial]'),watch=face.parentElement;
    const b=face.getBoundingClientRect(),w=watch.getBoundingClientRect(),css=getComputedStyle(watch);
    const circles=[...face.children].filter(n=>n.localName==='circle').map(n=>({
      cx:Number(n.getAttribute('cx')),cy:Number(n.getAttribute('cy')),r:Number(n.getAttribute('r'))}));
    const caseNode=[...face.children].find(n=>n.localName==='circle'&&n.getAttribute('r')==='214');
    const c=caseNode?.getBoundingClientRect();
    return {viewBox:face.getAttribute('viewBox'),width:b.width,height:b.height,
      watchWidth:w.width,watchHeight:w.height,aspectRatio:css.aspectRatio,
      background:css.backgroundColor,border:parseFloat(css.borderTopWidth),circles,
      caseWidth:c?.width,caseHeight:c?.height,
      rectangularCase:[...face.children].some(n=>n.localName==='rect')};
  })()`);
  assert.equal(measured.viewBox, '0 0 440 440');
  assert.ok(Math.abs(measured.width - measured.height) < .1);
  assert.ok(Math.abs(measured.watchWidth - measured.watchHeight) < .1);
  assert.ok(Math.abs(measured.caseWidth - measured.caseHeight) < .1);
  assert.ok(measured.circles.some(circle => circle.cx === 220 && circle.cy === 220 && circle.r === 214));
  assert.equal(measured.rectangularCase, false);
  assert.equal(measured.background, 'rgba(0, 0, 0, 0)');
  assert.equal(measured.border, 0);
  results.push({ test: `${style} has a circular steel outer case`, passed: true, ...measured });
}

async function noPublicAircraft(style) {
  await setPaused(browser, false);
  const state = await browser.evaluate(String.raw`(()=>{
    const root=document.querySelector('[data-watch]'),settings=root.querySelector('.chronos__settings');
    const previous=settings.open;settings.open=true;
    const selector='[data-watch-plane],[data-watch-clouds],[data-watch-plane-toggle],[data-watch-clouds-toggle],[data-watch-learn],[data-watch-reset-learn],[data-watch-learning],[data-watch-metrics]';
    const visible=[...root.querySelectorAll(selector)].filter(n=>{
      const b=n.getBoundingClientRect(),s=getComputedStyle(n);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';
    }).map(n=>n.outerHTML.slice(0,120));settings.open=previous;
    return {enabled:root.dataset.watchAircraft,visible,resources:performance.getEntriesByType('resource').map(r=>r.name)
      .filter(n=>/\/watch\/plane\//.test(n)||${JSON.stringify(planeWorkerPaths)}.includes(new URL(n).pathname))};
  })()`);
  assert.equal(state.enabled, 'false');
  assert.deepEqual(state.visible, [], 'Aircraft, clouds, controls and diagnostics stay hidden with settings open');
  assert.deepEqual(state.resources, [], 'No aircraft policy or worker is downloaded');
  results.push({ test: `${style} omits aircraft and aircraft asset downloads`, passed: true, ...state });
  await setPaused(browser, true);
}

const arcMeasurement = `(()=>{
  const n=document.querySelector('[data-watch-phrase]'),guide=document.querySelector('[data-watch-phrase-arc-guide]');
  let min=Infinity,max=0,bottom=-Infinity;
  for(let i=0;i<n.getNumberOfChars();i++){
    const b=n.getExtentOfChar(i);
    for(const x of [b.x,b.x+b.width])for(const y of [b.y,b.y+b.height]){
      const r=Math.hypot(x-220,y-220);min=Math.min(min,r);max=Math.max(max,r);bottom=Math.max(bottom,y);
    }
  }
  return {sentence:n.textContent,caption:document.querySelector('[data-watch-caption]').textContent,
    font:Number(n.getAttribute('font-size')),minRadius:min,maxRadius:max,maxY:bottom,
    pathLength:guide.getTotalLength(),textLength:n.getComputedTextLength(),
    firstRotation:n.getRotationOfChar(0),lastRotation:n.getRotationOfChar(n.getNumberOfChars()-1),
    hasStretch:n.hasAttribute('textLength')||Boolean(n.querySelector('[textLength]'))};
})()`;
const cardMeasurement = `(()=>{
  const n=document.querySelector('[data-watch-card-output]'),face=document.querySelector('[data-watch-dial]').getBoundingClientRect();
  const b=n.getBoundingClientRect(),scale=face.width/440;
  return {sentence:n.textContent,caption:document.querySelector('[data-watch-caption]').textContent,
    font:parseFloat(getComputedStyle(n).fontSize),fontUnits:parseFloat(getComputedStyle(n).fontSize)/scale,
    height:b.height,relativeTop:(b.top-face.top)/scale,relativeBottom:(b.bottom-face.top)/scale,
    hourOverlaps:[...document.querySelector('[data-watch-layered-hours]').children].filter(hour=>{
      const h=hour.getBoundingClientRect();return h.width>0&&h.height>0&&Math.min(b.right,h.right)>Math.max(b.left,h.left)
        &&Math.min(b.bottom,h.bottom)>Math.max(b.top,h.top);}).map(hour=>hour.textContent),
    maxRadius:Math.max(...[b.left,b.right].flatMap(x=>[b.top,b.bottom].map(y=>
      Math.hypot((x-face.left)/scale-220,(y-face.top)/scale-220))))};
})()`;

async function checkTypography(style) {
  const rows = [];
  for (const width of [320, 380, 480]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 480 });
    await settle(browser);
    for (const mode of ['ai', 'profile', 'wellbeing']) {
      await clickMode(browser, mode);
      await settle(browser);
      for (const fact of facts.filter(f => f.mode === mode)) {
        const measured = await browser.evaluate(style === 'arc' ? arcMeasurement : cardMeasurement);
        const evidence = JSON.stringify({ style, width, fact: fact.id, ...measured });
        assert.equal(measured.sentence, fact.answer, evidence);
        assert.equal(measured.sentence, measured.caption, 'The accessible caption retains the entire sentence');
        assert.ok(measured.maxRadius < 198, evidence);
        if (style === 'arc') {
          assert.ok(measured.minRadius > 148 && measured.maxY < 220, evidence);
          assert.ok(measured.textLength < measured.pathLength - 16, evidence);
          assert.ok(measured.firstRotation < 0 && measured.lastRotation > 0, evidence);
          assert.equal(measured.hasStretch, false);
        } else {
          assert.ok(measured.relativeBottom < (style === 'layered' ? 350.1 : 374), evidence);
          if (style === 'layered') { assert.ok(measured.relativeTop > 220, evidence); assert.deepEqual(measured.hourOverlaps, [], evidence); }
          assert.ok(measured.fontUnits >= 14, evidence);
        }
        rows.push({ style, width, fact: fact.id, ...measured });
        await browser.evaluate('document.querySelector("[data-watch-next]").click()');
      }
    }
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'), false, `${style} overflows at ${width}px`);
  }
  assert.equal(rows.length, facts.length * 3);
  typography.push(...rows);
  await writeFile(join(output, `${style}-mobile.png`), await browser.screenshot());
  results.push({ test: `${style} fits all complete thoughts at 320, 380 and 480px`, passed: true,
    sentences: rows.length, minFont: Math.min(...rows.map(r => r.font)),
    ...(style === 'arc' ? { minRadius: Math.min(...rows.map(r => r.minRadius)), maxY: Math.max(...rows.map(r => r.maxY)) }
      : { minFontUnits: Math.min(...rows.map(r => r.fontUnits)) }),
    maxRadius: Math.max(...rows.map(r => r.maxRadius)) });
}

async function checkLayeredSize() {
  const measure = async () => {
    await settle(browser);const measured=await browser.evaluate(cardMeasurement);
    assert.equal(measured.sentence,measured.caption);assert.ok(measured.relativeTop>220);
    assert.ok(measured.relativeBottom<=350.1&&measured.maxRadius<198);
    assert.deepEqual(measured.hourOverlaps,[]);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    return measured;
  };
  const representatives = [facts.filter(f=>f.mode==='ai').sort((a,b)=>a.answer.length-b.answer.length)[0],
    facts.filter(f=>f.mode==='ai').sort((a,b)=>b.answer.length-a.answer.length)[0],
    facts.filter(f=>f.mode==='profile').sort((a,b)=>b.answer.length-a.answer.length)[0]];
  const selectFact = async fact => {
    await clickMode(browser,fact.mode);if(fact.mode==='ai')await choose(browser,'select[data-watch-domain]','all');
    for(let i=0;i<facts.length;i++) {
      if(await browser.evaluate(`document.querySelector('[data-watch-caption]').textContent===${JSON.stringify(fact.answer)}`))return;
      await browser.evaluate('document.querySelector("[data-watch-next]").click()');
    }
    throw new Error(`Could not select representative ${fact.id}`);
  };
  const samples=[];
  for(const fact of representatives) {
    await selectFact(fact);
    for(const requested of [16,24,28]) {
      await browser.evaluate(`(()=>{const range=document.querySelector('[data-watch-answer-size]');range.value=${JSON.stringify(String(requested))};range.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      const measured=await measure();assert.equal(measured.sentence,fact.answer);
      assert.ok(measured.fontUnits<=requested+.01&&measured.fontUnits>=14);
      samples.push({fact:fact.id,requested,...measured});
    }
  }
  await selectFact(representatives[0]);
  const pointer = async (kind,target) => {
    await browser.evaluate('document.querySelector("[data-watch-answer-size]").scrollIntoView({block:"center"})');
    await settle(browser);
    const range=await browser.evaluate(`(()=>{const n=document.querySelector('[data-watch-answer-size]'),b=n.getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height,value:Number(n.value),min:Number(n.min),max:Number(n.max),step:Number(n.step)};})()`);
    assert.equal(range.min,16);assert.equal(range.max,28);assert.equal(range.step,1);
    const x=value=>range.left+8+(range.width-16)*(value-range.min)/(range.max-range.min),y=range.top+range.height/2;
    if(kind==='mouse') {
      await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x:x(range.value),y,button:'left',buttons:1,clickCount:1});
      await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x(target),y,button:'left',buttons:1});
      await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x(target),y,button:'left',buttons:0,clickCount:1});
    } else {
      await browser.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      await browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x(range.value),y,radiusX:1,radiusY:1,id:1}]});
      for(let i=1;i<=6;i++)await browser.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x(range.value+(target-range.value)*i/6),y,radiusX:1,radiusY:1,id:1}]});
      await browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    assert.equal(await browser.evaluate('Number(document.querySelector("[data-watch-answer-size]").value)'),target,`${kind} drag changes native range`);
    const measured=await measure();assert.match(await browser.evaluate('document.querySelector("[data-watch-answer-size-label]").textContent'),/%/);
    return {kind,requested:target,...measured};
  };
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  const small=await pointer('mouse',16),large=await pointer('mouse',28);
  assert.ok(large.fontUnits>small.fontUnits,'Mouse resizing changes the rendered answer size');
  await browser.send('Emulation.setDeviceMetricsOverride',{width:380,height:1100,deviceScaleFactor:1,mobile:true});
  const finger=await pointer('touch',16);
  assert.ok(finger.fontUnits<large.fontUnits,'Finger resizing changes the rendered answer size');
  await browser.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  results.push({test:'layered answer resizes live with mouse and touch while complete text stays below center and clear of hour numbers',passed:true,samples,pointers:[small,large,finger]});
}

try {
  for (const style of ['arc', 'card', 'layered']) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await navigate(style);
    const visible = await browser.evaluate(`(()=>{const n=document.querySelector('[data-watch-thought-layout]');
      return n.getBoundingClientRect().height>0&&getComputedStyle(n).visibility==='visible';})()`);
    assert.equal(visible, true, 'Layout flag is visible on the website');
    await circularCase(style);
    if (style === 'card') {
      const arrangement = await browser.evaluate(`(()=>{
        const f=document.querySelector('[data-watch-dial]').getBoundingClientRect(),scale=f.width/440;
        const c=document.querySelector('.chronos__clock-mechanism').getBoundingClientRect();
        const t=document.querySelector('[data-watch-card-output]').getBoundingClientRect();
        return {clockX:(c.left+c.width/2-f.left)/scale,clockY:(c.top+c.height/2-f.top)/scale,
          clockWidth:c.width/scale,textBelowClock:t.top>=c.bottom,
          phraseDisplay:getComputedStyle(document.querySelector('[data-watch-phrase]')).display};
      })()`);
      assert.ok(arrangement.clockX > 220 && arrangement.clockY < 220);
      assert.ok(arrangement.clockWidth > 150 && arrangement.clockWidth < 180);
      assert.equal(arrangement.textBelowClock, true);
      assert.equal(arrangement.phraseDisplay, 'none');
      results.push({ test: 'companion face places the small analogue clock above its complete answer', passed: true, ...arrangement });
    }
    if (style === 'layered') {
      assert.equal(await browser.evaluate('Number(document.querySelector("[data-watch-answer-size]").value)'), 24, 'Layered answer starts at its smaller default size');
      const arrangement = await browser.evaluate(`(()=>{
        const face=document.querySelector('[data-watch-dial]'),clock=document.querySelector('.chronos__clock-mechanism');
        const output=document.querySelector('[data-watch-card-output]'),hours=[...document.querySelector('[data-watch-layered-hours]').children];
        return {clockTransform:getComputedStyle(clock).transform,faceZ:Number(getComputedStyle(face).zIndex),
          outputZ:Number(getComputedStyle(output).zIndex),color:getComputedStyle(output).color,
          phraseDisplay:getComputedStyle(document.querySelector('[data-watch-phrase]')).display,
          indices:document.querySelector('[data-watch-layered-indices]').children.length,
          hours:hours.map(n=>({label:n.textContent,transform:getComputedStyle(n).transform,
            radius:Math.hypot(Number(n.getAttribute('x'))-220,Number(n.getAttribute('y'))-220)})),
          hands:[...clock.querySelectorAll('[data-watch-hand]')].map(n=>({hand:n.dataset.watchHand,
            opacity:Number(getComputedStyle(n).opacity),transform:n.getAttribute('transform')}))};
      })()`);
      assert.equal(arrangement.clockTransform, 'none', 'Layered clock keeps its full centered geometry');
      assert.ok(arrangement.outputZ > arrangement.faceZ, 'Answer sits above transparent clock hands');
      assert.equal(arrangement.color, 'rgb(255, 255, 255)');
      assert.equal(arrangement.phraseDisplay, 'none');
      assert.equal(arrangement.indices, 60);
      assert.deepEqual(arrangement.hours.map(hour=>Number(hour.label)).sort((a,b)=>a-b), Array.from({length:12},(_,i)=>i+1));
      for (const hour of arrangement.hours) { assert.equal(hour.transform, 'none'); assert.ok(Math.abs(hour.radius-166)<.1); }
      assert.equal(arrangement.hands.length, 3);
      for (const hand of arrangement.hands) { assert.ok(hand.opacity > 0 && hand.opacity <= .30); assert.match(hand.transform, /220 220\)/); }
      results.push({ test: 'layered face places its white answer above full centered transparent hands and twelve upright hours', passed: true, ...arrangement });
    }
    await noPublicAircraft(style);
    await writeFile(join(output, `${style}-desktop.png`), await browser.screenshot());
    await checkTypography(style);
    results.push({ test: `${style} URL flag and visible selector initialize the layout`, passed: true });
    if(style==='layered')await checkLayeredSize();
  }

  for (const style of ['dial', 'arc', 'card', 'layered']) {
    await choose(browser, '[data-watch-thought-layout]', style);
    assert.equal(await browser.evaluate('document.querySelector("[data-watch]").dataset.watchThoughtStyle'), style);
    const resizeVisible=await browser.evaluate(`(()=>{const n=document.querySelector('[data-watch-answer-size-control]'),b=n.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(n).display!=='none';})()`);
    assert.equal(resizeVisible,style==='layered','Answer-size control is visible only for layered face');
    if (style === 'dial') await noPublicAircraft(style);
  }
  results.push({ test: 'visible selector switches all four layouts', passed: true });
  await clickMode(browser, 'ai');
  for (const domain of ['math', 'ai']) {
    await choose(browser, 'select[data-watch-domain]', domain);
    const expected = facts.filter(f => f.mode === 'ai' && (f.domain ?? 'ai') === domain);
    assert.ok(expected.length > 0);
    for (const fact of expected) {
      assert.equal(await browser.evaluate('document.querySelector("[data-watch-caption]").textContent'), fact.answer);
      await browser.evaluate('document.querySelector("[data-watch-next]").click()');
    }
    if (domain === 'ai') assert.ok(expected.some(f => f.domain === undefined), 'AI includes the original core AI facts');
    results.push({ test: `${domain} knowledge field includes every matching reviewed fact`, passed: true, facts: expected.length });
  }
  await navigate('card', 'math');
  const selectedMath = await browser.evaluate('document.querySelector("[data-watch-caption]").textContent');
  assert.ok(facts.some(f => f.domain === 'math' && f.answer === selectedMath));
  results.push({ test: 'knowledge field URL flag initializes mathematics', passed: true });

  const api = await browser.evaluate(`(async()=>{
    const {mountSmartWatch}=await import(${JSON.stringify(`/_astro/${app}`)});
    const root=document.querySelector('[data-watch]').cloneNode(true);root.dataset.compact='true';
    document.body.append(root);const handle=mountSmartWatch(root,{thoughtStyle:'arc',knowledgeDomain:'ai'});
    const initial={style:root.dataset.watchThoughtStyle,domain:root.dataset.watchDomain};
    handle.setSettings({thoughtStyle:'card',knowledgeDomain:'math'});
    const changed={style:root.dataset.watchThoughtStyle,domain:root.dataset.watchDomain};
    handle.setSettings({thoughtStyle:'layered'});const layered=root.dataset.watchThoughtStyle;
    let badStyle=false,badDomain=false;
    try{handle.setSettings({thoughtStyle:'bad'});}catch{badStyle=true;}
    try{handle.setSettings({knowledgeDomain:'bad'});}catch{badDomain=true;}
    handle.unmount();root.remove();return {initial,changed,layered,badStyle,badDomain};
  })()`);
  assert.deepEqual(api, { initial: { style: 'arc', domain: 'ai' }, changed: { style: 'card', domain: 'math' }, layered: 'layered', badStyle: true, badDomain: true });
  results.push({ test: 'public mount and settings API support validated layout and knowledge flags', passed: true, ...api });
  const resources = await browser.evaluate('performance.getEntriesByType("resource").map(r=>r.name)');
  assert.ok(!resources.some(resource => /\.(?:onnx|wasm)(?:$|\?)|ort[.-]wasm/.test(resource)));
  results.push({ test: 'experimental neural assets stay gated in the new layouts', passed: true });
  const summary = { passed: true, checks: results.length, sentencesChecked: typography.length,
    browser: (await browser.send('Browser.getVersion')).product,
    viewportNote: 'Desktop Chromium viewport emulation; physical mobile hardware untested.',
    url: url.href, build, factVersion: pack.version, facts: facts.length,
    factPackSha256: sha(factBytes), app, appSha256: sha(appBytes), results };
  await writeFile(join(output, 'typography.json'), JSON.stringify(typography, null, 2));
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ passed: summary.checks, sentencesChecked: typography.length, facts: facts.length, output }));
} finally { await browser.close(); }
