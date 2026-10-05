/**
 * Retrieval gates: the golden questions must find their chunks with keyword
 * search alone, and every question the site must not answer is refused by rule.
 */
import assert from 'node:assert/strict';
import { conversationalFallback } from '../../src/lib/chat/resources.ts';
import { describe, it } from 'node:test';
import { COPY, SUGGESTED } from '../../src/data/chat.ts';
import { answerQuestion, composeExtractive, direct } from '../../src/lib/chat/answer.ts';
import { buildIndex, search } from '../../src/lib/chat/bm25.ts';
import { EMBED } from '../../src/lib/chat/embed.ts';
import { DENSE_CLOSEST, DENSE_WEIGHT, LOW_COVERAGE, TOP_K, confidence, contextualise, denseScores, fuse, matchTrigger, ranking, subjectTerms, topK } from '../../src/lib/chat/retrieve.ts';
import { CORRECTED, GOLDEN, HEDGED, NOT_PRIVATE, PRIVATE, UNANSWERABLE, allGolden, isHit } from './golden.ts';
import { loadKb } from './load.ts';

const kb = await loadKb();
const index = buildIndex(kb.chunks);
const golden = allGolden(kb);
const ids = new Set(kb.chunks.map((chunk) => chunk.id));
const ranked = (q: string, k = TOP_K) => topK(search(index, q).scores, k).map((i) => kb.chunks[i].id);

/** Minimum share of answerable questions that keyword search must get right. */
const GATE = { hit5: 0.85, hit3: 0.78, hit1: 0.75, ok: 0.78 };

describe('golden set', () => {
  it('has at least 100 answerable questions', () => assert.ok(golden.length >= 100, `${golden.length}`));

  it('accepts only chunks that exist', () => {
    for (const entry of golden) {
      for (const accept of entry.accept) {
        const exists = accept.endsWith('*') ? kb.chunks.some((chunk) => chunk.id.startsWith(accept.slice(0, -1))) : ids.has(accept);
        assert.ok(exists, `"${entry.q}" accepts unknown chunk ${accept}`);
      }
    }
  });

  it('asks every question once', () => assert.equal(new Set(GOLDEN.map((entry) => entry.q)).size, GOLDEN.length));
});

describe('keyword search on the golden set', () => {
  const rank = golden.map((entry) => ranked(entry.q, 10).findIndex((id) => isHit([id], entry.accept)));
  const at = (k: number) => rank.filter((r) => r >= 0 && r < k).length / golden.length;
  const mrr = rank.reduce((sum, r) => sum + (r < 0 ? 0 : 1 / (r + 1)), 0) / golden.length;
  const table = () =>
    golden
      .map((entry, i) => ({ entry, r: rank[i] }))
      .filter(({ r }) => r < 0 || r >= 3)
      .map(({ entry }) => {
        const result = search(index, entry.q);
        const top = topK(result.scores, 3).map((i) => `${kb.chunks[i].id} (${result.scores[i].toFixed(2)})`);
        return `  ${entry.q}\n    expected ${entry.accept.join(', ')}\n    got      ${top.join(', ')}`;
      })
      .join('\n');

  it(`hit@5 ≥ ${GATE.hit5}, hit@3 ≥ ${GATE.hit3} and hit@1 ≥ ${GATE.hit1}`, (t) => {
    t.diagnostic(`BM25 over ${golden.length} questions: hit@1 ${at(1).toFixed(3)}, hit@3 ${at(3).toFixed(3)}, hit@5 ${at(5).toFixed(3)}, MRR ${mrr.toFixed(3)}`);
    assert.ok(at(5) >= GATE.hit5 && at(3) >= GATE.hit3 && at(1) >= GATE.hit1, `hit@1 ${at(1).toFixed(3)}, hit@3 ${at(3).toFixed(3)}, hit@5 ${at(5).toFixed(3)}\n${table()}`);
  });

  it('supports suggested questions through conversation, resource intents or factual search', () => {
    assert.ok(conversationalFallback(SUGGESTED[0], kb.chunks)?.cites.length);
    assert.match(SUGGESTED[1], /CV/);
    assert.match(SUGGESTED[2], /videos/);
    const answer = answerQuestion(SUGGESTED[3], kb, index);
    assert.equal(answer.confidence, 'ok');
    assert.ok(isHit([answer.passages[0]?.chunkId], ['journey:virtamed', 'fact:current-role']));
  });

  it('answers every fact’s own question with that fact', () => {
    for (const chunk of kb.chunks.filter((c) => c.kind === 'fact')) {
      const answer = answerQuestion(chunk.title, kb, index);
      assert.equal(answer.passages[0]?.chunkId, chunk.id, chunk.title);
      assert.equal(answer.confidence, 'ok', chunk.title);
      assert.equal(answer.kind, chunk.sensitive ? 'declined' : 'faq', chunk.title);
    }
  });

  // A word the site never uses makes an answer "closest passages" on purpose, so this is not 100%.
  it(`answers at least ${GATE.ok * 100}% of answerable questions without hedging`, (t) => {
    const sure = golden.filter((entry) => {
      const result = search(index, entry.q);
      const first = kb.chunks[topK(result.scores, 1)[0]];
      return confidence(result) === 'ok' || (first !== undefined && direct(first, result.terms));
    });
    t.diagnostic(`confident on ${((sure.length / golden.length) * 100).toFixed(1)}% of answerable questions (LOW_COVERAGE ${LOW_COVERAGE})`);
    assert.ok(sure.length / golden.length >= GATE.ok, (sure.length / golden.length).toFixed(3));
  });

  it('answers a question that names a project with that project’s overview', () => {
    for (const title of ['Pixel Morph', 'AI Proctor', 'Astro Pilot', 'ArtPulse']) {
      const first = answerQuestion(`What is ${title}?`, kb, index).passages[0];
      assert.equal(first.label, title);
      assert.match(first.chunkId, /^project:[a-z0-9-]+$/);
    }
  });
});

describe('questions the site must not answer', () => {
  for (const { q, kinds, fact } of UNANSWERABLE) {
    it(q, () => {
      const answer = answerQuestion(q, kb, index);
      assert.ok(kinds.includes(answer.kind), `kind ${answer.kind}, first passage ${answer.passages[0]?.chunkId}`);
      if (fact) assert.equal(answer.passages[0].chunkId, fact);
      if (answer.kind === 'declined') assert.ok(!/\d/.test(answer.lead), 'a fixed reply never contains a digit');
    });
  }

  it('never calculates an age or names a referee', () => {
    assert.ok(!/\d/.test(answerQuestion('How old is he?', kb, index).lead));
    assert.equal(answerQuestion('Who are his referees?', kb, index).passages.length, 1);
  });

  it('never words passages as the answer to a question the site does not answer', () => {
    for (const q of HEDGED) {
      const reply = answerQuestion(q, kb, index);
      assert.ok(['none', 'closest', 'declined'].includes(reply.kind), `"${q}" → ${reply.kind}: ${reply.lead} ${reply.passages.map((p) => p.chunkId)}`);
    }
  });

  it('says "I don’t know" to nonsense, and "English only" to another language', () => {
    assert.equal(answerQuestion('xyzzy plugh qwertyuiop', kb, index).lead, COPY.lead.none);
    assert.equal(answerQuestion('asdfgh qwerty', kb, index).lead, COPY.lead.none);
    assert.equal(answerQuestion('Wo wohnt er und was macht er beruflich?', kb, index).lead, COPY.lead.englishOnly);
  });

  it('corrects a false premise with the fact that says what the site does list', () => {
    for (const [q, fact] of CORRECTED) {
      const reply = answerQuestion(q, kb, index);
      assert.equal(reply.kind, 'faq', q);
      assert.equal(reply.passages[0].chunkId, fact, q);
    }
    assert.match(answerQuestion('When did he work at Google?', kb, index).lead, /mentions no other employer/);
    assert.match(answerQuestion('Was the patent granted?', kb, index).lead, /does not say that a patent has been granted/);
  });

  it('answers a yes-or-no question with passages only as mentions', () => {
    const reply = answerQuestion('Has he worked with WebGPU?', kb, index);
    assert.equal(reply.kind, 'closest');
    assert.equal(reply.lead, COPY.lead.mentions);
    assert.ok(reply.passages.every((p) => /WebGPU/.test(p.text)));
  });
});

describe('a fact is the answer only to its own question', () => {
  const fact = (id: string) => kb.chunks.find((chunk) => chunk.id === id)!;
  const terms = (q: string) => search(index, q).terms;

  it('needs every word of the question in its question or asks', () => {
    assert.ok(direct(fact('fact:funding'), terms('Did he have a scholarship?')));
    assert.ok(!direct(fact('fact:funding'), terms('Was the patent granted?')));
    assert.ok(!direct(fact('fact:contact'), terms('When did he work at Tesla with Google Scholar?')));
    assert.ok(!direct(fact('fact:location'), terms('What is the weather in Zurich today?')));
    assert.ok(!direct(fact('fact:phone'), terms('What is the patent number?')));
    assert.ok(!direct(kb.chunks.find((chunk) => chunk.kind === 'journey')!, terms('VirtaMed')));
  });

  it('is never padded with another fact, and a fixed reply is never a supporting passage', () => {
    for (const { q } of golden) {
      const reply = answerQuestion(q, kb, index);
      const others = reply.passages.slice(1).map((p) => p.chunkId);
      assert.deepEqual(others.filter((id) => id.startsWith('fact:')), [], q);
    }
  });

  it('keeps a fixed reply out of the passages when the semantic tier ranks it high', () => {
    const q = 'What awards or scholarships has he received?';
    const result = search(index, q);
    // A semantic score that puts every private fact right behind the best chunk.
    const similar = Float32Array.from(kb.chunks, (chunk, i) => (chunk.sensitive ? 100 : result.scores[i] > 0 ? 101 : 0));
    const { scores, top, level } = ranking(result, similar);
    // Inject a high-ranked private candidate; this regression exercises composition regardless of corpus changes.
    const privateIndex = kb.chunks.findIndex((chunk) => chunk.sensitive);
    assert.ok(privateIndex >= 0);
    if (!top.includes(privateIndex)) top.splice(1, 0, privateIndex);
    const reply = composeExtractive(q, { top, scores, terms: result.terms, index }, level, kb);
    assert.deepEqual(reply.passages.filter((p) => fact(p.chunkId).sensitive), []);
  });
});

describe('ranking with the semantic tier', () => {
  const q = 'Any experience with forex or currency trading?';
  const result = search(index, q);
  const keywordBest = topK(result.scores, 1)[0];
  const other = kb.chunks.findIndex((_, i) => i !== keywordBest && result.scores[i] === 0);
  const similar = (value: number, at = other) => Float32Array.from(kb.chunks, (_, i) => (i === at ? value : 0));
  const cosine = (value: number) => (value * EMBED.scale) / 127;

  it('gives the semantic score the larger share of the ranking', () => {
    assert.equal(DENSE_WEIGHT, 0.7);
    assert.equal(ranking(result, similar(50)).top[0], other);
    assert.equal(ranking(result).top[0], keywordBest);
  });

  it('never makes an answer more confident than the keywords are', () => {
    assert.equal(confidence(result), 'low');
    assert.equal(ranking(result, similar(127 / EMBED.scale)).level, 'low');
    const sure = search(index, 'What is Pixel Morph?');
    assert.equal(ranking(sure, similar(400)).level, confidence(sure));
  });

  it(`shows a closest passage for a question no keyword matches, from a cosine of ${DENSE_CLOSEST}`, () => {
    const nothing = search(index, 'xyzzy plugh');
    assert.equal(DENSE_CLOSEST, 0.3);
    assert.ok(cosine(127) >= DENSE_CLOSEST && cosine(126) < DENSE_CLOSEST);
    assert.deepEqual(ranking(nothing, similar(126)), { scores: ranking(nothing, similar(126)).scores, top: [], level: 'none' });
    const shown = ranking(nothing, similar(127));
    assert.equal(shown.level, 'low');
    assert.equal(shown.top[0], other);
    assert.equal(composeExtractive('xyzzy plugh', { top: shown.top, scores: shown.scores, terms: nothing.terms, index }, shown.level, kb).kind, 'closest');
  });
});

describe('triggers', () => {
  it('match whole phrases only', () => {
    assert.equal(matchTrigger('What is Daniil’s phone number?', kb.chunks)?.id, 'fact:phone');
    assert.equal(matchTrigger('HOW OLD is he', kb.chunks)?.id, 'fact:personal');
    assert.equal(matchTrigger('What is AI Proctor?', kb.chunks), undefined);
  });

  it('catch other ways to ask for something private', () => {
    for (const [fact, questions] of Object.entries(PRIVATE)) {
      for (const q of questions) {
        const reply = answerQuestion(q, kb, index);
        assert.equal(reply.kind, 'declined', q);
        assert.equal(reply.passages[0].chunkId, fact, q);
        assert.equal(reply.passages.length, 1, q);
      }
    }
  });

  it('match word forms and one typo in a long word', () => {
    assert.equal(matchTrigger('his salaries?', kb.chunks)?.id, 'fact:salary');
    assert.equal(matchTrigger('What is his home adress', kb.chunks)?.id, 'fact:personal');
    assert.equal(matchTrigger('what is his nationalty', kb.chunks)?.id, 'fact:personal');
    // "born" is too short to be corrected into.
    assert.equal(matchTrigger('Was his idea worn out?', kb.chunks), undefined);
  });

  it('fire only for a question about Daniil, or about nothing else', () => {
    for (const q of NOT_PRIVATE) assert.equal(matchTrigger(q, kb.chunks), undefined, q);
    assert.equal(matchTrigger('salary expectation?', kb.chunks)?.id, 'fact:salary');
    assert.equal(matchTrigger('What salary does the AI Proctor project pay?', kb.chunks), undefined);
    assert.equal(matchTrigger('What salary does he get for the AI Proctor project?', kb.chunks)?.id, 'fact:salary');
  });
});

describe('ranking helpers', () => {
  it('ranks by score, keeps the order of ties, and drops zeros', () => {
    assert.deepEqual(topK(Float32Array.from([0, 2, 5, 2, 0]), 3), [2, 1, 3]);
    assert.deepEqual(topK(new Float32Array(4)), []);
  });

  it('computes dot products against int8 rows', () => {
    const scores = denseScores(Float32Array.from([1, 0.5]), Int8Array.from([10, 20, -10, 4]), 2, 2);
    assert.deepEqual([...scores], [20, -8]);
  });

  it('fuses min-max normalised scores with the dense weight', () => {
    const fused = fuse(Float32Array.from([0, 4, 2]), Float32Array.from([10, 0, 5]));
    assert.ok(Math.abs(fused[0] - DENSE_WEIGHT) < 1e-6);
    assert.ok(Math.abs(fused[1] - (1 - DENSE_WEIGHT)) < 1e-6);
    assert.ok(Math.abs(fused[2] - 0.5) < 1e-6);
    assert.deepEqual([...fuse(Float32Array.from([1, 1]), Float32Array.from([3, 3]))], [0, 0]);
  });

  it('derives confidence from coverage', () => {
    const scores = Float32Array.from([1]);
    const found = { scores, oov: 0, anchored: true };
    assert.equal(confidence({ ...found, scores: new Float32Array(2), coverage: 0 }), 'none');
    assert.equal(confidence({ ...found, coverage: LOW_COVERAGE - 0.01 }), 'low');
    assert.equal(confidence({ ...found, coverage: LOW_COVERAGE }), 'ok');
    // One word the site never uses, or a lone word found somewhere in a text, is not an answer.
    assert.equal(confidence({ ...found, coverage: 0.9, oov: 0.2 }), 'low');
    assert.equal(confidence({ ...found, coverage: 1, anchored: false }), 'low');
  });
});

describe('follow-up questions', () => {
  const subjects = subjectTerms(kb.chunks);
  const history = { previousQuestion: 'What is Pixel Morph?', lastCitedTitle: 'Pixel Morph' };

  it('borrow the subject of the previous question', () => {
    const query = contextualise('What was its result?', history, subjects);
    assert.match(query, /Pixel Morph/);
    assert.ok(ranked(query)[0].startsWith('project:pixel-morph'), ranked(query)[0]);
    assert.match(contextualise('And the stack?', history, subjects), /Pixel Morph/);
  });

  it('leave a question that names its own subject alone', () => {
    const q = 'How does the Astro Pilot spaceship learn to fly?';
    assert.equal(contextualise(q, history, subjects), q);
    assert.equal(contextualise('What is its stack in Astro Pilot?', history, subjects), 'What is its stack in Astro Pilot?');
    assert.equal(contextualise('Why?', {}, subjects), 'Why?');
  });
});
