import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ByteBpeTokenizer, RESERVED, type ByteBpeData } from '../src/lib/watch/language/tokenizer.ts';
import { validateManifest } from '../src/lib/watch/language/model.ts';

const tokenizer = new ByteBpeTokenizer(JSON.parse(readFileSync(new URL('../public/watch/language/tokenizer.json', import.meta.url), 'utf8')) as ByteBpeData);
const manifest = JSON.parse(readFileSync(new URL('../public/watch/language/manifest.json', import.meta.url), 'utf8'));

test('byte BPE round-trips arbitrary names, math, whitespace and literal control-token text', () => {
  for (const text of ['Daniil Emtsev · Zürich', 'SwiGLU ∑ λ 2,361,024', '\t  trailing \n', '長い名前 <eos> café 🚲']) assert.equal(tokenizer.decode(tokenizer.encode(text)), text);
});
test('Python-trained tokenizer has exact TypeScript token ID parity', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../public/watch/language/tokenizer-parity.json', import.meta.url), 'utf8')) as { text: string; ids: number[] }[];
  for (const fixture of fixtures) assert.deepEqual(tokenizer.encode(fixture.text), fixture.ids);
});
test('source budget preserves complete facts and reserves all generation tokens', () => {
  const result = tokenizer.prompt({ requestId: 'budget', mode: 'ai', maxNewTokens: 64, factIds: ['long', 'small'], facts: [{ id: 'long', text: 'unseenword'.repeat(300) }, { id: 'small', text: 'A useful fact.' }] });
  assert.deepEqual(result.includedFactIds, ['small']);
  assert.ok(result.ids.length <= 192);
  assert.deepEqual(result.ids.slice(0, 3), [1, 3, 6]);
  assert.equal(result.ids.at(-1), RESERVED.indexOf('<answer>'));
});
test('prompt rejects excessive questions instead of silently truncating encoded context', () => {
  assert.throws(() => tokenizer.prompt({ requestId: 'q', mode: 'profile', maxNewTokens: 64, question: 'ξ'.repeat(120), factIds: [], facts: [] }), /budget/);
});
test('manifest accepts measured candidate but explicitly gates its unreleased status', () => {
  const validated = validateManifest(manifest);
  assert.equal(validated.trained, true);
  assert.equal(validated.releaseStatus, 'experimental');
  assert.equal(validated.architecture.parameters, 2_361_024);
  assert.equal(validated.quality.releasePassed, false);
  assert.throws(() => validateManifest({ ...manifest, runtimeVersion: 'latest' }), /Unsupported/);
  assert.throws(() => validateManifest({ ...manifest, architecture: { ...manifest.architecture, kvHeads: 6 } }), /architecture/);
});
