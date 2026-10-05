/**
 * The parts of the Worker that need neither Cloudflare nor the Anthropic SDK:
 * who may call it, how much it reads, which knowledge base it accepts, the
 * daily counter, and how the model's stream becomes the site's own events.
 * The Worker as a whole is exercised by `npm run chat:smoke`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Chunk } from '../../src/lib/chat/kb.ts';
import type { ChatEvent } from '../../src/lib/chat/protocol.ts';
import { allowedOrigin, checkKb, convert, readCapped, take, type UpstreamEvent } from '../../worker/src/logic.ts';

const chunk = (id: string, extra: Partial<Chunk> = {}): Chunk => ({ id, kind: 'site', url: '/', title: id, heading: '', tags: [], asks: [], text: `Text of ${id}.`, ...extra });
const chunks = [chunk('a'), chunk('b'), chunk('c')];

async function* stream(events: UpstreamEvent[]) {
  yield* events;
}
async function collect(events: UpstreamEvent[]): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of convert(stream(events), chunks)) out.push(event);
  return out;
}

const start: UpstreamEvent = { type: 'message_start', message: { usage: { input_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 1 } } };
const text = (index: number, value: string, cites: number[] = []): UpstreamEvent[] => [
  { type: 'content_block_start', index, content_block: { type: 'text' } },
  ...cites.map((document_index): UpstreamEvent => ({ type: 'content_block_delta', index, delta: { type: 'citations_delta', citation: { type: 'content_block_location', document_index } } })),
  { type: 'content_block_delta', index, delta: { type: 'text_delta', text: value.slice(0, 3) } },
  { type: 'content_block_delta', index, delta: { type: 'text_delta', text: value.slice(3) } },
  { type: 'content_block_stop', index },
];
const end = (stop_reason: string, output_tokens = 30): UpstreamEvent[] => [{ type: 'message_delta', delta: { stop_reason }, usage: { output_tokens } }, { type: 'message_stop' }];

describe('allowedOrigin', () => {
  const list = 'https://demtsev.com, https://www.demtsev.com';
  it('accepts an exact entry of the list', () => assert.equal(allowedOrigin('https://www.demtsev.com', list), 'https://www.demtsev.com'));
  it('rejects a missing origin', () => assert.equal(allowedOrigin(null, list), undefined));
  it('rejects look-alikes', () => {
    for (const origin of ['https://demtsev.com.evil.example', 'http://demtsev.com', 'https://demtsev.com/', 'null', '*', '']) assert.equal(allowedOrigin(origin, list), undefined, origin);
  });
  it('rejects everything when the list is empty', () => assert.equal(allowedOrigin('https://demtsev.com', ''), undefined));
});

describe('readCapped', () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request('https://x.example/v1/chat', { method: 'POST', body, headers });
  it('returns a body within the cap', async () => assert.equal(await readCapped(post('{"v":1}'), 16), '{"v":1}'));
  it('refuses a declared length over the cap without reading', async () => assert.equal(await readCapped(post('{}', { 'Content-Length': '5000' }), 4096), undefined));
  it('refuses a body that turns out longer than the cap', async () => assert.equal(await readCapped(post('x'.repeat(5000)), 4096), undefined));
  it('counts bytes, not characters', async () => assert.equal(await readCapped(post('é'.repeat(9)), 16), undefined));
});

describe('checkKb', () => {
  const kb = { v: 1, hash: 'abc', built: '2026-10-03', embedding: null, chunks };
  it('accepts a knowledge base and keeps its chunks and hash', () => assert.deepEqual(checkKb(kb), { hash: 'abc', chunks }));
  it('rejects another version, no chunks, too many chunks', () => {
    assert.equal(checkKb({ ...kb, v: 2 }), undefined);
    assert.equal(checkKb({ ...kb, chunks: [] }), undefined);
    assert.equal(checkKb({ ...kb, chunks: Array.from({ length: 401 }, (_, index) => chunk(`c${index}`)) }), undefined);
  });
  it('rejects a chunk whose address is not on this site', () => assert.equal(checkKb({ ...kb, chunks: [chunk('a', { url: 'https://evil.example/' })] }), undefined));
  it('rejects a chunk with a missing field', () => assert.equal(checkKb({ ...kb, chunks: [{ id: 'a', url: '/' }] }), undefined));
  it('rejects more text than the site could hold', () => assert.equal(checkKb({ ...kb, chunks: [chunk('a', { text: 'x'.repeat(300_001) })] }), undefined));
  it('rejects anything that is not an object', () => {
    for (const value of [null, 'kb', 3, []]) assert.equal(checkKb(value), undefined);
  });
});

describe('take', () => {
  it('counts up within a day', () => assert.deepEqual(take({ day: '2026-10-03', count: 4 }, '2026-10-03', 150), { ok: true, next: { day: '2026-10-03', count: 5 } }));
  it('starts at one on a new day or with nothing stored', () => {
    assert.deepEqual(take({ day: '2026-10-02', count: 150 }, '2026-10-03', 150), { ok: true, next: { day: '2026-10-03', count: 1 } });
    assert.deepEqual(take(undefined, '2026-10-03', 150), { ok: true, next: { day: '2026-10-03', count: 1 } });
  });
  it('refuses once the limit is reached, and does not count the refusal', () => assert.deepEqual(take({ day: '2026-10-03', count: 150 }, '2026-10-03', 150), { ok: false }));
  it('refuses everything when the limit is not a positive number', () => {
    for (const limit of [0, -1, Number.NaN]) assert.deepEqual(take(undefined, '2026-10-03', limit), { ok: false });
  });
});

describe('convert', () => {
  it('turns a cited answer into status, one block per text block, and done', async () => {
    const events = await collect([start, ...text(0, 'He works at VirtaMed.', [1]), ...text(1, ' He studied at ETH.', [2, 0, 2]), ...end('end_turn')]);
    assert.deepEqual(events, [
      { event: 'status', data: { s: 'thinking' } },
      { event: 'block', data: { t: 'He works at VirtaMed.', c: ['b'] } },
      { event: 'block', data: { t: ' He studied at ETH.', c: ['c', 'a'] } },
      { event: 'done', data: { stop: 'end_turn', usage: { in: 40, out: 30, cr: 9000, cw: 0 } } },
    ]);
  });

  it('ignores thinking, fallback and unknown blocks, and empty text', async () => {
    const events = await collect([
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'leak' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'fallback' } },
      { type: 'content_block_stop', index: 1 },
      ...text(2, '  \n'),
      ...text(3, 'Yes.'),
      ...end('end_turn'),
    ]);
    assert.deepEqual(events.filter((event) => event.event === 'block'), [{ event: 'block', data: { t: 'Yes.', c: [] } }]);
  });

  it('drops a citation that points outside the knowledge base', async () => {
    const [, block] = await collect([start, ...text(0, 'Fact.', [7, 1, -1]), ...end('end_turn')]);
    assert.deepEqual(block, { event: 'block', data: { t: 'Fact.', c: ['b'] } });
  });

  it('reports a refusal and a cut-off answer as such, anything else as a normal end', async () => {
    const stop = async (reason: string) => (await collect([start, ...end(reason)])).at(-1);
    assert.deepEqual((await stop('refusal'))?.data, { stop: 'refusal', usage: { in: 40, out: 30, cr: 9000, cw: 0 } });
    assert.deepEqual((await stop('max_tokens'))?.data, { stop: 'max_tokens', usage: { in: 40, out: 30, cr: 9000, cw: 0 } });
    assert.deepEqual((await stop('stop_sequence'))?.data, { stop: 'end_turn', usage: { in: 40, out: 30, cr: 9000, cw: 0 } });
  });

  it('prefers the final usage figures where the stream repeats them', async () => {
    const events = await collect([start, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12, input_tokens: 41, cache_creation_input_tokens: 5 } }, { type: 'message_stop' }]);
    assert.deepEqual(events.at(-1), { event: 'done', data: { stop: 'end_turn', usage: { in: 41, out: 12, cr: 9000, cw: 5 } } });
  });

  it('ends with an error when the stream breaks off before the model stopped', async () => {
    const events = await collect([start, ...text(0, 'Half an')]);
    assert.deepEqual(events.at(-1), { event: 'error', data: { code: 'upstream' } });
  });

  it('does not release a block that was still being written', async () => {
    const events = await collect([start, { type: 'content_block_start', index: 0, content_block: { type: 'text' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half' } }]);
    assert.equal(events.some((event) => event.event === 'block'), false);
  });
});
