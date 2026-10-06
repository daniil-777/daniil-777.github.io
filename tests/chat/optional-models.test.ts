import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Window } from 'happy-dom';
import { createOptionalModels } from '../../src/scripts/chat/optional-models.ts';
import { createView, type Mode } from '../../src/scripts/chat/view.ts';
import type { Kb } from '../../src/lib/chat/kb.ts';
let window: Window, view: ReturnType<typeof createView>, model: ReturnType<typeof createOptionalModels>, dialog: HTMLDialogElement, mode: Mode, failures: number;
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  window = new Window(); mode = 'device'; failures = 0;
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Node']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key as keyof Window] });
  }
  window.document.body.innerHTML = '<dialog open><button data-chat-new></button><div data-chat-status></div><div data-chat-body></div></dialog>';
  dialog = window.document.querySelector('dialog')! as unknown as HTMLDialogElement;
  view = createView(dialog, '2026-10-06', { ask: () => true, stop() {}, mode() {}, reset() {}, semantic() {} });
  model = createOptionalModels({ kb: { embedding: null } as Kb, dialog, view,
    offer: () => ({ quotes: true, cloud: true, builtin: false, webgpu: 'q4', semantic: false }),
    mode: () => mode, select: next => { mode = next; }, changed() {}, failed() { failures++; }, stop() {}, read: () => null, write() {} });
});
afterEach(async () => {
  view.cancelConsent(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const consent = () => window.document.querySelector('.chat__consent')! as unknown as HTMLElement;
test('manual selection and automatic fallback share one preparation and consent', async () => {
  const manual = model.local(), control = new AbortController(), automatic = model.local(control.signal);
  await tick(); assert.equal(consent().hidden, false);
  control.abort(); assert.equal(await automatic, undefined); assert.equal(await manual, undefined);
  assert.equal(consent().hidden, true); assert.equal(mode, 'quotes'); assert.equal(failures, 0);
});
test('stopping before the dynamic import completes never opens late consent', async () => {
  const control = new AbortController(), ready = model.local(control.signal); control.abort();
  assert.equal(await ready, undefined); await tick(); assert.equal(consent().hidden, true); assert.equal(failures, 0);
});
test('New chat cancels manual preparation even before its consent is rendered', async () => {
  const ready = model.local(); model.cancel();
  assert.equal(await ready, undefined); await tick(); assert.equal(consent().hidden, true); assert.equal(failures, 0);
});
test('replacing consent settles preparation and lets the local choice be offered again', async () => {
  const old = model.local(); await tick();
  view.consent({ consent: 'Other download?', accept: 'Accept', decline: 'Decline' }, async () => {});
  assert.equal(await old, undefined); assert.match(consent().textContent!, /Other download/);
  mode = 'device'; const next = model.local(); await tick(); assert.match(consent().textContent!, /885 MB/);
  view.cancelConsent(); assert.equal(await next, undefined); assert.equal(failures, 0);
});
test('closing a pending automatic download choice releases the waiting question', async () => {
  const ready = model.local(new AbortController().signal); await tick();
  dialog.dispatchEvent(new window.Event('close') as unknown as Event);
  assert.equal(await ready, undefined); assert.equal(consent().hidden, true); assert.equal(mode, 'quotes');
});
