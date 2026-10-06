/** What every model-backed answer mode implements: the cloud endpoint and the two on-device tiers. */
import type { Chunk } from './kb.ts';
import type { HistoryTurn } from './protocol.ts';
import type { Locale } from '../../i18n/core.ts';

export type GenEvent =
  | { type: 'status' }
  | { type: 'delta'; text: string }
  /** One finished block of text and the ids of the chunks it cites. */
  | { type: 'block'; text: string; cites: string[] }
  | { type: 'done'; stop: string; usage?: object };

export interface Generator {
  id: 'cloud' | 'builtin' | 'webgpu';
  /** Hosted conversational answers can explain general concepts as well as cite personal facts. */
  conversational?: boolean;
  /** Emits actual source IDs instead of relying on word-overlap attribution. */
  citesSources?: boolean;
  timeoutMs?: number;
  generate(input: { question: string; prev: string[]; history?: HistoryTurn[]; chunks: Chunk[]; locale?: Locale }, signal: AbortSignal): AsyncIterable<GenEvent>;
}
