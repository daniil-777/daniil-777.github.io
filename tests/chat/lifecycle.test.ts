import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createWebgpu, IDLE_MS } from '../../src/scripts/chat/device.ts';
import { loadModel, type LocalWorker } from '../../src/scripts/chat/semantic.ts';

const timers = new Map<number, { run: () => void; ms: number }>();
const workers: FakeWorker[] = [];
let autoReady = true, autoGenerate = true, timerId = 0;
const originals = new Map<string, PropertyDescriptor | undefined>();
class FakeWorker extends EventTarget {
  terminated = false;
  constructor() { super(); workers.push(this); }
  postMessage(message: { type: string; id?: number }) {
    if (message.type === 'llm-load' && autoReady) queueMicrotask(() => this.reply({ type: 'ready' }));
    if (message.type === 'generate' && autoGenerate) queueMicrotask(() => {
      this.reply({ type: 'token', id: message.id, text: 'Overfitting means learning training data too closely and generalizing poorly to unseen data.' });
      this.reply({ type: 'end', id: message.id });
    });
  }
  reply(data: unknown) {
    const event = new Event('message'); Object.defineProperty(event, 'data', { value: data }); this.dispatchEvent(event);
  }
  terminate() { this.terminated = true; }
}
beforeEach(() => {
  autoReady = true; autoGenerate = true; workers.length = 0; timers.clear(); timerId = 0;
  const surface = Object.assign(new EventTarget(), {
    setTimeout(run: () => void, ms: number) { const id = ++timerId; timers.set(id, { run, ms }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  for (const [key, value] of Object.entries({ window: surface, Worker: FakeWorker, caches: { open: async () => ({ keys: async () => [], delete: async () => true }) } })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});
test('reopening cancels every pending idle release of the active model', async () => {
  const dialog = new EventTarget() as HTMLDialogElement, model = createWebgpu('q4', dialog);
  await model.load(() => {}, new AbortController().signal);
  dialog.dispatchEvent(new Event('close'));
  dialog.dispatchEvent(new Event('close'));
  assert.equal([...timers.values()].filter(t => t.ms === IDLE_MS).length, 1);
  model.opened();
  await model.load(() => {}, new AbortController().signal);
  assert.equal(timers.size, 0);
  assert.equal(workers.length, 1); assert.equal(workers[0].terminated, false);
  model.dispose(); assert.equal(workers[0].terminated, true);
});
test('a disposed load cannot terminate its replacement worker or clear its loading state', async () => {
  autoReady = false;
  const model = createWebgpu('q4', new EventTarget() as HTMLDialogElement);
  const first = model.load(() => {}, new AbortController().signal);
  const firstError = assert.rejects(first, { name: 'AbortError' });
  model.dispose();
  const second = model.load(() => {}, new AbortController().signal);
  await firstError;
  assert.equal(workers[0].terminated, true); assert.equal(workers[1].terminated, false);
  assert.equal(model.load(() => {}, new AbortController().signal), second);
  workers[1].reply({ type: 'ready' }); await second;
  assert.equal(workers[1].terminated, false); model.dispose();
  assert.equal(timers.size, 0);
});
test('an already canceled model load starts no download and registers no listener or timer', async () => {
  const control = new AbortController(); control.abort(); let sent = 0, listened = 0;
  const worker: LocalWorker = { send() { sent++; }, listen() { listened++; return () => {}; }, terminate() {} };
  await assert.rejects(loadModel(worker, { type: 'llm-load', dtype: 'q4' }, () => {}, control.signal), { name: 'AbortError' });
  assert.equal(sent, 0); assert.equal(listened, 0); assert.equal(timers.size, 0);
});
test('a worker send failure cleans its load listener and deadline', async () => {
  let unlistened = 0;
  const worker: LocalWorker = { send() { throw new Error('worker closed'); }, listen() { return () => { unlistened++; }; }, terminate() {} };
  await assert.rejects(loadModel(worker, { type: 'embed-load' }, () => {}, new AbortController().signal), /worker closed/);
  assert.equal(unlistened, 1); assert.equal(timers.size, 0);
});
test('pagehide disposal settles active generation instead of leaving Send stuck', async () => {
  const model = createWebgpu('q4', new EventTarget() as HTMLDialogElement);
  await model.load(() => {}, new AbortController().signal); autoGenerate = false;
  const events = model.generator.generate({ question: 'Explain overfitting', chunks: [], prev: [] }, new AbortController().signal)[Symbol.asyncIterator]();
  assert.equal((await events.next()).value.type, 'status');
  assert.equal((await events.next()).value.type, 'status');
  const pending = events.next();
  window.dispatchEvent(new Event('pagehide'));
  await assert.rejects(pending, { reason: 'device' });
  assert.equal(workers[0].terminated, true); assert.equal(timers.size, 0);
});
