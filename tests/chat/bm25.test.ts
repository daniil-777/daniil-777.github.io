import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { B, CONTEXT_TITLE_WEIGHT, EXPANSIONS_MAX, EXPANSION_WEIGHT, FIELD_WEIGHTS, K1, SUBJECT_TITLE_WEIGHT, buildIndex, editDistance, expand, search, tokenise } from '../../src/lib/chat/bm25.ts';
import type { Chunk } from '../../src/lib/chat/kb.ts';

const chunk = (id: string, text: string, patch: Partial<Chunk> = {}): Chunk => ({ id, kind: 'site', url: '/', title: '', heading: '', tags: [], asks: [], text, ...patch });

describe('tokenise', () => {
  it('lower-cases, strips accents and possessives', () => {
    assert.deepEqual(tokenise('Zürich’s'), ['zurich']);
    assert.deepEqual(tokenise("Alzheimer's"), tokenise('alzheimer'));
  });

  it('keeps numbers and identifiers, drops single letters', () => {
    assert.deepEqual(tokenise('C++'), []);
    assert.deepEqual(tokenise('60%'), ['60']);
    assert.deepEqual(tokenise('WO2023186262A1'), ['wo2023186262a1']);
    assert.deepEqual(tokenise('3D'), ['3d']);
    assert.deepEqual(tokenise('a 6 b'), ['6']);
  });

  it('drops function words and the words every question shares', () => {
    assert.deepEqual(tokenise('What does Daniil do in his free time?'), ['free', 'time']);
    assert.deepEqual(tokenise('Tell me about him, please'), []);
  });

  it('stems words of four letters or more', () => {
    assert.deepEqual(tokenise('publications'), ['public']);
    assert.deepEqual(tokenise('training trained trains'), ['train', 'train', 'train']);
    assert.deepEqual(tokenise('GAN gans'), ['gan', 'gan']);
  });
});

describe('BM25F on a toy corpus', () => {
  // Weighted lengths: 3, 3 and 2 (title weight 2), average 8/3.
  const chunks = [chunk('a', 'alpha beta beta'), chunk('b', 'alpha gamma delta'), chunk('c', '', { title: 'gamma' })];
  const index = buildIndex(chunks);
  const idf = (df: number) => Math.log(1 + (3 - df + 0.5) / (df + 0.5));
  const score = (i: number, wtf: number, len: number) => (i * wtf * (K1 + 1)) / (wtf + K1 * (1 - B + (B * len) / (8 / 3)));

  it('computes idf and average length', () => {
    assert.ok(Math.abs(index.avglen - 8 / 3) < 1e-6);
    assert.ok(Math.abs(index.idf.get('alpha')! - idf(2)) < 1e-12);
    assert.ok(Math.abs(index.idf.get('beta')! - idf(1)) < 1e-12);
  });

  it('scores a repeated term with saturation and length normalisation', () => {
    const { scores } = search(index, 'beta');
    assert.ok(Math.abs(scores[0] - score(idf(1), 2, 3)) < 1e-5);
    assert.equal(scores[1], 0);
    assert.equal(scores[2], 0);
  });

  it('weights a title match twice', () => {
    const { scores } = search(index, 'gamma');
    assert.ok(Math.abs(scores[1] - score(idf(2), 1, 3)) < 1e-5);
    assert.ok(Math.abs(scores[2] - score(idf(2), 2, 2)) < 1e-5);
    assert.ok(scores[2] > scores[1]);
  });

  it('sums over query terms and reports full coverage', () => {
    const result = search(index, 'alpha beta');
    assert.ok(Math.abs(result.scores[0] - (score(idf(2), 1, 3) + score(idf(1), 2, 3))) < 1e-5);
    assert.equal(result.coverage, 1);
    assert.equal(result.oov, 0);
  });

  it('counts an unknown word against coverage with the maximum idf', () => {
    const result = search(index, 'beta zzzz');
    assert.ok(Math.abs(result.coverage - idf(1) / (idf(1) + index.maxIdf)) < 1e-9);
    assert.equal(result.oov, 0.5);
    assert.equal(search(index, 'zzzz qqqq').oov, 1);
  });
});

describe('words the site does not use', () => {
  const index = buildIndex([
    chunk('a', 'pixel morph laparoscopic accuracy'),
    chunk('b', 'reinforcement learning program'),
    chunk('c', 'pixel art file fine five week part free state poster'),
    chunk('d', 'learner learners learned'),
  ]);

  it('measures edits, counting a swap of neighbours as one', () => {
    assert.equal(editDistance('pixle', 'pixel'), 1);
    assert.equal(editDistance('morph', 'morph'), 0);
    assert.equal(editDistance('lerning', 'learning'), 1);
    assert.equal(editDistance('cat', 'dog'), 3);
  });

  it('corrects a typo: one edit in a long word, two swapped letters in a short one', () => {
    assert.deepEqual(expand(index, 'pixel'), []);
    assert.deepEqual(expand(index, 'pixle'), ['pixel']);
    assert.deepEqual(expand(index, 'laproscopic'), tokenise('laparoscopic'));
    assert.deepEqual(expand(index, 'lerning'), tokenise('learning'));
    assert.deepEqual(expand(index, 'reinforcment'), tokenise('reinforcement'));
  });

  it('finds another form of the same word', () => {
    assert.deepEqual(expand(index, 'accurate'), tokenise('accuracy'));
    assert.deepEqual(expand(index, 'programme'), tokenise('program'));
  });

  it('never replaces an unknown word by a look-alike', () => {
    // Each of these used to be read as the word in brackets.
    for (const word of ['fire' /* file */, 'weak' /* week */, 'partner' /* part */, 'freelance' /* free */, 'status' /* state */, 'postcode' /* poster */, 'cat', 'pixal' /* pixel: one letter replaced in a short word */]) {
      assert.deepEqual(expand(index, word), [], word);
      assert.equal(search(index, word).oov, 1, word);
    }
  });

  it(`offers at most ${EXPANSIONS_MAX} words: other forms before typos, the more common first`, () => {
    const docs = (text: string[]) => text.map((t, i) => chunk(String(i), t));
    const many = buildIndex(docs(['zebrafish zebrawood zebar', 'zebrafish zebrawood zebar', 'zebrafish zebar', 'zebraline zebar']));
    // "zebra" begins three of the site's words and is two swapped letters away from the most common one.
    assert.deepEqual(expand(many, 'zebra'), ['zebrafish', 'zebrawood', 'zebraline'].flatMap(tokenise));
    const few = buildIndex(docs(['zebrafish zebar', 'zebar', 'zebrawood zebrawood']));
    assert.deepEqual(expand(few, 'zebra'), ['zebrafish', 'zebrawood', 'zebar'].flatMap(tokenise));
    assert.equal(EXPANSIONS_MAX, 3);
  });

  it('scores a corrected word below an exact match, and does not count it as exact', () => {
    const exact = search(index, 'pixel').scores[0];
    const typo = search(index, 'pixle');
    assert.ok(Math.abs(typo.scores[0] - EXPANSION_WEIGHT * exact) < 1e-5);
    assert.equal(typo.oov, 0);
    assert.equal(typo.terms[0].exact, false);
    assert.equal(typo.anchored, false);
  });
});

describe('field weights', () => {
  const where = (patch: Partial<Chunk>) => buildIndex([chunk('x', 'filler words here', patch), chunk('y', 'other filler text'), chunk('z', 'more text again')]);
  const wtf = (index: ReturnType<typeof buildIndex>) => index.postings.get('zebra')![0][1];

  it('weights questions 3, title and heading 2, tags 1.5 and text 1', () => {
    assert.equal(wtf(where({ asks: ['zebra'] })), FIELD_WEIGHTS.asks);
    assert.equal(wtf(where({ title: 'zebra' })), 2);
    assert.equal(wtf(where({ heading: 'zebra' })), 2);
    assert.equal(wtf(where({ tags: ['zebra'] })), 1.5);
    assert.equal(wtf(where({ text: 'zebra' })), 1);
    assert.equal(FIELD_WEIGHTS.asks, 3);
  });

  it('weights a project’s name heavily in its overview and lightly in its sections', () => {
    assert.equal(wtf(where({ kind: 'project', title: 'zebra' })), SUBJECT_TITLE_WEIGHT);
    assert.equal(wtf(where({ kind: 'section', title: 'zebra' })), CONTEXT_TITLE_WEIGHT);
    assert.equal(wtf(where({ kind: 'media', title: 'zebra' })), CONTEXT_TITLE_WEIGHT);
    assert.ok(SUBJECT_TITLE_WEIGHT > FIELD_WEIGHTS.title && CONTEXT_TITLE_WEIGHT < FIELD_WEIGHTS.text);
  });

  it('tells a word that names a chunk from a word in its running text', () => {
    const named = where({ tags: ['zebra'] });
    assert.equal(search(named, 'zebra').anchored, true);
    assert.equal(search(where({ text: 'zebra' }), 'zebra').anchored, false);
    assert.equal(search(where({ text: 'zebra crossing' }), 'zebra crossing').anchored, true);
  });
});

describe('what is indexed', () => {
  it('finds roll-ups and fixed replies by what they are about, not by their wording', () => {
    const index = buildIndex([
      chunk('rollup', 'Astro Pilot: a spacecraft', { kind: 'rollup', title: 'Projects', heading: 'In-browser AI' }),
      chunk('fact', 'A phone number is not published here.', { kind: 'fact', sensitive: true, asks: ['What is his phone number?'] }),
      chunk('plain', 'Something else entirely.'),
    ]);
    assert.equal(search(index, 'spacecraft').scores[0], 0);
    assert.ok(search(index, 'browser').scores[0] > 0);
    assert.equal(search(index, 'published').scores[1], 0);
    assert.ok(search(index, 'phone').scores[1] > 0);
  });

  it('does not index the words inside addresses', () => {
    const index = buildIndex([chunk('a', 'Code: https://github.com/someone/universal-spaceship'), chunk('b', 'Other.')]);
    assert.equal(search(index, 'spaceship').scores[0], 0);
    assert.ok(search(index, 'code').scores[0] > 0);
  });
});
