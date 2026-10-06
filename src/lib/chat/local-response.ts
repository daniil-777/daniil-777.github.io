/** Paragraph citations emitted by local models. Unknown IDs are preserved for the guard to reject. */
export function parseLocalBlock(raw: string): { text: string; cites: string[] } {
  const cites: string[] = [];
  const text = raw.replace(/\[\[([^\]\n]+)\]\]/g, (_, id: string) => {
    if (!cites.includes(id.trim())) cites.push(id.trim());
    return '';
  }).trim();
  return { text, cites };
}

/** An unfinished citation stays buffered with its paragraph. */
export function splitLocalParagraphs(buffer: string): { complete: string[]; rest: string } {
  const parts = buffer.split(/\n\s*\n/);
  return { complete: parts.slice(0, -1).filter(p => p.trim()), rest: parts.at(-1) ?? '' };
}
