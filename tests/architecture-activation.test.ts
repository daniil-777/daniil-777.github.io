import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateWhenVisible } from '../src/lib/architecture/activation.ts';

test('automatic activation waits for foreground visibility, runs once and respects preferences', () => {
  const doc = Object.assign(new EventTarget(), { hidden: true });
  const reduced = { matches: false }, connection = { saveData: false };
  let callback: (entries: unknown[]) => void = () => {};
  let activations = 0, observers = 0, disconnected = 0;
  const overrides = { document: doc, navigator: { connection }, matchMedia: () => reduced,
    IntersectionObserver: class {
      constructor(cb: typeof callback) { callback = cb; observers++; }
      observe() {} disconnect() { disconnected++; }
    } };
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const visible = () => callback([{ isIntersecting: true, intersectionRatio: 1 }]);
  try {
    const stop = activateWhenVisible({} as Element, () => activations++);
    visible(); assert.equal(activations, 0, 'background tabs do not activate');
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(activations, 1); assert.equal(disconnected, 1);
    visible(); doc.dispatchEvent(new Event('visibilitychange')); assert.equal(activations, 1, 'scrolling cannot restart a removed preview');
    stop();
    reduced.matches = true; activateWhenVisible({} as Element, () => activations++);
    assert.equal(observers, 1, 'reduced motion keeps manual Play');
    reduced.matches = false; connection.saveData = true; activateWhenVisible({} as Element, () => activations++);
    assert.equal(observers, 1, 'data saving keeps manual Play');
    connection.saveData = false;
    const cancel = activateWhenVisible({} as Element, () => activations++);
    cancel(); visible(); assert.equal(activations, 1, 'manual activation cancels automatic activation');
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
