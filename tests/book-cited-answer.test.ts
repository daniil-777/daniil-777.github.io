import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBookAnswer } from '../src/lib/book/cited-answer.ts';
import type { Chunk } from '../src/lib/chat/kb.ts';
import type { Generator, GenEvent } from '../src/lib/chat/types.ts';

const personal = 'Daniil builds computer vision and language-model systems that support surgical training at VirtaMed.';
const exact: Chunk = {
  id: 'site:bio-2', kind: 'site', url: '/#about', title: 'About Daniil', heading: 'Public work',
  text: personal, asks: [], tags: ['computer vision', 'surgical training'],
};
// Both records overlap lexically, but the model explicitly supports its sentence with the About record.
const overlapping: Chunk = { ...exact, id: 'journey:virtamed', kind: 'journey', url: '/#journey', title: 'VirtaMed' };
const chunks = [overlapping, exact];
const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
function local(events: GenEvent[], id: Generator['id'] = 'builtin'): Generator {
  return { id, conversational: true, async *generate() { yield* events; } };
}
function options(generator: Generator, stop = new AbortController().signal) {
  return { generator, question: 'Describe Daniil’s documented public work in one sentence.', prev: [], chunks, byId, stop };
}
function completed(text = personal, cites = [exact.id], stop = 'end_turn'): GenEvent[] {
  return [{ type: 'block', text, cites }, { type: 'done', stop }];
}

test('a complete local answer retains its exact cited source instead of lexically overlapping records', async () => {
  const callbacks: string[][] = [];
  const source = local(completed(personal, [exact.id, exact.id]));
  const result = await generateBookAnswer({ ...options(source), onBlock: (_text, ids) => callbacks.push(ids) });
  assert.equal(result.kind, 'answer');
  if (result.kind !== 'answer') return;
  assert.deepEqual(result.cites, [exact.id]);
  assert.equal(byId.get(result.cites[0])?.url, '/#about');
  assert.deepEqual(result.blocks, [personal]);
  assert.equal(result.stopped, false); assert.equal(result.cutShort, false); assert.equal(result.abstained, false);
  assert.deepEqual(callbacks, [[]], 'The unchanged pipeline still sees a local generator, without cloud relabeling');
  assert.equal(source.id, 'builtin');
});

test('an unknown emitted ID is rejected by the production guard before any source override', async () => {
  const result = await generateBookAnswer(options(local(completed(personal, ['invented:unknown']))));
  assert.deepEqual(result, { kind: 'fallback', reason: 'unverified' });
});

test('unsupported personal claims remain rejected even when they cite a real record', async () => {
  const result = await generateBookAnswer(options(local(completed('Daniil worked at Tesla before joining VirtaMed.', [exact.id]))));
  assert.deepEqual(result, { kind: 'fallback', reason: 'unverified' });
});

test('general local text has no invented citations and makes no external inference request', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No external inference is allowed'); });
  const general = 'Computer vision combines images and learned patterns to identify useful structures, helping systems interpret their visual surroundings.';
  const result = await generateBookAnswer({ ...options(local(completed(general, []), 'webgpu')), question: 'Explain computer vision in one sentence.', chunks: [], byId: new Map() });
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') { assert.deepEqual(result.cites, []); assert.deepEqual(result.blocks, [general]); }
  assert.equal(requests, 0);
});

test('a complete local answer without emitted IDs preserves the existing lexical source fallback', async () => {
  const text = 'Computer vision combines images and learned patterns to identify useful structures, helping systems interpret their visual surroundings.';
  const result = await generateBookAnswer(options(local(completed(text, []))));
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') assert.deepEqual(result.cites, [overlapping.id, exact.id]);
});

test('stopped answers retain the production outcome and are never promoted to complete citations', async () => {
  const control = new AbortController();
  const source: Generator = { id: 'builtin', conversational: true, async *generate() {
    yield { type: 'block', text: personal, cites: [exact.id] };
    control.abort();
    yield { type: 'status' };
  } };
  const result = await generateBookAnswer(options(source, control.signal));
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') {
    assert.equal(result.stopped, true); assert.equal(result.cutShort, false);
    assert.deepEqual(result.cites, [overlapping.id, exact.id]);
  }
});

test('token-limited answers retain the production cut-short result', async () => {
  const result = await generateBookAnswer(options(local(completed(personal, [exact.id], 'max_tokens'))));
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') { assert.equal(result.cutShort, true); assert.deepEqual(result.cites, [overlapping.id, exact.id]); }
});

test('abstentions keep their empty source list', async () => {
  const text = 'I don’t know that. The site doesn’t cover it.';
  const result = await generateBookAnswer(options(local(completed(text, [exact.id]))));
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') { assert.equal(result.abstained, true); assert.deepEqual(result.cites, []); }
});
