/**
 * A stand-in for the Anthropic Messages API, for trying the Worker without a
 * key and without cost: node scripts/chat-stub.mjs [port]   (default 8788)
 *
 * It checks the request the way the real API is documented to (headers,
 * streaming, no sampling parameters, the beta header that `fallbacks` needs),
 * answers with a server-sent stream of the real shape, and pretends to cache:
 * a prefix it has seen before is reported as read from the cache. Its answers
 * are placeholders that cite the documents sharing most words with the
 * question. It proves the plumbing, not what Claude would say.
 *
 * A question containing one of these words triggers a failure:
 *   stub:529 stub:500 stub:401   that HTTP error before any output
 *   stub:midstream               an `error` event after the first block
 *   stub:cut                     the connection drops after the first block
 *   stub:refusal stub:max        those stop reasons
 *   stub:fallback                a `fallback` block before the answer
 *   stub:slow                    half a second between pieces
 *   stub:stall                   the stream starts and then says nothing more
 *
 * Also served: /chat/kb.json (the built knowledge base), /chat/bad.json (an
 * invalid one) and /__stub/requests (what was received, for the smoke test).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FAILURES = { 'stub:529': [529, 'overloaded_error'], 'stub:500': [500, 'api_error'], 'stub:401': [401, 'authentication_error'] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const words = (text) => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

/** Why the real API would answer 400, or nothing when the request is acceptable. */
function problem(request, body) {
  if (!request.headers['x-api-key'] && !request.headers.authorization) return 'no credentials';
  if (!request.headers['anthropic-version']) return 'anthropic-version header missing';
  if (typeof body.model !== 'string' || !/^claude-[a-z]+-\d(-\d)?$/.test(body.model)) return 'model: not a current model id';
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) return 'max_tokens: required';
  if (body.stream !== true) return 'the stub only streams';
  for (const key of ['temperature', 'top_p', 'top_k']) if (key in body) return `${key}: not supported on this model`;
  if (body.thinking && body.thinking.type !== 'adaptive') return 'thinking: only adaptive is accepted';
  if (body.output_config?.effort && !EFFORTS.includes(body.output_config.effort)) return 'output_config.effort: unknown level';
  if (!Array.isArray(body.messages) || body.messages.at(-1)?.role !== 'user') return 'messages: must end with a user turn';
  const beta = String(request.headers['anthropic-beta'] ?? '');
  if (body.fallbacks === 'default' && !beta.includes('server-side-fallback-2026-07-01')) return 'fallbacks: "default" needs the server-side-fallback-2026-07-01 beta';
  if (Array.isArray(body.fallbacks) && !beta.includes('server-side-fallback-2026-06-01')) return 'fallbacks: the array form needs the server-side-fallback-2026-06-01 beta';
  const content = body.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));
  const documents = content.filter((block) => block.type === 'document');
  const cited = documents.filter((block) => block.citations?.enabled).length;
  if (cited && cited !== documents.length) return 'citations: enable on all documents or none';
  if (cited && body.output_config?.format) return 'citations cannot be combined with output_config.format';
  if (content.filter((block) => block.cache_control).length > 4) return 'cache_control: at most 4 breakpoints';
  return undefined;
}

export async function startStub({ port = 0, pieceMs = 15 } = {}) {
  /** One entry per accepted or rejected /v1/messages request. */
  const requests = [];
  const cached = new Set();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://stub');
    const json = (status, value) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (url.pathname === '/__stub/requests') return json(200, requests);
    if (url.pathname === '/chat/bad.json') return json(200, { v: 2, chunks: [] });
    if (url.pathname === '/chat/kb.json') {
      const file = path.join(root, 'build/chat/kb.json');
      return existsSync(file) ? response.writeHead(200, { 'Content-Type': 'application/json' }).end(readFileSync(file)) : json(404, {});
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') return json(404, { type: 'error', error: { type: 'not_found_error', message: 'Not found' } });

    let raw = '';
    for await (const piece of request) raw += piece;
    const body = JSON.parse(raw);
    const wrong = problem(request, body);
    if (wrong) {
      requests.push({ rejected: wrong });
      return json(400, { type: 'error', error: { type: 'invalid_request_error', message: wrong } });
    }

    const content = body.messages.at(-1).content;
    const documents = content.filter((block) => block.type === 'document');
    const last = content.at(-1);
    const breakpoint = content.findLastIndex((block) => block.cache_control);
    const prefix = createHash('sha256').update(JSON.stringify([body.model, body.output_config, body.system, content.slice(0, breakpoint + 1)])).digest('hex');
    const question = /<visitor_question>\n([\s\S]*)\n<\/visitor_question>/.exec(last.text ?? '')?.[1] ?? '';
    const record = {
      model: body.model,
      max_tokens: body.max_tokens,
      effort: body.output_config?.effort,
      fallbacks: body.fallbacks,
      beta: request.headers['anthropic-beta'],
      keys: Object.keys(body).sort(),
      system: body.system,
      documents: documents.length,
      breakpoints: content.flatMap((block, index) => (block.cache_control ? index : [])),
      lastBlock: last.text,
      prefix,
      aborted: false,
      finished: false,
    };
    requests.push(record);
    response.on('close', () => (record.aborted = !record.finished));

    const failure = Object.entries(FAILURES).find(([marker]) => question.includes(marker))?.[1];
    if (failure) {
      record.finished = true;
      return json(failure[0], { type: 'error', error: { type: failure[1], message: 'Stub failure' } });
    }

    const prefixTokens = Math.ceil(JSON.stringify(content.slice(0, breakpoint + 1)).length / 4);
    const hit = cached.has(prefix);
    cached.add(prefix);
    const usage = { input_tokens: Math.ceil((last.text ?? '').length / 4), cache_read_input_tokens: hit ? prefixTokens : 0, cache_creation_input_tokens: hit ? 0 : prefixTokens, output_tokens: 1 };
    const slow = question.includes('stub:slow') ? 500 : pieceMs;
    const send = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    let index = 0;
    const block = async (type, text = '', citation) => {
      send('content_block_start', { index, content_block: type === 'text' ? { type, text: '', citations: citation ? [] : null } : type === 'thinking' ? { type, thinking: '', signature: '' } : { type, from: { model: body.model }, to: { model: 'claude-opus-4-8' } } });
      if (citation) send('content_block_delta', { index, delta: { type: 'citations_delta', citation } });
      for (const piece of text.match(/\S+\s*/g) ?? []) {
        send('content_block_delta', { index, delta: { type: 'text_delta', text: piece } });
        await sleep(slow);
      }
      send('content_block_stop', { index: index++ });
    };
    const cite = (at) => ({ type: 'content_block_location', cited_text: documents[at].source.content[0]?.text ?? '', document_index: at, document_title: documents[at].title, start_block_index: 0, end_block_index: 1 });
    const finish = (stop_reason) => {
      send('message_delta', { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 40 } });
      send('message_stop', {});
      record.finished = true;
      response.end();
    };

    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    send('message_start', { message: { id: 'msg_stub', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } });
    if (question.includes('stub:refusal')) return finish('refusal');
    // Left open until the caller gives up.
    if (question.includes('stub:stall')) return;
    await block('thinking');
    if (question.includes('stub:fallback')) await block('fallback');

    // The two documents that share most words with the question.
    const asked = words(question);
    const best = documents
      .map((document, at) => ({ at, score: [...words(`${document.title} ${document.source.content.map((part) => part.text).join(' ')}`)].filter((word) => asked.has(word)).length }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .slice(0, 2);
    if (!best.length) {
      await block('text', 'I don’t know that. The site doesn’t cover it.');
      return finish('end_turn');
    }
    await block('text', 'Daniil describes this on the site, in the passage cited here.', cite(best[0].at));
    if (question.includes('stub:midstream')) {
      record.finished = true;
      response.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`);
      return response.end();
    }
    if (question.includes('stub:cut')) {
      record.finished = true;
      // Let the block reach the client before the connection is reset.
      await sleep(100);
      return response.destroy();
    }
    if (question.includes('stub:max')) return finish('max_tokens');
    if (best[1]) await block('text', ' A second passage on the site adds more detail.', cite(best[1].at));
    finish('end_turn');
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stub = await startStub({ port: Number(process.argv[2] ?? 8788), pieceMs: 60 });
  console.log(`Anthropic stub listening on ${stub.url}`);
}
