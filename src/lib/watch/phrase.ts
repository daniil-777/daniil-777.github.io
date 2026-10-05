/** Text is laid out in fixed SVG coordinates, so mobile resizing cannot clip it. */
export const PHRASE_ROWS = [317, 326, 335, 344];
export const phraseWidth = (baseline: number) => Math.min(194, 2 * Math.sqrt(135 ** 2 - (baseline + 2 - 220) ** 2) - 8);
export interface PhraseLayout { fontSize: number; lines: { text: string; baseline: number; width: number }[] }
export function layoutPhrase(sentence: string, measure: (text: string, fontSize: number) => number): PhraseLayout {
  const words = sentence.trim().split(/\s+/);
  for (let font = 9.5; font >= 4; font -= .25) {
    let cursor = 0;
    const lines: PhraseLayout['lines'] = [];
    for (const baseline of PHRASE_ROWS) {
      let line = '';
      const width = phraseWidth(baseline);
      while (cursor < words.length) {
        const candidate = line ? `${line} ${words[cursor]}` : words[cursor];
        if (measure(candidate, font) > width) break;
        line = candidate; cursor++;
      }
      if (line) lines.push({ text: line, baseline, width });
    }
    if (cursor === words.length) return { fontSize: font, lines };
  }
  throw new RangeError('The complete sentence does not fit the dial; retain the previous validated thought.');
}
export function renderPhrase(node: SVGTextElement, sentence: string): void {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Text measurement is unavailable; retain the previous thought.');
  const family = getComputedStyle(node).fontFamily;
  const layout = layoutPhrase(sentence, (text, font) => { context.font = `400 ${font}px ${family}`; return context.measureText(text).width; });
  node.setAttribute('font-size', String(layout.fontSize));
  node.replaceChildren(...layout.lines.map(line => {
    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan.setAttribute('x', '220'); tspan.setAttribute('y', String(line.baseline));
    // Preserve natural spaces in textContent while each line uses its own baseline.
    tspan.textContent = line.text + ' '; return tspan;
  }));
}
