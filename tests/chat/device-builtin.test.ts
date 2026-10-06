import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createBuiltin } from '../../src/scripts/chat/device.ts';

const original = Object.getOwnPropertyDescriptor(globalThis, 'LanguageModel');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'LanguageModel', original);
  else Reflect.deleteProperty(globalThis, 'LanguageModel');
});
const input = { question: 'Explain overfitting.', chunks: [], prev: [], history: [], locale: 'en' as const };
async function consume(signal: AbortSignal) {
  const events = [];
  for await (const event of createBuiltin().generate(input, signal)) events.push(event);
  return events;
}
for (const availability of ['downloadable', 'unavailable']) {
  test(`a stale builtin probe cannot download a ${availability} model`, async () => {
    let creates = 0;
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
      availability: async () => availability,
      create: async () => { creates++; throw new Error('unexpected download'); },
    } });
    await assert.rejects(consume(new AbortController().signal), { reason: 'device' });
    assert.equal(creates, 0);
  });
}
test('Stop during a builtin availability recheck prevents create', async () => {
  let creates = 0, resolve!: (value: string) => void;
  const control = new AbortController();
  Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
    availability: () => new Promise<string>(done => { resolve = done; }),
    create: async () => { creates++; throw new Error('unexpected create'); },
  } });
  const pending = consume(control.signal);
  while (!resolve) await new Promise(done => setImmediate(done));
  control.abort(); resolve('available');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(creates, 0);
});
test('an already available builtin model creates a session and completes', async () => {
  let creates = 0, destroyed = 0;
  Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
    availability: async () => 'available',
    create: async () => { creates++; return { clone: async () => ({
      promptStreaming: () => new ReadableStream({ start(controller) {
        controller.enqueue('Overfitting learns training details and generalizes poorly.'); controller.close();
      } }),
      destroy: () => { destroyed++; },
    }) }; },
  } });
  const events = await consume(new AbortController().signal);
  assert.equal(creates, 1); assert.equal(destroyed, 1);
  assert.equal(events.at(-1)?.type, 'done');
  assert.ok(events.some(event => event.type === 'block' && /generalizes/.test(event.text)));
});
