/** Local NDJSON inference; never a provider API. */
import { localRulesFor, buildLocalPrompt } from '../../src/lib/chat/prompt.ts';
import { parseLocalBlock, splitLocalParagraphs } from '../../src/lib/chat/local-response.ts';

export const DEFAULT_LOCAL_MODEL = 'qwen3:4b-instruct';
export async function* ollamaAnswer(input, { model = DEFAULT_LOCAL_MODEL, base = 'http://127.0.0.1:11434', signal, fetcher = fetch } = {}) {
  const url = new URL(base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('Inference must be loopback-only');
  if (!/^[a-zA-Z0-9_./:-]{1,100}$/.test(model) || /cloud|https?:/i.test(model)) throw new Error('Only local model names are permitted');
  const response = await fetcher(`${base}/api/chat`, { method: 'POST', redirect: 'error', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    model, stream: true, think: false, keep_alive: '5m',
    options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 1536 },
    messages: [{ role: 'system', content: localRulesFor(input.question, input.chunks, input.history) }, { role: 'user', content: buildLocalPrompt(input.question, input.chunks, input) }],
  }) });
  if (!response.ok || !response.body) throw new Error(`Local model HTTP ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', answer = '';
  const allowed = new Set(input.chunks.map(c => c.id));
  let characters = 0;
  const checkedBlock = raw => {
    const block = parseLocalBlock(raw);
    if (block.cites.some(id => !allowed.has(id))) throw new Error('Model emitted an unknown source');
    return block;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 100_000) throw new Error('Local response too large');
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() ?? '';
      for (const line of lines.filter(line => line.trim())) {
        const data = JSON.parse(line);
        if (data.error) throw new Error('Local inference failed');
        const piece = data.message?.content;
        if (typeof piece === 'string') {
          characters += piece.length;
          if (characters > 24_000) throw new Error('Local response too large');
          answer += piece; yield { type: 'delta', text: piece };
          const parts = splitLocalParagraphs(answer);
          for (const raw of parts.complete) { const block = checkedBlock(raw); if (block.text) yield { type: 'block', ...block }; }
          answer = parts.rest;
        }
        if (data.done) {
          for (const raw of answer.split(/\n\s*\n/).filter(p => p.trim())) {
            const block = checkedBlock(raw);
            if (block.text) yield { type: 'block', ...block };
          }
          yield { type: 'done', stop: data.done_reason === 'length' ? 'max_tokens' : 'end_turn', usage: {
            in: data.prompt_eval_count ?? 0, out: data.eval_count ?? 0, cr: 0, cw: 0,
            tokensPerSecond: data.eval_duration ? data.eval_count / (data.eval_duration / 1e9) : 0,
          } };
          return;
        }
      }
      if (done) throw new Error('Local stream ended without completion');
    }
  } finally { await reader.cancel().catch(() => {}); }
}
