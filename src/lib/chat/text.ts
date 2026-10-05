/**
 * Text helpers of the assistant. Pure functions: shared by the build, the
 * browser, the Worker and the tests.
 */

/**
 * Lower-cases and strips accents, so "zurich" finds "Zürich". A copy of the
 * function in src/lib/filter.ts on purpose: importing that module here would
 * make the catalogue and the chat share a chunk, one more request on every page.
 */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * The heading id Astro gives a `##` heading, as github-slugger makes it:
 * lower case, letters of any script, digits, hyphens and underscores kept,
 * every other character dropped, spaces to hyphens. Accents stay:
 * "Résumé & results" → "résumé--results".
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .trim()
    .replace(/ /g, '-');
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+/;

function inline(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Markdown to plain text. Emphasis marks and backticks go, a link keeps its
 * label, and a list item becomes a sentence of its own.
 */
export function toPlain(markdown: string): string {
  const parts: string[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.trim()) continue;
    if (LIST_ITEM.test(line)) {
      const item = inline(line.replace(LIST_ITEM, ''));
      if (item) parts.push(/[.!?:]$/.test(item) ? item : `${item}.`);
    } else {
      parts.push(inline(line));
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** A full stop after one of these does not end a sentence. */
const ABBREVIATIONS = new Set(['dr', 'prof', 'e.g', 'i.e', 'vs', 'no', 'vol']);

/**
 * Splits text into sentences: after `.`, `!` or `?` followed by whitespace and
 * a capital letter or a digit. Titles ("Prof."), initials ("C. F.") and
 * "vol. 514" stay in one piece; every line is at least one sentence.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const boundary = /[.!?]+["”’')\]]*\s+(?=[A-Z0-9])/g;
    let start = 0;
    for (let match = boundary.exec(line); match; match = boundary.exec(line)) {
      if (line[match.index] === '.') {
        const word = line.slice(start, match.index).split(/\s+/).pop() ?? '';
        if (ABBREVIATIONS.has(word.toLowerCase()) || /^[A-Z]$/.test(word)) continue;
      }
      out.push(line.slice(start, match.index + match[0].length).trim());
      start = match.index + match[0].length;
    }
    const rest = line.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}

export function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** "AI Proctor · What I built", or just the title where there is no sub-part. */
export function displayTitle(chunk: { title: string; heading: string }): string {
  return chunk.heading ? `${chunk.title} · ${chunk.heading}` : chunk.title;
}

/** Function words of German, French, Spanish and Italian that are not English words too. */
const FOREIGN = new Set(
  'der das und ist wo wie er sie nicht ein eine ich mit von auf le les est et une il elle que qui je dans avec el los una por che sono'.split(' '),
);

/**
 * Is the question in a language the keyword search cannot read? Letters
 * outside ASCII (typographic quotes and dashes aside), or two function words
 * of another European language. Gibberish is not a foreign language.
 */
export function looksForeign(question: string): boolean {
  const text = question.replace(/[’‘“”–—…]/g, '');
  if (/[^\x00-\x7f]/.test(text)) return true;
  return text.toLowerCase().split(/[^a-z]+/).filter((word) => FOREIGN.has(word)).length >= 2;
}
