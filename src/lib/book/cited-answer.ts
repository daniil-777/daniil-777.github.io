/** Actual local citations, after every block passes the unchanged portfolio guards. */
import { generateAnswer, type GenerateOptions, type Outcome } from '../../scripts/chat/pipeline.ts';
import type { Generator } from '../chat/types.ts';

export async function generateBookAnswer(options: GenerateOptions): Promise<Outcome> {
  const actual: string[] = [];
  const source = options.generator;
  const guarded: Generator = {
    ...source,
    async *generate(input, signal) {
      for await (const event of source.generate(input, signal)) {
        // Forward unknown IDs too: the pipeline must reject them, never silently drop them.
        if (event.type === 'block') for (const id of event.cites) if (!actual.includes(id)) actual.push(id);
        yield event;
      }
    },
  };
  const result = await generateAnswer({
    ...options, generator: guarded,
    firstMs: options.firstMs ?? 90_000, doneMs: options.doneMs ?? 90_000,
  });
  if (result.kind !== 'answer' || result.stopped || result.cutShort || result.abstained) return result;
  // A complete answer proves all emitted blocks and source IDs passed the existing guard.
  return actual.length ? { ...result, cites: actual } : result;
}
