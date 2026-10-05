import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { KNOWLEDGE_DOMAINS, retrieveFacts, validateFactPack } from '../src/lib/watch/facts.ts';
import type { WatchKnowledgeDomain } from '../src/lib/watch/types.ts';

const pack = validateFactPack(JSON.parse(readFileSync(new URL('../public/watch/facts.v1.json', import.meta.url), 'utf8')));

test('each knowledge field rotates only its reviewed AI facts', () => {
  for (const domain of KNOWLEDGE_DOMAINS.filter(value => value !== 'all')) {
    const expected = pack.facts.filter(fact => fact.mode === 'ai' && (fact.domain ?? 'ai') === domain);
    assert.ok(expected.length > 0, `The ${domain} choice needs reviewed content.`);
    for (let offset = 0; offset <= expected.length; offset++) {
      const result = retrieveFacts(pack, 'ai', '', offset, domain);
      assert.equal(result[0]?.id, expected[offset % expected.length].id);
      assert.equal(result[0]?.domain ?? 'ai', domain);
    }
  }
});

test('field selection preserves other modes and refuses unsupported metadata', () => {
  assert.deepEqual(retrieveFacts(pack, 'profile', '', 0, 'math'), retrieveFacts(pack, 'profile', '', 0));
  assert.deepEqual(retrieveFacts(pack, 'wellbeing', '', 0, 'finance'), retrieveFacts(pack, 'wellbeing', '', 0));
  assert.equal(retrieveFacts(pack, 'ai', '', 0, 'all')[0].id, pack.facts.find(fact => fact.mode === 'ai')!.id);
  assert.throws(() => validateFactPack({ ...pack, facts: [{ ...pack.facts[0], domain: 'unreviewed' }, ...pack.facts.slice(1)] }), /knowledge field/);
  assert.deepEqual(retrieveFacts(pack, 'ai', '', 0, 'unsupported' as WatchKnowledgeDomain), []);
});
