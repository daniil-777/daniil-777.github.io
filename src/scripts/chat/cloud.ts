/**
 * "AI conversation": the question goes to the Worker in worker/, which calls
 * the configured provider and streams citation-bearing paragraphs. Bounded
 * prior turns supply context; the Worker owns the prompt and portfolio content.
 */
import { PROTOCOL_VERSION, parseSse } from '../../lib/chat/protocol.ts';
import type { GenEvent, Generator } from '../../lib/chat/types.ts';
import { ChatError } from './pipeline.ts';

/** Why a reply that is not a stream was refused: its status, or the code in its JSON body. */
async function refusal(response: Response): Promise<ChatError> {
  const body = (await response.json().catch(() => undefined)) as { error?: { code?: unknown } } | undefined;
  return new ChatError(body?.error?.code === 'credits' ? 'credits' : body?.error?.code === 'budget' ? 'budget' : response.status === 429 || body?.error?.code === 'rate' ? 'busy' : 'failed');
}

/** `fetcher` is replaced in the tests. */
export function createCloud(endpoint: string, fetcher: typeof fetch = fetch, timeoutMs?: number): Generator {
  return {
    id: 'cloud',
    conversational: true,
    ...(timeoutMs ? { timeoutMs } : {}),
    async *generate({ question, prev, history, locale }, signal): AsyncGenerator<GenEvent> {
      const response = await fetcher(`${endpoint.replace(/\/+$/, '')}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: PROTOCOL_VERSION, q: question, ...(prev.length ? { prev } : {}), ...(history?.length ? { history } : {}), ...(locale ? { locale } : {}) }),
        signal,
      });
      if (!response.ok || !response.body || !/^text\/event-stream/i.test(response.headers.get('Content-Type') ?? '')) throw await refusal(response);

      const parser = parseSse();
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          for (const { event, data } of done ? parser.end() : parser.push(value)) {
            if (event === 'status' || event === 'meta') yield { type: 'status' };
            else if (event === 'delta' && typeof data.t === 'string') yield { type: 'delta', text: data.t };
            else if (event === 'block' && typeof data.t === 'string' && Array.isArray(data.c)) yield { type: 'block', text: data.t, cites: data.c.map(String) };
            else if (event === 'error') throw new ChatError(data.code === 'credits' ? 'credits' : data.code === 'budget' ? 'budget' : data.code === 'overloaded' ? 'busy' : 'failed');
            else if (event === 'done') {
              yield { type: 'done', stop: String(data.stop), usage: data.usage };
              return;
            }
          }
          if (done) return;
        }
      } finally {
        // Closing the connection is what tells the Worker to stop the upstream request.
        reader.cancel().catch(() => {});
      }
    },
  };
}
