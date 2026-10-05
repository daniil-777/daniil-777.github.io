/** Stored browser data is untrusted. Restore text only and resolve resource ids anew. */
import { COPY, INPUT_MAX } from '../../data/chat.ts';
import { safeResource, type Resource } from '../../lib/chat/resources.ts';
import type { AnswerRecord, Source } from './view.ts';

export interface Turn {
  q: string;
  answer: AnswerRecord;
  about?: string;
  url?: string;
  sent?: boolean;
  at: number;
}

const text = (value: unknown, max = 24_000): value is string => typeof value === 'string' && value.length <= max;
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 30 && value.every((item) => text(item));
const optionalText = (value: unknown) => value === undefined || text(value);
const internal = (value: unknown): value is Source => {
  const source = value as Source | null;
  return !!source && typeof source.url === 'string' && source.url.startsWith('/') &&
    safeResource({ id: 'saved-source', kind: 'project', title: source.label, url: source.url });
};

export function restoreTurns(raw: string | null, resources: Resource[], max = 10): Turn[] {
  try {
    if (!raw || raw.length > 256_000) return [];
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    return saved.filter((value): value is Turn => {
      if (!value || typeof value !== 'object') return false;
      const turn = value as Turn;
      const a = turn.answer;
      return text(turn.q, INPUT_MAX) && Number.isFinite(turn.at) &&
        optionalText(turn.about) && (turn.url === undefined || internal({ label: 'Context', url: turn.url })) &&
        (turn.sent === undefined || typeof turn.sent === 'boolean') && !!a &&
        Object.hasOwn(COPY.modes, a.mode) && texts(a.text) && texts(a.followUps) && text(a.meta) &&
        [a.lead, a.notice, a.note].every(optionalText) && (a.items === undefined || texts(a.items)) &&
        (a.email === undefined || a.email === 'line' || a.email === 'closest') &&
        (a.offerSemantic === undefined || typeof a.offerSemantic === 'boolean') &&
        Array.isArray(a.passages) && a.passages.every((passage) => internal(passage) && text(passage.text)) &&
        Array.isArray(a.chips) && a.chips.every(internal);
    }).slice(-max).map((turn) => ({ ...turn, answer: { ...turn.answer,
      resources: (Array.isArray(turn.answer.resources) ? turn.answer.resources : []).flatMap((value) => {
        const id = value?.id;
        return typeof id === 'string' ? resources.find((known) => known.id === id) ?? [] : [];
      }),
    } }));
  } catch { return []; }
}
