import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { mountDial } from '../src/lib/watch/dial.ts';

test('dial re-reads device time after suspension and disposes its only frame loop', async () => {
  const browser = new Window();
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const media = Object.assign(new EventTarget(), { matches: false });
  let now = new Date('2026-10-05T06:30:00.500Z');
  const changes = {
    window: browser, document: browser.document, HTMLTimeElement: browser.HTMLTimeElement,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = nextFrame++; callbacks.set(id, callback); return id;
    },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
  };
  const saved = new Map(Object.keys(changes).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(changes)) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(browser, 'matchMedia', { value: () => media });
  const resumeCalls: number[] = [];
  const elapsed: number[] = [];
  const root = browser.document.createElement('div');
  root.innerHTML = '<svg><g data-watch-hand="hour"></g><g data-watch-hand="minute"></g><g data-watch-hand="second"></g></svg><time data-watch-time aria-live="off"></time>';
  browser.document.body.append(root);
  const flush = () => {
    const [id, callback] = callbacks.entries().next().value!;
    callbacks.delete(id); callback(0);
  };
  try {
    const dial = mountDial(root as unknown as HTMLElement, {
      now: () => now, timeZone: 'UTC', onResume: () => resumeCalls.push(1),
      onFrame: (_, delta) => elapsed.push(delta),
    });
    assert.equal(callbacks.size, 1);
    assert.equal(root.querySelector('[data-watch-hand="second"]')!.getAttribute('transform'), 'rotate(3 220 220)');
    assert.equal(root.querySelector('time')!.textContent, '06:30 · UTC');
    dial.setMotion('tick'); flush();
    assert.equal(root.dataset.watchTicking, 'true');
    assert.equal(root.querySelector('[data-watch-hand="second"]')!.getAttribute('transform'), 'rotate(0 220 220)');
    dial.suspend();
    assert.equal(callbacks.size, 0);
    now = new Date('2026-10-05T07:25:30.100Z');
    dial.resume();
    assert.equal(root.querySelector('time')!.textContent, '07:25 · UTC');
    assert.equal(elapsed.at(-1), 0, 'hidden time is not fast-forwarded through simulation');
    assert.equal(resumeCalls.length, 2);
    dial.setTimeZone('Europe/Zurich'); flush();
    assert.equal(root.querySelector('time')!.textContent, '09:25 · Europe/Zurich');
    assert.throws(() => dial.setTimeZone('invalid/timezone'), RangeError);
    dial.dispose();
    assert.equal(callbacks.size, 0);
    dial.resume();
    assert.equal(callbacks.size, 0, 'disposed clocks cannot accidentally remount');
  } finally {
    await browser.happyDOM.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
