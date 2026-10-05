import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { restoreTurns, type Turn } from '../../src/scripts/chat/transcript.ts';
import type { Resource } from '../../src/lib/chat/resources.ts';

const cv: Resource = { id: 'cv', kind: 'cv', title: 'Public CV', url: '/docs/cv.pdf', download: true };
const turn: Turn = { q: 'Show his CV', at: 1, answer: { mode: 'quotes', text: ['Here it is.'], passages: [], chips: [], followUps: [], meta: '', resources: [cv] } };
const restore = (value: unknown) => restoreTurns(JSON.stringify(value), [cv]);

describe('untrusted saved transcript', () => {
  it('restores valid turns and replaces attachment metadata from the public registry', () => {
    const saved = { ...turn, answer: { ...turn.answer, resources: [{ id: 'cv', url: 'https://evil.example/' }, null, { id: 'removed' }] } };
    assert.deepEqual(restore([saved]), [turn]);
    assert.equal(restore(Array.from({ length: 15 }, () => turn)).length, 10);
  });
  it('drops malformed rows without breaking valid conversation history', () => {
    const answers = [{ items: 'oops' }, { lead: true }, { text: [null] }, { followUps: [4] }, { mode: 'constructor' }, { meta: null }];
    for (const malformed of answers) assert.deepEqual(restore([{ ...turn, answer: { ...turn.answer, ...malformed } }, turn]), [turn]);
    for (const malformed of [{ url: 123 }, { sent: 'yes' }, { about: false }, { at: null }]) assert.deepEqual(restore([{ ...turn, ...malformed }, turn]), [turn]);
    assert.deepEqual(restore(null), []);
    assert.deepEqual(restoreTurns('{broken', [cv]), []);
  });
  it('rejects restored unsafe source and context links', () => {
    for (const url of ['/\\evil.example/a', '//evil.example/a', '/work/../private.pdf', 'https://evil.example/', '/%5cevil.example/a']) {
      assert.deepEqual(restore([{ ...turn, url }]), [], url);
      assert.deepEqual(restore([{ ...turn, answer: { ...turn.answer, chips: [{ label: 'Source', url }] } }]), [], url);
    }
    assert.equal(restore([{ ...turn, url: '/work/astro-pilot/#videos-title' }]).length, 1);
  });
});
