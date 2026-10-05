import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { LocalLanguageRuntime, WatchLanguageClient } from '../src/lib/watch/language/runtime.ts';
import type { LanguageCommand, LanguageEvent } from '../src/lib/watch/language/protocol.ts';

const manifest = JSON.parse(readFileSync(new URL('../public/watch/language/manifest.json', import.meta.url), 'utf8'));
test('experimental weights are gated before any model or inference-runtime asset download', async () => {
  const oldLocation = globalThis.location;
  const oldFetch = globalThis.fetch;
  const requests: string[] = [];
  Object.defineProperty(globalThis, 'location', { value: { href: 'https://demtsev.com/', origin: 'https://demtsev.com' }, configurable: true });
  globalThis.fetch = (async input => { requests.push(String(input)); return new Response(JSON.stringify(manifest)); }) as typeof fetch;
  const events: LanguageEvent[] = [];
  try {
    const runtime = new LocalLanguageRuntime(event => events.push(event));
    await runtime.load('load-1', '/watch/language/manifest.json');
    assert.equal(requests.length, 1);
    assert.equal(events.at(-1)?.type, 'status');
    assert.ok(events.some(event => event.type === 'status' && event.status === 'unavailable'));
    await assert.rejects(runtime.generate({ requestId: 'g', mode: 'ai', factIds: [], facts: [], maxNewTokens: 64 }), /failed held-out/);
    await runtime.dispose('dispose-1');
    assert.ok(events.some(event => event.type === 'status' && event.status === 'disposed'));
  } finally { globalThis.fetch = oldFetch; Object.defineProperty(globalThis, 'location', { value: oldLocation, configurable: true }); }
});

class FakeWorker {
  static latest: FakeWorker;
  handlers: ((event: { data: LanguageEvent }) => void)[] = [];
  messages: LanguageCommand[] = [];
  terminated = false;
  constructor() { FakeWorker.latest = this; }
  addEventListener(type: string, callback: (event: { data: LanguageEvent }) => void): void { if (type === 'message') this.handlers.push(callback); }
  postMessage(message: LanguageCommand): void {
    this.messages.push(message);
    if (message.type === 'load') queueMicrotask(() => this.emit({ type: 'status', requestId: message.requestId, status: 'ready' }));
    if (message.type === 'dispose') queueMicrotask(() => this.emit({ type: 'status', requestId: message.requestId, status: 'disposed' }));
  }
  emit(event: LanguageEvent): void { for (const handler of this.handlers) handler({ data: event }); }
  terminate(): void { this.terminated = true; }
}
test('client remains lazy, rejects cancelled requests, ignores stale tokens and terminates on disposal', async () => {
  const oldWorker = globalThis.Worker;
  Object.defineProperty(globalThis, 'Worker', { value: FakeWorker, configurable: true });
  const events: LanguageEvent[] = [];
  const client = new WatchLanguageClient(event => events.push(event));
  try {
    assert.equal(client.status, 'unavailable');
    await client.init();
    const worker = FakeWorker.latest;
    const pending = client.generate({ requestId: 'old-mode', mode: 'profile', factIds: [], facts: [], maxNewTokens: 64 });
    const rejection = assert.rejects(pending, /cancelled/);
    client.cancel();
    await rejection;
    worker.emit({ type: 'token', requestId: 'old-mode', tokenId: 1, tokenText: 'stale' });
    assert.ok(!events.some(event => event.type === 'token'));
    await client.dispose();
    assert.equal(client.status, 'disposed');
    assert.equal(worker.terminated, true);
    assert.ok(worker.messages.some(message => message.type === 'cancel' && message.requestId === 'old-mode'));
  } finally { Object.defineProperty(globalThis, 'Worker', { value: oldWorker, configurable: true }); }
});
