/** Keep actual model source IDs; unknown IDs remain visible to the existing guard. */
import type { GenEvent } from '../chat/types.ts';

export function parseBookLocalBlock(raw: string): { text: string; cites: string[] } {
  const cites: string[] = [];
  const text = raw.replace(/\[\[([^\]\n]+)\]\]/g, (_, source: string) => {
    const id = source.trim();
    if (!cites.includes(id)) cites.push(id);
    return '';
  }).trim();
  return { text, cites };
}

/** One inscription is guarded only after its sentence and trailing IDs are complete. */
export async function* bookLocalEvents(pieces: AsyncIterable<string>): AsyncGenerator<GenEvent> {
  let text = '';
  yield { type: 'status' };
  for await (const piece of pieces) {
    text += piece;
    yield { type: 'delta', text: piece };
  }
  const block = parseBookLocalBlock(text);
  if (block.text) yield { type: 'block', ...block };
  yield { type: 'done', stop: 'end_turn' };
}
