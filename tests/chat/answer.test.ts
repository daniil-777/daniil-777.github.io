import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COPY } from '../../src/data/chat.ts';
import { PASSAGE_WORDS_MAX, answerQuestion, bestSentences, followUps } from '../../src/lib/chat/answer.ts';
import { buildIndex, search } from '../../src/lib/chat/bm25.ts';
import { words } from '../../src/lib/chat/text.ts';
import { loadKb } from './load.ts';

const kb = await loadKb();
const index = buildIndex(kb.chunks);
const ask = (q: string) => answerQuestion(q, kb, index);
const byId = (id: string) => kb.chunks.find((chunk) => chunk.id === id)!;

describe('kinds of answer', () => {
  it('declined: a private topic gets the fixed reply and nothing else', () => {
    const answer = ask('What is his phone number?');
    assert.equal(answer.kind, 'declined');
    assert.equal(answer.lead, byId('fact:phone').text);
    assert.deepEqual(answer.passages.map((p) => p.chunkId), ['fact:phone']);
    assert.deepEqual(answer.followUps, []);
  });

  it('faq: a fact answers in its own words, with related passages', () => {
    const answer = ask('What are his hobbies?');
    assert.equal(answer.kind, 'faq');
    assert.equal(answer.lead, byId('fact:hobbies').text);
    assert.equal(answer.passages[0].chunkId, 'fact:hobbies');
    assert.equal(answer.passages[0].url, '/#interests-title');
    assert.ok(answer.passages.length <= 3);
    assert.ok(answer.passages.slice(1).every((p) => !p.chunkId.startsWith('fact:')));
  });

  it('list: a roll-up is shown whole, one item per line', () => {
    const answer = ask('Which projects run AI in the browser?');
    assert.equal(answer.kind, 'list');
    assert.equal(answer.lead, COPY.lead.list);
    assert.equal(answer.passages.length, 1);
    assert.ok(answer.passages[0].text.split('\n').length >= 3);
    assert.match(answer.passages[0].text, /Pixel Morph/);
  });
  it('a project list cannot silently discard an unsupported filter', () => {
    assert.notEqual(ask('Which projects run AI in the browser with FDA approval?').kind, 'list');
  });

  it('quote: passages from the site, each with a link to the sentence', () => {
    const answer = ask('How does the AI proctor warn a trainee about a mistake?');
    assert.equal(answer.kind, 'quote');
    assert.equal(answer.lead, COPY.lead.quote);
    assert.ok(answer.passages.length >= 1 && answer.passages.length <= 3);
    const first = answer.passages.find((p) => p.chunkId === 'project:ai-proctor#what-i-built')!;
    assert.match(first.text, /speaks a warning the moment it detects a mistake/);
    assert.ok(first.url.startsWith('/work/ai-proctor/#what-i-built:~:text='));
    assert.equal(first.label, 'AI Proctor · What I built');
  });

  it('closest: a weak match is worded as such', () => {
    const answer = ask('What is the weather in Zurich today?');
    assert.equal(answer.kind, 'closest');
    assert.equal(answer.lead, COPY.lead.closest);
    assert.equal(answer.confidence, 'low');
  });

  it('none: nothing matches', () => {
    const answer = ask('What is the capital of Uruguay?');
    assert.equal(answer.kind, 'none');
    assert.equal(answer.lead, COPY.lead.none);
    assert.deepEqual(answer.passages, []);
  });

  it('none, in another language: says that search is English only', () => {
    assert.equal(ask('Wo arbeitet er derzeit?').lead, COPY.lead.englishOnly);
    assert.equal(ask('Где он работает?').lead, COPY.lead.englishOnly);
  });
});

describe('precedence', () => {
  it('a trigger wins over any search result', () => {
    const answer = ask('What salary does he get for the AI Proctor project?');
    assert.equal(answer.kind, 'declined');
    assert.equal(answer.passages[0].chunkId, 'fact:salary');
  });

  it('a trigger on a fact that is not private answers as a FAQ', () => {
    const answer = ask('Tell me about his PhD thesis.');
    assert.equal(answer.kind, 'faq');
    assert.match(answer.lead, /does not mention a PhD/);
  });
});

describe('passages', () => {
  it('use at most two chunks of one page and at most 60 words each', () => {
    for (const q of ['How does Pixel Morph generate 3D objects on WebGPU?', 'What did he do at VirtaMed with computer vision?', 'Astro Pilot reinforcement learning policy']) {
      const answer = ask(q);
      const perPage = new Map<string, number>();
      for (const p of answer.passages) {
        const page = p.url.split('#')[0];
        perPage.set(page, (perPage.get(page) ?? 0) + 1);
        if (answer.kind !== 'list' && !p.chunkId.startsWith('fact:')) assert.ok(words(p.text).length <= PASSAGE_WORDS_MAX, `${p.chunkId}: ${words(p.text).length} words`);
      }
      assert.ok([...perPage.values()].every((count) => count <= 2), q);
    }
  });

  it('pick the sentence that says most about the question, and a neighbour that helps', () => {
    const text = 'The sky is blue. The model reaches an IoU of 0.91 on buildings. It was trained in PyTorch. Nothing else matters here at all today.';
    const local = buildIndex([{ id: 'a', kind: 'site', url: '/', title: '', heading: '', tags: [], asks: [], text }]);
    assert.equal(bestSentences(text, search(local, 'IoU of the buildings model').terms), 'The model reaches an IoU of 0.91 on buildings.');
    assert.equal(bestSentences(text, search(local, 'buildings PyTorch').terms), 'The model reaches an IoU of 0.91 on buildings. It was trained in PyTorch.');
    // A short best sentence takes a neighbour along even if it does not match.
    assert.equal(bestSentences(text, search(local, 'sky').terms), 'The sky is blue. The model reaches an IoU of 0.91 on buildings.');
    assert.equal(bestSentences(text, search(local, 'zebra').terms), 'The sky is blue. The model reaches an IoU of 0.91 on buildings.');
  });

  it('cut a sentence that is longer than the cap', () => {
    const long = `${Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ')}.`;
    const cut = bestSentences(long, []);
    assert.equal(words(cut).length, PASSAGE_WORDS_MAX);
    assert.ok(cut.endsWith('…'));
  });
});

describe('follow-ups', () => {
  it('lead on from the cited chunks and are never the question just asked', () => {
    const answer = ask('What is Pixel Morph?');
    assert.ok(answer.followUps.length > 0 && answer.followUps.length <= 3);
    assert.ok(answer.followUps.some((q) => q.includes('Pixel Morph')));
    assert.ok(!answer.followUps.includes('What is Pixel Morph?'));
  });

  it('are offered only if the site can answer them', () => {
    const made = { id: 'project:x', kind: 'project' as const, url: '/', title: 'Zzyzx Qwfp', heading: '', tags: [], asks: [], text: 'x' };
    const offered = followUps([made], index, []);
    assert.ok(offered.every((q) => !q.includes('Zzyzx')), offered.join(' | '));
    for (const q of offered) assert.equal(answerQuestion(q, kb, index).confidence, 'ok', q);
  });

  it('skip what was already asked', () => {
    const all = followUps([], index, []);
    assert.ok(all.length > 0);
    assert.ok(!followUps([], index, [all[0].toUpperCase()]).includes(all[0]));
  });
});
