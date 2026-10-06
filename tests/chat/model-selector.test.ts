import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Window } from 'happy-dom';
import { createModelSelector } from '../../src/scripts/chat/model-selector.ts';
import type { Mode } from '../../src/scripts/chat/view.ts';
let window: Window, picker: ReturnType<typeof createModelSelector>, selected: Mode[];
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  window = new Window(); selected = [];
  for (const [key, value] of Object.entries({ window, document: window.document, Node: window.Node })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  picker = createModelSelector(mode => selected.push(mode)); window.document.body.append(picker.element as unknown as import('happy-dom').Node);
  picker.update([{ mode: 'cloud' }, { mode: 'device' }, { mode: 'quotes' }], 'cloud');
});
afterEach(async () => {
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
const trigger = () => window.document.querySelector('[data-model-select]')!;
const menu = () => window.document.querySelector('[role=menu]')!;
const key = (value: string) => window.document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
test('the menu supports arrows, Home/End, Escape and checked radio choices', () => {
  (trigger() as unknown as HTMLButtonElement).click();
  assert.equal(window.document.activeElement!.getAttribute('data-model-option'), 'cloud');
  key('ArrowDown'); assert.equal(window.document.activeElement!.getAttribute('data-model-option'), 'device');
  key('End'); assert.equal(window.document.activeElement!.getAttribute('data-model-option'), 'quotes');
  key('Home'); assert.equal(window.document.activeElement!.getAttribute('data-model-option'), 'cloud');
  key('Escape'); assert.equal((menu() as unknown as HTMLElement).hidden, true); assert.equal(window.document.activeElement, trigger());
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
});
test('a delayed capability update preserves focus and skips unavailable models', () => {
  (trigger() as unknown as HTMLButtonElement).click();
  picker.update([{ mode: 'cloud' }, { mode: 'device', disabled: 'Unavailable' }, { mode: 'quotes' }], 'cloud');
  assert.equal(window.document.activeElement!.getAttribute('data-model-option'), 'cloud');
  key('ArrowDown'); assert.equal(window.document.activeElement!.getAttribute('data-model-option'), 'quotes');
  (window.document.activeElement as unknown as HTMLButtonElement).click(); assert.deepEqual(selected, ['quotes']);
});
test('arrow opening focuses the selected model and Tab returns focus to its trigger', () => {
  (trigger() as unknown as HTMLButtonElement).focus(); key('ArrowDown');
  assert.equal(window.document.activeElement!.getAttribute('data-model-option'), 'cloud');
  key('Tab'); assert.equal(window.document.activeElement, trigger()); assert.equal((menu() as unknown as HTMLElement).hidden, true);
});
test('generation closes and disables the picker; outside clicks close it', () => {
  (trigger() as unknown as HTMLButtonElement).click(); picker.busy(true);
  assert.equal((trigger() as unknown as HTMLButtonElement).disabled, true); assert.equal((menu() as unknown as HTMLElement).hidden, true);
  picker.busy(false); (trigger() as unknown as HTMLButtonElement).click();
  window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal((menu() as unknown as HTMLElement).hidden, true);
});
