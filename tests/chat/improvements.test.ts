/** Regressions reproduced during the Ask AI follow-up audit. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadKb } from './load.ts';
import { selectResources, type Resource } from '../../src/lib/chat/resources.ts';
import { buildIndex } from '../../src/lib/chat/bm25.ts';
import { createRag } from '../../src/lib/chat/rag.ts';
import { generalQuestion, buildLocalPrompt, LOCAL_PROMPT_TOKENS_MAX } from '../../src/lib/chat/prompt.ts';
import { guardConversationBlock, newGuardState } from '../../src/lib/chat/guard.ts';
import { refersToPrevious } from '../../src/lib/chat/context.ts';
import { conversationHistory, generateAnswer, searchInContext } from '../../src/scripts/chat/pipeline.ts';
import { subjectTerms } from '../../src/lib/chat/retrieve.ts';
import type { Generator } from '../../src/lib/chat/types.ts';

const kb = await loadKb(), byId = new Map(kb.chunks.map(c => [c.id, c]));
const registry: Resource[] = JSON.parse(await readFile(new URL('../../build/chat/resources.json', import.meta.url), 'utf8'));
const ids = (q: string, previous?: string, url?: string) => selectResources(q, registry, [], previous, url).map(r => r.id);
for (const [q, expected] of [
  ['Show Astro Pilot code', ['link:astro-pilot:1']],
  ['Where is the source for Astro Pilot?', ['link:astro-pilot:1']],
  ['Open Astro Pilot', ['project:astro-pilot']],
  ['Try Astro Pilot', ['link:astro-pilot:0']],
  ['Open the Astro Pilot app', ['link:astro-pilot:0']],
  ['Show spaceship videos', ['video:astro-pilot']],
  ['Show the Dynamic Plane paper', ['document:dynamic-plane-onet-paper']],
  ['Show the camera pose paper', ['document:camera-pose-patent']],
  ['Show the Barcodes paper', ['document:loss-landscape-barcodes-paper']],
  ['Show Universal AI Proctor videos', []],
  ['Show Universal AI Proctor and AI Proctor GitHub', ['link:universal-ai-proctor:1']],
  ['Show Cuevertis GitHub', ['link:universal-ai-proctor:1']],
  ['Open the Cuevertis app', ['link:universal-ai-proctor:0']],
  ['Open the Cueveris app', ['link:universal-ai-proctor:0']],
  ['Show his GitHub and LinkedIn', ['profile:github', 'profile:linkedin']],
  ['Share LinkedIn and Scholar profiles', ['profile:linkedin', 'profile:scholar']],
  ['Show his GitHub and Astro Pilot code', ['link:astro-pilot:1', 'profile:github']],
  ['Show his LinkedIn and the Pixel Morph video', ['video:pixel-morph', 'profile:linkedin']],
  ['Send the Dynamic Plane paper and camera pose patent', ['document:camera-pose-patent', 'document:dynamic-plane-onet-paper']],
] as [string, string[]][]) test(`resource: ${q}`, () => assert.deepEqual(ids(q), expected));

test('personal profiles and research collections stand on their own after a project', () => {
  for (const [q, expected] of [['Show his GitHub', 'profile:github'], ['GitHub', 'profile:github'], ['Show LinkedIn', 'profile:linkedin'], ['Show Scholar', 'profile:scholar']]) {
    assert.deepEqual(ids(q, 'What is Astro Pilot?', '/work/astro-pilot/'), [expected], q);
  }
  const papers = selectResources('Show his research papers', registry, [], 'What is Pixel Morph?', '/work/pixel-morph/');
  assert.equal(papers.length, 4); assert.ok(papers.every(r => r.kind === 'document'));
});
test('pronoun links retain the project across project and document cards', () => {
  assert.deepEqual(ids('And its code?', 'Send Dynamic Plane paper', '/papers/dynamic-plane-onet-paper.pdf#page=1'), ['link:dynamic-plane-onet:0']);
  for (const q of ['Try its app', 'Open its app']) assert.deepEqual(ids(q, 'What is Astro Pilot?', '/work/astro-pilot/'), ['link:astro-pilot:0']);
  assert.deepEqual(ids('Open it', 'What is Astro Pilot?', '/work/astro-pilot/'), ['project:astro-pilot']);
});
test('reference websites are not advertised as live demos', () => {
  assert.ok(!registry.some(r => r.kind === 'demo' && /molecular-design-lab/.test(r.id)));
});
test('result comparisons quote outcomes from both projects', () => {
  const result = createRag(kb.chunks, buildIndex(kb.chunks)).detailed('Compare the results of AI Proctor and Ultrasound Anatomy Detection')!;
  assert.ok(result.cites.includes('project:ultrasound-anatomy-detection#result'));
  assert.ok(result.cites.some(id => /^project:ai-proctor(?:#.*result)?$/.test(id)));
  assert.match(result.text.join(' '), /60% to 90%/);
});
test('generic category aliases do not replace technical explanations with portfolio text', () => {
  const rag = createRag(kb.chunks, buildIndex(kb.chunks));
  for (const q of ['Explain spacecraft propulsion in detail', 'Explain barcodes in detail', 'What improves performance in occupancy networks?', 'Compare loss landscapes for neural networks in detail']) {
    assert.equal(generalQuestion(q, kb.chunks), true, q); assert.equal(rag.detailed(q), undefined, q);
  }
  assert.ok(rag.detailed('Explain his Barcodes project in detail'));
  assert.equal(generalQuestion('Explain Dynamic Plane in detail', kb.chunks), false);
});
test('new topics beginning with continuation letters do not inherit the previous topic', () => {
  const index = buildIndex(kb.chunks);
  for (const q of ['Android architecture', 'Software architecture patterns', 'Sort a Python list', 'Button accessibility']) {
    assert.equal(refersToPrevious(q), false, q);
    assert.equal(searchInContext(index, q, { q: 'What is Astro Pilot?', about: 'Astro Pilot' }, subjectTerms(kb.chunks), kb.chunks).query, q);
  }
});
test('shortened website-owner aliases require source-backed personal claims', () => {
  for (const q of ['When did the owner of this website graduate?', 'Where did the author of this website go to school?', 'Where does this engineer work?', 'What is the background of the creator of this portfolio?']) {
    assert.equal(generalQuestion(q, kb.chunks), false, q);
    for (const a of ['The author attended Harvard University.', 'The owner graduated in 2014.', 'This engineer works at Tesla.']) assert.equal(guardConversationBlock(a, [], q, newGuardState()).ok, false, `${q}: ${a}`);
  }
  assert.equal(guardConversationBlock('The author attended Harvard University.', [byId.get('fact:education')!], 'Where did the author of this website go to school?', newGuardState()).ok, false);
});
test('generic owner and author definitions remain usable', () => {
  for (const [q, a] of [
    ['What is a website owner?', 'The website owner manages a site and its content.'],
    ['Who is the owner of a website?', 'The owner of the website is the person or organisation responsible for it.'],
    ['What is the HTML author meta tag?', 'The author meta tag identifies a document author.'],
    ['What does a software engineer study?', 'Software engineers study programming and software design.'],
  ]) { assert.equal(generalQuestion(q, kb.chunks), true, q); assert.equal(guardConversationBlock(a, [], q, newGuardState()).ok, true, a); }
});
test('scoped owner education questions select education facts instead of matching unrelated years', () => {
  const lookup = createRag(kb.chunks, buildIndex(kb.chunks)).recruiter;
  for (const q of ['Did the owner of this website graduate from Stanford in 2014?', 'Did the owner of this website study at ETH Zurich?', 'Where did the author of this website go to school?']) {
    const card = lookup.match(q)!;
    assert.deepEqual(card.sourceIds, ['fact:education']);
    assert.match(card.answer, /ETH Zurich/); assert.ok(!card.answer.includes('Stanford') && !card.answer.includes('2014'));
    assert.equal(guardConversationBlock(card.answer, [byId.get('fact:education')!], q, newGuardState()).ok, true);
  }
  assert.equal(lookup.match('What is the salary of the owner of this website?'), undefined);
  assert.equal(generalQuestion('Explain it', kb.chunks, [{ q: 'Phone number?', a: '' }]), false);
});
test('general follow-ups retain multiple useful turns within the prompt budget', () => {
  const history = [{ q: 'Explain overfitting', a: 'Training noise is memorized instead of generalized.' }, { q: 'Give a small example of it', a: 'A very deep tree memorizes the training set.' }];
  for (const q of ['Explain in more detail', 'Give another example']) {
    assert.equal(generalQuestion(q, kb.chunks, history), true);
    const prompt = buildLocalPrompt(q, kb.chunks, { history });
    assert.match(prompt, /Training noise/); assert.match(prompt, /deep tree/); assert.ok(!prompt.includes('PUBLIC EVIDENCE'));
  }
  const bounded = buildLocalPrompt('Give another example', [], { history: Array.from({ length: 20 }, () => ({ q: 'q'.repeat(700), a: 'a'.repeat(4000) })) });
  assert.ok(bounded.length / 4 <= LOCAL_PROMPT_TOKENS_MAX);
});
test('public media cards supersede an earlier general topic in device context', () => {
  const history = conversationHistory([
    { q: 'Explain overfitting', sent: true, answer: { mode: 'device', text: ['Training noise is memorized.'] } },
    { q: 'Show the AI Proctor video', answer: { mode: 'quotes', text: [], resources: registry.filter(r => r.kind === 'video' && r.project === 'ai-proctor') } },
  ], 'device');
  assert.equal(history.length, 2); assert.match(history[1].a, /Public video/);
  assert.equal(generalQuestion('Explain it', kb.chunks, history), false);
});
test('Stop releases a generator that ignores abort promptly', async () => {
  const stop = new AbortController();
  const generator: Generator = { id: 'webgpu', async *generate() { await new Promise(() => {}); } };
  const began = Date.now(); setTimeout(() => stop.abort(), 10);
  const result = await generateAnswer({ generator, question: 'Explain overfitting', prev: [], chunks: [], byId, stop: stop.signal, firstMs: 150 });
  assert.deepEqual(result, { kind: 'fallback', reason: 'stopped' }); assert.ok(Date.now() - began < 100);
});
test('aborting on a displayed block consumes a later rejected next promise', async () => {
  const stop = new AbortController();
  const source = byId.get('journey:virtamed')!;
  const result = await generateAnswer({ generator: { id: 'cloud', async *generate() {
    yield { type: 'block', text: 'Daniil works at VirtaMed in Zurich.', cites: [source.id] };
    throw new DOMException('stopped', 'AbortError');
  } }, question: 'Where does he work?', prev: [], chunks: [source], byId, stop: stop.signal, onBlock: () => stop.abort() });
  assert.equal(result.kind === 'answer' && result.stopped, true);
  await new Promise(resolve => setImmediate(resolve)); // node:test detects any unhandled rejection.
});
test('a synchronous generator startup failure returns a usable fallback', async () => {
  const generator: Generator = { id: 'webgpu', generate() { throw new Error('worker unavailable'); } };
  assert.deepEqual(await generateAnswer({ generator, question: 'Explain overfitting', prev: [], chunks: [], byId, stop: new AbortController().signal }), { kind: 'fallback', reason: 'failed' });
});
