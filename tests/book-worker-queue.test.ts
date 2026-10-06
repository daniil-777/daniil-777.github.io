import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createBookGenerationQueue } from '../src/lib/book/generation-queue.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

test('Stop then New preserves the first interruption until the active model call settles', async () => {
  const old = deferred(), events: string[] = [];
  let active = 0, maximumActive = 0;
  const queue = createBookGenerationQueue<{ id: number }>({
    async run(job) {
      maximumActive = Math.max(maximumActive, ++active); events.push(`reset:${job.id}`);
      if (job.id === 1) await old.promise;
      events.push(`settled:${job.id}`); active--;
    }, interrupt() { events.push('interrupt'); }, cancelled(id) { events.push(`cancelled:${id}`); },
  });
  const first = queue.enqueue({ id: 1 }); await tick();
  queue.stop(1); const second = queue.enqueue({ id: 2 }); await tick();
  assert.deepEqual(events, ['reset:1', 'interrupt'], 'New cannot reset the shared stopping criterion while the old call remains active');
  old.resolve(); await Promise.all([first, second]);
  assert.deepEqual(events, ['reset:1', 'interrupt', 'settled:1', 'reset:2', 'settled:2']);
  assert.equal(maximumActive, 1);
});

test('cancelled queued requests emit completion without entering or resetting the model', async () => {
  const old = deferred(), runs: number[] = [], ends: number[] = [];
  let interrupts = 0;
  const queue = createBookGenerationQueue<{ id: number }>({
    async run(job) { runs.push(job.id); if (job.id === 1) await old.promise; },
    interrupt() { interrupts++; }, cancelled(id) { ends.push(id); },
  });
  const first = queue.enqueue({ id: 1 }); await tick();
  const cancelled = queue.enqueue({ id: 2 }); queue.stop(2);
  const next = queue.enqueue({ id: 3 });
  assert.equal(interrupts, 0, 'Stopping a waiting request leaves the running request alone');
  old.resolve(); await Promise.all([first, cancelled, next]);
  assert.deepEqual(runs, [1, 3]); assert.deepEqual(ends, [2]);
});

test('stale request IDs and repeated Stop never interrupt a different running request', async () => {
  const held = deferred(); let interrupts = 0;
  const queue = createBookGenerationQueue<{ id: number }>({
    async run(job) { if (job.id === 2) await held.promise; }, interrupt() { interrupts++; }, cancelled() {},
  });
  await queue.enqueue({ id: 1 });
  const second = queue.enqueue({ id: 2 }); await tick();
  queue.stop(1); assert.equal(interrupts, 0);
  queue.stop(2); queue.stop(2); assert.equal(interrupts, 1);
  held.resolve(); await second;
});

test('a failed generation reports its error and releases the model for queued work', async () => {
  const runs: number[] = [];
  const queue = createBookGenerationQueue<{ id: number }>({
    async run(job) { runs.push(job.id); if (job.id === 1) throw new Error('GPU lost'); }, interrupt() {}, cancelled() {},
  });
  const failed = queue.enqueue({ id: 1 }), next = queue.enqueue({ id: 2 });
  await assert.rejects(() => failed, /GPU lost/); await next; assert.deepEqual(runs, [1, 2]);
});

test('a stop before a request starts and an all-stop cancel queued jobs without inference', async () => {
  const runs: number[] = [], cancelled: number[] = [];
  const queue = createBookGenerationQueue<{ id: number }>({
    async run(job) { runs.push(job.id); }, interrupt() {}, cancelled(id) { cancelled.push(id); },
  });
  const first = queue.enqueue({ id: 1 }); queue.stop(1);
  const second = queue.enqueue({ id: 2 }); queue.stop();
  await Promise.all([first, second]); assert.deepEqual(runs, []); assert.deepEqual(cancelled, [1, 2]);
});

test('the real book worker serializes Stop then New around its shared stopping criterion', async () => {
  // Execute the shipped worker entry point with a gated model, without a GPU or downloads.
  const gate = deferred(), events: string[] = [], replies: { type: string; id?: number }[] = [];
  const worker = { postMessage(value: { type: string; id?: number }) { replies.push(value); }, onmessage: undefined as undefined | ((event: { data: Record<string, unknown> }) => Promise<void>) };
  class Stopper { reset() { events.push('reset'); } interrupt() { events.push('interrupt'); } }
  class Streamer { callback: (text: string) => void; constructor(_tokenizer: unknown, options: { callback_function(text: string): void }) { this.callback = options.callback_function; } }
  const model = { async generate(options: { prompt: string; streamer: Streamer }) {
    events.push(`start:${options.prompt}`);
    if (options.prompt === 'old') await gate.promise;
    options.streamer.callback(options.prompt); events.push(`settled:${options.prompt}`);
  } };
  const transformers = {
    env: { backends: { onnx: { wasm: {} } } }, InterruptableStoppingCriteria: Stopper, TextStreamer: Streamer,
    AutoTokenizer: { from_pretrained: async () => ({ apply_chat_template: (messages: { content: string }[]) => ({ prompt: messages[1].content }) }) },
    AutoModelForCausalLM: { from_pretrained: async () => model },
  };
  const source = readFileSync(new URL('../src/lib/book/local.worker.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { self: worker, exports: {}, require(name: string) {
    if (name === '@huggingface/transformers') return transformers;
    if (name === '../../data/chat.ts') return { LOCAL_LLM: { id: 'test-only-model', revision: 'test-only-revision' } };
    if (name === './generation-queue.ts') return { createBookGenerationQueue };
    throw new Error(`Unexpected worker dependency ${name}`);
  } });
  await worker.onmessage!({ data: { type: 'llm-load', dtype: 'q4' } });
  const first = worker.onmessage!({ data: { type: 'generate', id: 1, system: '', prompt: 'old' } }); await tick();
  await worker.onmessage!({ data: { type: 'stop', id: 1 } });
  const next = worker.onmessage!({ data: { type: 'generate', id: 2, system: '', prompt: 'new' } }); await tick();
  assert.deepEqual(events, ['reset', 'start:old', 'interrupt'], 'The actual worker cannot reset or invoke the new model before the old call settles');
  gate.resolve(); await Promise.all([first, next]);
  assert.deepEqual(events, ['reset', 'start:old', 'interrupt', 'settled:old', 'reset', 'start:new', 'settled:new']);
  assert.deepEqual(replies.filter(reply => reply.type === 'end').map(reply => reply.id), [1, 2]);
});
