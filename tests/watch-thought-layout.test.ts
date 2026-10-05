import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutArcPhrase, layoutPhrase, renderPhrase, PHRASE_ARC_INSET, PHRASE_ARC_LENGTH, PHRASE_ARC_RADIUS } from '../src/lib/watch/phrase.ts';

test('rim layout keeps the whole sentence and natural spacing at the largest fitting size', () => {
  const sentence = '  A useful thought\n follows the upper rim with complete words and accurate spacing.  ';
  const natural = sentence.trim().replace(/\s+/g, ' ');
  const available = PHRASE_ARC_LENGTH - 2 * PHRASE_ARC_INSET;
  const measure = (text: string, font: number) => text.length * font * .58;
  const result = layoutArcPhrase(sentence, measure);
  assert.equal(result.text, natural);
  assert.equal(result.width, measure(natural, result.fontSize));
  assert.ok(result.width <= available);
  assert.ok(result.fontSize === 13.5 || measure(natural, result.fontSize + .25) > available);
  assert.equal(PHRASE_ARC_LENGTH, Math.PI * PHRASE_ARC_RADIUS);
});

test('rim layout refuses blank or overlong answers rather than cutting off their last words', () => {
  assert.throws(() => layoutArcPhrase(' \n ', () => 0), RangeError);
  assert.throws(() => layoutArcPhrase('A complete thought that cannot fit.', () => PHRASE_ARC_LENGTH), RangeError);
});

test('switchable inner layout still carries the full answer within the upper half', () => {
  const sentence = 'The alternative layout keeps every word visible while returning the thought to the upper dial.';
  const result = layoutPhrase(sentence, (text, font) => text.length * font * .5);
  assert.equal(result.lines.map(line => line.text).join(' '), sentence);
  assert.ok(result.lines.every(line => line.baseline < 220));
  assert.throws(() => layoutPhrase('Thiswordcannotfit', () => 1000), RangeError);
});


test('the layered and companion faces keep their full answer in the HTML layer above the hands', () => {
  for (const style of ['card', 'layered', 'marquee'] as const) {
    let removed = false;
    const node = { replaceChildren() { removed = true; }, dataset: {} } as unknown as SVGTextElement;
    renderPhrase(node, 'The complete thought belongs above the moving analogue hands.', style);
    assert.equal(removed, true);
    assert.equal(node.dataset.watchThoughtStyle, style);
  }
});
