import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { mountMarquee, planMarquee } from '../src/lib/watch/marquee.ts';

test('advertising ticker is continuous at constant speed and reserves a complete passage before rotation', () => {
  for (const [width, text, font] of [[100, 900, 15], [156, 1500, 21], [200, 2100, 26]]) {
    const plan = planMarquee(width, text, font);
    assert.equal(plan.overflow, text - width);
    assert.equal(plan.frames.length, 2, 'No intermediate dwell or fade keyframes');
    assert.equal(plan.frames[0].transform, 'translateX(0px)');
    assert.equal(plan.frames[1].transform, `translateX(${-text-plan.gap}px)`);
    assert.ok(Math.abs((text + plan.gap) / plan.duration * 1000 - font * 2.6) < .001);
    assert.equal(plan.readMs, text / (font * 2.6) * 1000);
    assert.ok(plan.readMs > 2000, 'Two-second rotation must wait for every word to pass');
    assert.ok(plan.duration > plan.readMs);
  }
});

test('marquee preserves reading progress, suspends and cancels motion, and changes preferences live', async () => {
  const browser = new Window();
  const media = Object.assign(new EventTarget(), { matches: false });
  const animations: { currentTime: number; cancelled: boolean; paused: boolean; cancel(): void; pause(): void; play(): void }[] = [];
  const changes = {
    document: browser.document, matchMedia: () => media,
    getComputedStyle: () => ({ fontSize: '18px' }),
  };
  const saved = new Map(Object.keys(changes).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(changes)) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(browser.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 200 });
  let measuredTextWidth = 800;
  Object.defineProperty(browser.HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ width: measuredTextWidth }) });
  Object.defineProperty(browser.HTMLElement.prototype, 'animate', { configurable: true, value: () => {
    const animation = { currentTime: 0, cancelled: false, paused: false,
      cancel() { this.cancelled = true; }, pause() { this.paused = true; }, play() { this.paused = false; } };
    animations.push(animation); return animation;
  } });
  const root = browser.document.createElement('article'); root.dataset.watch = '';
  const output = browser.document.createElement('p'); root.append(output);
  browser.document.body.append(root);
  let preferenceChanges = 0;
  const controller = mountMarquee(output as unknown as HTMLElement, () => { preferenceChanges++; controller.refresh(); });
  try {
    controller.setText('Every word remains in the complete message.', true);
    assert.equal(controller.readyForNext, false);
    assert.equal(output.textContent, 'Every word remains in the complete message.');
    const first = animations[0]; first.currentTime = 1000;
    controller.refresh(); assert.equal(animations.length, 1, 'Unchanged size does not restart reading');
    controller.pause(true); assert.equal(first.paused, true);
    controller.pause(false); assert.equal(first.paused, false);
    first.currentTime = Number(output.dataset.watchMarqueeReadMs);
    assert.equal(controller.readyForNext, true);
    controller.setText('A new complete message starts its own reading pass.', true);
    assert.equal(first.cancelled, true); assert.equal(controller.readyForNext, false);
    const beforeFontChange = animations.at(-1)!; beforeFontChange.currentTime = 400;
    measuredTextWidth = 1000; controller.refresh();
    assert.equal(beforeFontChange.cancelled, true, 'Changed glyph metrics recreate the measured travel');
    assert.ok(animations.at(-1)!.currentTime > 400, 'Resize preserves relative reading progress');
    controller.setText(output.textContent!, false);
    assert.equal(animations.at(-1)!.cancelled, true);
    controller.setText(output.textContent!, true);
    assert.equal(controller.readyForNext, false, 'Re-entering the face starts a new readable pass');
    controller.setMotion('system');
    media.matches = true; media.dispatchEvent(new Event('change'));
    assert.equal(preferenceChanges, 1); assert.equal(root.dataset.watchMarqueeStatic, 'true');
    assert.equal(animations.at(-1)!.cancelled, true); assert.equal(output.dataset.watchMarqueeState, 'static');
    const viewport=output.firstChild as unknown as HTMLElement;viewport.scrollLeft=200;
    controller.setMotion('sweep');assert.equal(viewport.scrollLeft,0,'Animated mode resets manual scroll'); assert.equal(output.dataset.watchMarqueeState, 'playing', 'Explicit sweeping opts into scrolling despite the device preference');
    controller.setMotion('system');viewport.scrollLeft=100;
    controller.setText('A changed answer begins at its first word.',true);assert.equal(viewport.scrollLeft,0,'New answers reset manual scroll');
    controller.setMotion('sweep');
    media.matches = false; media.dispatchEvent(new Event('change'));
    controller.dispose(); assert.equal(animations.at(-1)!.cancelled, true);
    media.dispatchEvent(new Event('change')); assert.equal(preferenceChanges, 2, 'Disposal removes preference listeners');
    controller.refresh(); assert.equal(animations.at(-1)!.cancelled, true);
  } finally {
    await browser.happyDOM.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
