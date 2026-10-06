import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Window } from 'happy-dom';
import { createView } from '../../src/scripts/chat/view.ts';

let window: Window, view: ReturnType<typeof createView>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const copy = (name: string) => ({ consent: `Download ${name}?`, accept: `Accept ${name}`, decline: 'Decline' });
beforeEach(() => {
  window = new Window();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Node']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key as keyof Window] });
  }
  window.document.body.innerHTML = '<dialog open><button data-chat-new></button><div data-chat-status></div><div data-chat-body></div></dialog>';
  const dialog = window.document.querySelector('dialog')! as unknown as HTMLDialogElement;
  view = createView(dialog, '2026-10-06', { ask: () => true, stop() {}, mode() {}, reset() {}, semantic() {} });
});
afterEach(async () => {
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});
const accept = () => (window.document.querySelector('.chat__consent button') as unknown as HTMLButtonElement).click();
test('replacing an unanswered consent releases the previous preparation state', () => {
  let declined = 0;
  view.consent(copy('Local AI'), async () => {}, () => { declined++; });
  view.consent(copy('Smarter search'), async () => {});
  assert.equal(declined, 1);
  assert.match(window.document.querySelector('.chat__consent')!.textContent, /Smarter search/);
});
test('replacing an accepted download aborts it, and its completion leaves the new consent intact', async () => {
  let signal: AbortSignal | undefined, finish!: () => void, declined = 0;
  view.consent(copy('Local AI'), async (_progress, stop) => { signal = stop; await new Promise<void>(resolve => { finish = resolve; }); }, () => { declined++; });
  accept(); await Promise.resolve();
  assert.equal(signal?.aborted, false);
  view.consent(copy('Smarter search'), async () => {});
  assert.equal(signal?.aborted, true); assert.equal(declined, 1);
  finish(); await new Promise(resolve => setImmediate(resolve));
  const row = window.document.querySelector('.chat__consent') as unknown as HTMLElement;
  assert.equal(row.hidden, false); assert.match(row.textContent!, /Smarter search/);
});
