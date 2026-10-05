import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIndex } from '../../src/lib/chat/bm25.ts';
import type { Chunk } from '../../src/lib/chat/kb.ts';
import { subjectTerms, topK } from '../../src/lib/chat/retrieve.ts';
import type { GenEvent, Generator } from '../../src/lib/chat/types.ts';
import { ChatError, conversationHistory, earlier, generateAnswer, searchInContext, type Last, type Outcome } from '../../src/scripts/chat/pipeline.ts';
import { loadKb } from './load.ts';

const kb = await loadKb();
const byId = new Map(kb.chunks.map((chunk) => [chunk.id, chunk]));
const virtamed = byId.get('journey:virtamed')!;
const question = 'Where does he work?';
const faithful = 'Daniil works at VirtaMed in Zurich.';
const done = (stop = 'end_turn'): GenEvent => ({ type: 'done', stop });
const block = (text: string, cites: string[] = [virtamed.id]): GenEvent => ({ type: 'block', text, cites });

/** A generator that replays events; a function in the list runs (and may wait) before the next event. */
function replay(events: (GenEvent | ((signal: AbortSignal) => Promise<void>))[], id: Generator['id'] = 'cloud') {
  const seen: { signal?: AbortSignal } = {};
  const generator: Generator = {
    id,
    async *generate(_input, signal) {
      seen.signal = signal;
      for (const event of events) {
        if (typeof event === 'function') await event(signal);
        else yield event;
      }
    },
  };
  return { generator, seen };
}

/** Resolves only when the request is aborted, as a hanging fetch does. */
const hang = (signal: AbortSignal) =>
  new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

function run(generator: Generator, options: { stop?: AbortSignal; chunks?: Chunk[]; firstMs?: number; doneMs?: number; onBlock?: (text: string, cites: string[]) => void } = {}): Promise<Outcome> {
  return generateAnswer({
    generator,
    question,
    prev: [],
    chunks: options.chunks ?? [virtamed],
    byId,
    stop: options.stop ?? new AbortController().signal,
    onBlock: options.onBlock,
    firstMs: options.firstMs,
    doneMs: options.doneMs,
  });
}

describe('generateAnswer: what is shown', () => {
  it('only displays checked conversational paragraphs and accepts general explanations', async () => {
    const { generator } = replay([{ type: 'delta', text: 'I can help' }, block('I can help compare the role. Daniil works at VirtaMed in Zurich.'), done()]);
    generator.conversational = true;
    const shown: string[] = [];
    const outcome = await generateAnswer({ generator, question, prev: [], chunks: [virtamed], byId, stop: new AbortController().signal, onBlock: (text) => shown.push(text) });
    assert.deepEqual(shown, ['I can help compare the role. Daniil works at VirtaMed in Zurich.']);
    assert.equal(outcome.kind, 'answer');
    const general = replay([block('A transformer uses attention to relate tokens in a sequence.', []), done()]).generator;
    general.conversational = true;
    assert.equal((await run(general)).kind, 'answer');
  });
  it('never displays an unverified draft, including a rejected personal claim', async () => {
    const generator = replay([{ type: 'delta', text: 'Daniil worked at Google in 2040.' }, block('Daniil worked at Google in 2040.'), done()]).generator;
    generator.conversational = true;
    const shown: string[] = [];
    const outcome = await generateAnswer({ generator, question, prev: [], chunks: [virtamed], byId, stop: new AbortController().signal, onBlock: (text) => shown.push(text) });
    assert.deepEqual(shown, []);
    assert.deepEqual(outcome, { kind: 'fallback', reason: 'unverified' });
  });
  it('keeps only bounded successful cloud turns as conversation context', () => {
    const cloud = { q: 'Question', sent: true, answer: { mode: 'cloud', text: ['Answer'] } };
    const turns = [...Array.from({ length: 10 }, () => cloud), { ...cloud, sent: false }, { ...cloud, answer: { mode: 'quotes', text: ['Private reply'] } }];
    const history = conversationHistory(turns);
    assert.equal(history.length, 6);
    assert.ok(history.every((turn) => turn.a === 'Answer'));
  });
  it('releases a faithful, cited block and reports its sources', async () => {
    const shown: [string, string[]][] = [];
    const outcome = await run(replay([{ type: 'status' }, block(faithful), block('He has been there since 2022.'), done()]).generator, {
      onBlock: (text, cites) => shown.push([text, cites]),
    });
    assert.deepEqual(outcome, { kind: 'answer', blocks: [faithful, 'He has been there since 2022.'], cites: [virtamed.id], abstained: false, cutShort: false, stopped: false });
    // A chunk is announced once, with the block that first cites it.
    assert.deepEqual(shown, [[faithful, [virtamed.id]], ['He has been there since 2022.', []]]);
  });

  it('shows an abstention as it is, without sources', async () => {
    const outcome = await run(replay([block('I don’t know that. The site doesn’t cover it.', []), done()]).generator);
    assert.deepEqual(outcome, { kind: 'answer', blocks: ['I don’t know that. The site doesn’t cover it.'], cites: [], abstained: true, cutShort: false, stopped: false });
  });

  it('keeps an answer that ran out of tokens and marks it', async () => {
    const outcome = await run(replay([block(faithful), done('max_tokens')]).generator);
    assert.equal(outcome.kind === 'answer' && outcome.cutShort, true);
  });

  it('attaches sources by shared words when the model runs on the device', async () => {
    const other = byId.get('site:interests')!;
    const { generator } = replay([block('Daniil is a Machine Learning Research Engineer at VirtaMed in Zurich.', [virtamed.id, other.id]), done()], 'webgpu');
    const outcome = await run(generator, { chunks: [virtamed, other] });
    assert.deepEqual(outcome.kind === 'answer' && outcome.cites, [virtamed.id]);
  });
});

describe('generateAnswer: what falls back to the quotes', () => {
  const unverified = { kind: 'fallback', reason: 'unverified' };

  it('a block that cites a chunk the site does not have', async () => {
    const { generator, seen } = replay([block(faithful, ['project:made-up']), done()]);
    assert.deepEqual(await run(generator), unverified);
    assert.equal(seen.signal?.aborted, true, 'the request is aborted');
  });

  it('a block the guard rejects, even after a good one', async () => {
    const shown: string[] = [];
    const outcome = await run(replay([block(faithful), block('He joined VirtaMed in 2020.'), done()]).generator, { onBlock: (text) => shown.push(text) });
    assert.deepEqual(outcome, unverified);
    assert.deepEqual(shown, [faithful]);
  });

  it('a refusal', async () => assert.deepEqual(await run(replay([block(faithful), done('refusal')]).generator), unverified));

  it('an answer without a single citation', async () => {
    assert.deepEqual(await run(replay([block('He enjoys his work very much.', []), done()]).generator), unverified);
  });

  it('an answer on the device that shares no words with its passages', async () => {
    const { generator } = replay([block('He likes it there.', [virtamed.id]), done()], 'builtin');
    assert.deepEqual(await run(generator), unverified);
  });

  it('no first event in time', async () => {
    const { generator, seen } = replay([hang]);
    assert.deepEqual(await run(generator, { firstMs: 20 }), { kind: 'fallback', reason: 'failed' });
    assert.equal(seen.signal?.aborted, true);
  });

  it('no end in time', async () => {
    assert.deepEqual(await run(replay([{ type: 'status' }, block(faithful), hang]).generator, { doneMs: 30 }), { kind: 'fallback', reason: 'failed' });
  });

  it('no end in time although blocks keep arriving: the limit is for the whole answer', async () => {
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
    const slow = replay([block(faithful), pause, block('He is in Zurich.'), pause, block('He builds simulators.'), pause, done()]);
    assert.deepEqual(await run(slow.generator, { doneMs: 60 }), { kind: 'fallback', reason: 'failed' });
  });

  it('a stream that ends without saying it is done', async () => {
    assert.deepEqual(await run(replay([block(faithful)]).generator), { kind: 'fallback', reason: 'failed' });
  });

  it('an error, with the reason the generator gives', async () => {
    const failing = (error: Error) => replay([() => Promise.reject(error)]).generator;
    assert.deepEqual(await run(failing(new ChatError('busy'))), { kind: 'fallback', reason: 'busy' });
    assert.deepEqual(await run(failing(new ChatError('budget'))), { kind: 'fallback', reason: 'budget' });
    assert.deepEqual(await run(failing(new ChatError('device'))), { kind: 'fallback', reason: 'device' });
    assert.deepEqual(await run(failing(new TypeError('Failed to fetch'))), { kind: 'fallback', reason: 'failed' });
  });
});

describe('generateAnswer: Stop', () => {
  it('before the first block gives the quotes answer', async () => {
    const stop = new AbortController();
    const { generator, seen } = replay([{ type: 'status' }, hang]);
    const pending = run(generator, { stop: stop.signal });
    setTimeout(() => stop.abort(), 10);
    assert.deepEqual(await pending, { kind: 'fallback', reason: 'stopped' });
    assert.equal(seen.signal?.aborted, true);
  });

  it('after a block keeps what was shown', async () => {
    const stop = new AbortController();
    const pending = run(replay([block(faithful), hang]).generator, { stop: stop.signal });
    setTimeout(() => stop.abort(), 10);
    assert.deepEqual(await pending, { kind: 'answer', blocks: [faithful], cites: [virtamed.id], abstained: false, cutShort: false, stopped: true });
  });
});

describe('searchInContext', () => {
  const index = buildIndex(kb.chunks);
  const subjects = subjectTerms(kb.chunks);
  const found = (asked: string, last?: Last) => searchInContext(index, asked, last, subjects, kb.chunks);
  const first = (asked: string, last?: Last) => kb.chunks[topK(found(asked, last).result.scores, 1)[0]]?.id;
  const pixel = { q: 'What is Pixel Morph?', about: 'Pixel Morph', url: '/work/pixel-morph/' };

  it('answers a question that stands on its own the same way, whatever was asked before', () => {
    const before = { q: 'Which projects run AI in the browser?', about: 'Projects' };
    for (const asked of ['What has he published?', 'How can I contact him?', 'What are his hobbies?', 'What is his phone number?', 'Which languages does he speak?', 'And his hobbies?', 'and what has he published?']) {
      assert.equal(first(asked, before), first(asked), asked);
      assert.equal(found(asked, before).query, asked);
    }
    assert.equal(first('What has he published?', before), 'rollup:publications');
  });

  it('reads "it" as the subject of the previous answer', () => {
    assert.match(first('What is its stack?', pixel)!, /^project:pixel-morph/);
    assert.match(found('What is its stack?', pixel).query, /Pixel Morph/);
  });

  it('reads a question that opens with "and" as a continuation', () => {
    assert.equal(found('and the result?', pixel).query, 'and the result? Pixel Morph');
    assert.match(first('and the result?', pixel)!, /^project:pixel-morph/);
    assert.match(first('what about the stack?', pixel)!, /^project:pixel-morph/);
    // Without a previous answer there is nothing to continue.
    assert.equal(found('and the result?').query, 'and the result?');
  });

  it('leans on the previous question when the new one finds nothing by itself', () => {
    const before = { q: 'What is Astro Pilot?', about: 'Astro Pilot' };
    assert.match(first('And why?', before)!, /^project:astro-pilot/);
    assert.equal(found('And why?').query, 'And why?');
  });

  it('answers "and before that?" after the timeline with the whole timeline', () => {
    for (const last of [
      { q: 'Where does Daniil work right now?', about: 'What does Daniil do now?', url: '/#journey' },
      { q: 'Where did he study?', about: 'Where did Daniil study?', url: '/#journey' },
    ]) {
      for (const asked of ['and before that?', 'And earlier?', 'what came before?']) assert.equal(first(asked, last), 'rollup:journey', asked);
    }
    // After a project, "before that" has no timeline to point at.
    assert.notEqual(first('and before that?', pixel), 'rollup:journey');
  });

  it('finds nothing for "why not?" after a fixed reply', () => {
    // main.ts passes no previous turn after a declined answer.
    assert.deepEqual(topK(found('why not?').result.scores), []);
  });
});

describe('earlier questions sent with an AI answer', () => {
  it('are only those that were themselves sent', () => {
    const turns = [{ q: 'What is his phone number?' }, { q: 'a', sent: true }, { q: 'typed in quotes mode' }, { q: 'b', sent: true }, { q: 'c', sent: true }, { q: 'd', sent: true }];
    assert.deepEqual(earlier(turns), ['b', 'c', 'd']);
    assert.deepEqual(earlier([{ q: 'What is his phone number?' }, { q: 'Where does he live?', sent: false }]), []);
    assert.deepEqual(earlier(turns, 1), ['d']);
  });
});

describe('searchInContext after a detailed question', () => {
  it('carries the subject over, not the details', () => {
    const index = buildIndex(kb.chunks);
    const { query, result } = searchInContext(index, 'What is its stack?', { q: 'How fast does Pixel Morph create a 3D object from text?', about: 'Pixel Morph' }, subjectTerms(kb.chunks), kb.chunks);
    assert.equal(query, 'What is its stack?' + ' Pixel Morph');
    assert.match(kb.chunks[topK(result.scores, 1)[0]].id, /^project:pixel-morph/);
  });
});
