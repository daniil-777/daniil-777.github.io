import type { WatchThoughtStyle } from './types.ts';

/** Fixed dial coordinates keep complete text stable at every embedding size. */
export const PHRASE_APERTURE_PATH = 'M139 125H301Q317 125 317 141V180Q317 196 301 196H139Q123 196 123 180V141Q123 125 139 125Z';
export const PHRASE_ROWS = [138, 151, 164, 177, 190];
const RELAXED_ROWS = [141, 157, 173, 189];
/** Left to right over twelve o'clock: glyphs stay outside the indices and under the case. */
export const PHRASE_ARC_RADIUS = 178;
export const PHRASE_ARC_PATH = `M${220 - PHRASE_ARC_RADIUS} 220A${PHRASE_ARC_RADIUS} ${PHRASE_ARC_RADIUS} 0 0 1 ${220 + PHRASE_ARC_RADIUS} 220`;
export const PHRASE_ARC_LENGTH = Math.PI * PHRASE_ARC_RADIUS;
export const PHRASE_ARC_INSET = 8;

/** Conservative glyph rectangles remain inside the rounded sapphire aperture. */
export const phraseWidth = (baseline: number): number => baseline <= 141 ? 156 : 174;
export interface PhraseLayout { fontSize: number; lines: { text: string; baseline: number; width: number }[] }
export interface ArcPhraseLayout { fontSize: number; text: string; width: number }

/** Fit the complete sentence using its natural spacing, without stretching or truncation. */
export function layoutArcPhrase(sentence: string, measure: (text: string, fontSize: number) => number): ArcPhraseLayout {
  const text = sentence.trim().replace(/\s+/g, ' ');
  if (!text) throw new RangeError('The rim thought must contain a complete sentence.');
  for (let font = 13.5; font >= 8; font -= .25) {
    const width = measure(text, font);
    if (width <= PHRASE_ARC_LENGTH - PHRASE_ARC_INSET * 2) return { fontSize: font, text, width };
  }
  throw new RangeError('The complete sentence does not fit the rim; retain the previous validated thought.');
}

export function layoutPhrase(sentence: string, measure: (text: string, fontSize: number) => number): PhraseLayout {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new RangeError('The dial thought must contain a complete sentence.');
  for (let font = 14; font >= 9.5; font -= .25) {
    const rows = font > 12.5 ? RELAXED_ROWS : PHRASE_ROWS;
    let cursor = 0;
    const lines: PhraseLayout['lines'] = [];
    for (const baseline of rows) {
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

export function renderPhrase(node: SVGTextElement, sentence: string, style: WatchThoughtStyle = 'dial'): void {
  if (style === 'card') {
    node.replaceChildren(); node.dataset.watchThoughtStyle = style; return;
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Text measurement is unavailable; retain the previous thought.');
  const computed = getComputedStyle(node);
  const spacingRatio = (Number.parseFloat(computed.letterSpacing) || 0) / (Number.parseFloat(computed.fontSize) || 16);
  const measure = (text: string, font: number) => {
    context.font = `400 ${font}px ${computed.fontFamily}`;
    return context.measureText(text).width + Math.max(0, text.length - 1) * spacingRatio * font;
  };
  if (style === 'arc') {
    const pathId = node.dataset.watchArcPath;
    const guide = node.ownerSVGElement?.querySelector('[data-watch-phrase-arc-guide]');
    if (!pathId || guide?.id !== pathId) throw new Error('The rim text requires its own watch path.');
    // SVG and Canvas can shape a variable font differently. Measure on the
    // actual SVG face, invisibly, before replacing the previous valid thought.
    const probe = node.cloneNode(false) as SVGTextElement;
    probe.removeAttribute('data-watch-phrase'); probe.removeAttribute('id');
    probe.removeAttribute('x'); probe.removeAttribute('y');
    probe.style.display = 'block';
    probe.setAttribute('visibility', 'hidden'); probe.setAttribute('aria-hidden', 'true');
    const probePath = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
    probePath.setAttribute('href', `#${pathId}`); probePath.setAttribute('startOffset', '50%');
    probe.append(probePath);
    node.ownerSVGElement!.append(probe);
    let layout: ArcPhraseLayout;
    try {
      layout = layoutArcPhrase(sentence, (text, font) => {
        probePath.textContent = text; probe.setAttribute('font-size', String(font));
        return probe.getComputedTextLength();
      });
    } finally { probe.remove(); }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
    path.setAttribute('href', `#${pathId}`);
    path.setAttribute('startOffset', '50%');
    path.textContent = layout.text;
    node.setAttribute('font-size', String(layout.fontSize));
    node.removeAttribute('x'); node.removeAttribute('y');
    node.replaceChildren(path);
    node.dataset.watchThoughtStyle = style;
    return;
  }
  const layout = layoutPhrase(sentence, measure);
  node.setAttribute('font-size', String(layout.fontSize));
  node.setAttribute('x', '220'); node.setAttribute('y', '141');
  node.replaceChildren(...layout.lines.map(line => {
    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan.setAttribute('x', '220'); tspan.setAttribute('y', String(line.baseline));
    // Natural spaces preserve a complete accessible sentence in textContent.
    tspan.textContent = line.text + ' '; return tspan;
  }));
  node.dataset.watchThoughtStyle = style;
}
