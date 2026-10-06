import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKb } from './load.ts';
import { buildIndex } from '../../src/lib/chat/bm25.ts';
import { createRag } from '../../src/lib/chat/rag.ts';
import { buildRecruiterCards, createRecruiterLookup } from '../../src/lib/chat/recruiter.ts';
import { parseLocalBlock, splitLocalParagraphs } from '../../src/lib/chat/local-response.ts';
import { conversationHistory, generateAnswer } from '../../src/scripts/chat/pipeline.ts';
import { guardConversationBlock, newGuardState } from '../../src/lib/chat/guard.ts';
import { cleanPage, splitPage } from '../../scripts/ask-ai/documents.mjs';
import { generalQuestion, buildLocalPrompt } from '../../src/lib/chat/prompt.ts';
const kb = await loadKb(), byId = new Map(kb.chunks.map(c => [c.id, c]));

test('all recruiter answers pass their own personal source guards', () => {
  for (const card of buildRecruiterCards(kb.chunks)) {
    const state = newGuardState();
    for (const block of card.answer.split('\n\n')) assert.deepEqual(guardConversationBlock(block, card.sourceIds.map(id => byId.get(id)!), card.questions[0], state), { ok: true }, card.id);
  }
});
test('general topics do not become personal recruiter facts; assessments require all evidence', () => {
  const lookup = createRecruiterLookup(kb.chunks);
  for (const q of ['Python', 'Google', 'French', 'Explain Python decorators']) assert.equal(lookup.match(q), undefined);
  assert.equal(lookup.match('For an interview: What is his current role? Cite the sources.')?.id, 'current-role');
  const cards = buildRecruiterCards(kb.chunks.filter(c => c.id !== 'journey:virtamed'));
  assert.ok(!cards.some(c => ['leadership', 'deployment'].includes(c.id)));
});
test('comparison retrieves both projects and leadership followups preserve topic', () => {
  const rag = createRag(kb.chunks, buildIndex(kb.chunks));
  const ids = rag.retrieve('Compare AI Proctor and Ultrasound Anatomy Detection').map(c => c.id);
  assert.ok(ids.includes('project:ai-proctor') && ids.includes('project:ultrasound-anatomy-detection'));
  assert.ok(rag.retrieve('What about 100 engineers?', { q: 'Could he be a head of engineering?' }).some(c => c.id === 'journey:virtamed'));
  const detail = rag.detailed('Explain Ultrasound Anatomy Detection in detail');
  assert.ok(detail && detail.text.join(' ').includes('60%') && detail.text.length > 1);
  assert.ok(rag.detailed('Tell me more', { q: 'What is AI Proctor?', url: '/work/ai-proctor/' })?.cites.includes('project:ai-proctor'));
  assert.ok(rag.detailed('How did Daniil improve ultrasound detection performance?')?.text.join(' ').includes('60% to 90%'));
});
test('overlapping titles keep Universal AI Proctor distinct from AI Proctor', () => {
  const rag = createRag(kb.chunks, buildIndex(kb.chunks));
  assert.ok(!rag.detailed('Explain Universal AI Proctor in detail')!.cites.includes('project:ai-proctor'));
  const comparison = rag.detailed('Compare Universal AI Proctor and AI Proctor')!.cites;
  assert.ok(comparison.includes('project:ai-proctor') && comparison.includes('project:universal-ai-proctor'));
});
test('general and personal conversations use the relevant identity and history', () => {
  for (const q of ['What did you build?', 'Where do you work?', 'What did u study?', 'What university did the candidate graduate from?', 'How many patents does the applicant hold?', 'Is the candidate available to join Monday?']) assert.equal(generalQuestion(q, kb.chunks), false, q);
  assert.equal(generalQuestion('Can you explain overfitting?', kb.chunks), true);
  assert.equal(generalQuestion('Which projects run AI in the browser?', kb.chunks), false);
  const history = [{ q: 'Explain overfitting', a: 'A model memorizes training noise instead of generalizing.' }];
  assert.equal(generalQuestion('Give an example of it', kb.chunks, history), true);
  const prompt = buildLocalPrompt('Give an example of it', kb.chunks, { history });
  assert.ok(prompt.includes('training noise') && !prompt.includes('PUBLIC EVIDENCE'));
  assert.ok(!buildLocalPrompt('Explain retrieval augmented generation', kb.chunks, { history }).includes('training noise'));
  assert.equal(generalQuestion('Tell me more', kb.chunks, [{ q: 'What is his role?', a: 'VirtaMed engineer' }]), false);
});
test('citations survive split chunks and invented local sources fail closed', async () => {
  assert.deepEqual(splitLocalParagraphs('One [[fact:education]]\n\nTwo [['), { complete: ['One [[fact:education]]'], rest: 'Two [[' });
  assert.deepEqual(parseLocalBlock('Text [[fact:education]]'), { text: 'Text', cites: ['fact:education'] });
  const outcome = await generateAnswer({ generator: { id: 'webgpu', conversational: true, citesSources: true, async *generate() {
    yield { type: 'block', text: 'Daniil studied at ETH Zurich.', cites: ['fact:education'] }; yield { type: 'done', stop: 'end_turn' };
  } }, question: 'Where did he study?', prev: [], chunks: [byId.get('site:intro')!], byId, stop: new AbortController().signal });
  assert.deepEqual(outcome, { kind: 'fallback', reason: 'unverified' });
});
test('multilingual personal questions never enter unsourced general generation', () => {
  for (const q of ['Где работает Даниил?', 'Где он учился?', '¿Dónde trabaja él?', 'Qual è il suo stipendio?', 'Wo arbeitet er?', 'Quel est son emploi?', '他的工作是什么？']) assert.equal(generalQuestion(q, kb.chunks), false, q);
  for (const [q, answer] of [['Где работает Даниил?', 'Работает в Tesla с 2015 года.'], ['¿Dónde trabaja él?', 'Trabaja en Tesla desde 2015.'], ['他的工作是什么？', '他在Tesla工作。']]) assert.equal(guardConversationBlock(answer, [], q, newGuardState()).ok, false, q);
  for (const q of ['Объясни переобучение модели.', 'Explica una comprensión de listas en Python.', '解释过拟合。']) assert.equal(generalQuestion(q, kb.chunks), true, q);
});
test('an already canceled generation never starts its model', async () => {
  const stop = new AbortController(); stop.abort(); let called = false;
  const result = await generateAnswer({ generator: { id: 'webgpu', async *generate() { called = true; yield { type: 'done', stop: 'end_turn' }; } }, question: 'Explain overfitting', prev: [], chunks: [], byId, stop: stop.signal });
  assert.equal(called, false); assert.deepEqual(result, { kind: 'fallback', reason: 'stopped' });
});
test('device conversation retains deterministic public answers without private replies', () => {
  const history = conversationHistory([
    { q: 'What is his current role?', sent: false, answer: { mode: 'quotes', text: ['VirtaMed engineer'], chips: [{ url: '/#journey' }] } },
    { q: 'Phone?', sent: false, answer: { mode: 'quotes', text: ['Not public'], chips: [] } },
  ], 'device');
  assert.deepEqual(history, [{ q: 'What is his current role?', a: 'VirtaMed engineer' }]);
});
test('public extraction redacts contact data and produces bounded overlapping passages', () => {
  const cleaned = cleanPage('Research in 2020. Contact someone@university.example +41 79 555 01 23. https://private.example');
  assert.ok(!cleaned.includes('someone@') && !cleaned.includes('555') && !cleaned.includes('https://'));
  assert.ok(cleaned.includes('2020'));
  const parts = splitPage(Array.from({ length: 500 }, (_, i) => `word${i}`).join(' '));
  assert.equal(parts.length, 3); assert.ok(parts.every(part => part.split(' ').length <= 230));
  assert.ok(parts[0].includes('word205') && parts[1].startsWith('word205'));
});
test('OCR technical passages retain confidence and page provenance, excluding the patent cover', () => {
  const scanned = kb.chunks.filter(c => c.document?.method === 'ocr');
  assert.ok(scanned.length > 0);
  for (const chunk of scanned) {
    assert.ok(![1, 2, 32, 34, 36, 37].includes(chunk.document!.page) && chunk.document!.confidence! >= 0.9);
    assert.equal(chunk.document!.id, 'camera-pose-patent');
    assert.ok(chunk.url.endsWith(`#page=${chunk.document!.page}`));
  }
});
test('a documented accuracy improvement cannot be promoted into clinical validation', () => {
  const source = byId.get('project:ultrasound-anatomy-detection')!;
  const result = guardConversationBlock('Daniil’s accuracy improvement was validated through real-world deployment.', [source], 'What was his result?', newGuardState());
  assert.equal(result.ok, false);
});
