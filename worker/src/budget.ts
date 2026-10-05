/**
 * The daily cap: one Durable Object that counts today's requests (UTC). A
 * Durable Object handles one request at a time, so two visitors arriving
 * together cannot both take the last place.
 */
import { take, type Day } from './logic.ts';

export class Budget {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /** `GET /take?limit=150` answers `{ ok }` and counts the request when there is room. */
  async fetch(request: Request): Promise<Response> {
    const limit = Number(new URL(request.url).searchParams.get('limit'));
    const result = take(await this.state.storage.get<Day>('day'), new Date().toISOString().slice(0, 10), limit);
    if (result.ok) await this.state.storage.put('day', result.next);
    return Response.json({ ok: result.ok });
  }
}
