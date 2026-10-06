import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountAiBook, type AiBookHandle, type AiBookOptions } from '../src/lib/book/app.ts';
import { BOOK_TOPICS, bookPrompt, cleanBookSentence, defaultBookModel, prepareBookModel, type BookModelMode } from '../src/lib/book/model.ts';
import { reviewedThought } from '../src/lib/book/content.ts';
import { MODES, validateFactPack, validateSentence } from '../src/lib/watch/facts.ts';
import { generateAnswer } from '../src/scripts/chat/pipeline.ts';
import type { Chunk, Kb } from '../src/lib/chat/kb.ts';

const pack = validateFactPack(JSON.parse(await readFile(new URL('../public/watch/facts.v1.json', import.meta.url), 'utf8')));
const personal = 'Daniil builds computer vision and language-model systems that support surgical training at VirtaMed.';
const biography: Chunk = {
  id: 'journey:book-fixture', kind: 'journey', url: '/#journey', title: 'VirtaMed', heading: 'Public work',
  tags: ['Daniil', 'computer vision', 'surgical training'], asks: ['What does Daniil do at VirtaMed?'], text: personal,
};
const kb: Kb = { v: 1, hash: 'book-model-fixture', built: '2026-10-06', embedding: null, chunks: [biography] };
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 150 && !check(); attempt++) await tick();
  assert.ok(check(), message);
}

function book(t: TestContext, topic = 'ai', saved: BookModelMode = 'device') {
  const win = new Window();
  const names = ['window', 'document', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'navigator', 'localStorage', 'LanguageModel'];
  const before = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({
    window: win, document: win.document, HTMLElement: win.HTMLElement, MutationObserver: win.MutationObserver,
    getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win), navigator: win.navigator, localStorage: win.localStorage,
  })) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  win.localStorage.setItem('chat:mode:v3', saved);
  const sample = reviewedThought(topic as typeof BOOK_TOPICS[number]).text;
  // No presentation spread: these tests isolate model/content behavior from the decorative renderer.
  win.document.body.innerHTML = `<article data-book data-book-reviewed="true">
    <div class="ai-book__writing-area"><p data-book-output>${sample}</p><span data-book-cursor></span></div>
    <span data-book-quill></span><p data-book-accessible>${sample}</p><p data-book-origin></p><p data-book-status></p>
    <select data-book-topic><option value="ai">AI</option><option value="profile">About me</option><option value="wellbeing">Wellbeing</option></select>
    <span>Our local model</span>
    <input type="checkbox" data-book-animate>
    <button data-book-generate><span data-book-generate-label></span></button><button data-book-replay></button>
    <button data-book-pause><span data-book-pause-label></span></button><p data-book-model-note hidden></p>
    <p data-book-privacy></p><div data-book-sources></div><div data-book-consent hidden><button data-book-download></button><button data-book-cancel></button></div>
    <button data-book-previous></button><span data-book-page-count></span><button data-book-next></button>
  </article>`;
  const root = win.document.querySelector('[data-book]') as unknown as HTMLElement;
  root.querySelector<HTMLSelectElement>('[data-book-topic]')!.value = topic;
  const requests: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, method: init?.method ?? 'GET' });
    if (url === '/watch/facts.v1.json') return Response.json(pack);
    if (url === '/chat/kb.json') return Response.json(kb);
    throw new Error(`Unexpected network access: ${url}`);
  });
  let handle: AiBookHandle | undefined;
  t.after(async () => {
    handle?.unmount();
    for (const name of names) {
      const descriptor = before.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await win.happyDOM.close();
  });
  return {
    win, root, requests, sample,
    mount(options: AiBookOptions = {}) { handle = mountAiBook(root, options); return handle; },
    click() { root.querySelector<HTMLButtonElement>('[data-book-generate]')!.click(); },
    next() { root.querySelector<HTMLButtonElement>('[data-book-next]')!.click(); },
    previous() { root.querySelector<HTMLButtonElement>('[data-book-previous]')!.click(); },
    count: () => root.querySelector('[data-book-page-count]')!.textContent,
    text: () => root.querySelector('[data-book-output]')!.textContent,
    origin: () => root.querySelector('[data-book-origin]')!.textContent,
  };
}

test('book content uses the same watch modes and retains every reviewed source', () => {
  assert.deepEqual(BOOK_TOPICS, MODES);
  for (const mode of BOOK_TOPICS) {
    const facts = pack.facts.filter(fact => fact.mode === mode);
    for (let offset = 0; offset < facts.length; offset++) {
      const thought = reviewedThought(mode, offset, pack);
      assert.equal(thought.reviewed, true);
      assert.equal(thought.fact?.id, facts[offset].id);
      assert.equal(thought.text, facts[offset].answer);
      assert.deepEqual(thought.sources, [{ title: facts[offset].sourceTitle, url: facts[offset].sourceUrl }]);
      assert.equal(validateSentence(thought.text, [facts[offset]]), true);
    }
    const offline = reviewedThought(mode);
    assert.equal(offline.reviewed, true);
    assert.ok(offline.sources.length);
    assert.equal(cleanBookSentence(offline.text), offline.text);
  }
});

test('book prompts preserve personal grounding and accept factual decimal numbers', () => {
  assert.match(bookPrompt('profile'), /third person.*public portfolio facts.*source IDs/);
  assert.match(bookPrompt('wellbeing'), /do not make diagnoses, treatment recommendations or promises about health/);
  const decimal = 'Daniil’s ETH Zurich master’s thesis in computer vision received a grade of 5.75 out of six.';
  assert.equal(cleanBookSentence(decimal), decimal);
  assert.equal(cleanBookSentence('Daniil writes one complete sentence. This is a second sentence.'), undefined);
});

test('the book ignores a saved OpenAI preference and never prepares or posts automatically', async t => {
  const p = book(t, 'ai', 'cloud');
  let prepared = 0, generations = 0, selected: BookModelMode | undefined;
  p.mount({ prepareModel: async (_signal, mode) => {
    prepared++; selected = mode;
    return { kind: 'ready', model: { label: 'On-device AI', dispose() {}, generator: {
      id: 'builtin', conversational: true,
      async *generate() { generations++; yield { type: 'block', text: reviewedThought('ai').text, cites: [] }; yield { type: 'done', stop: 'end_turn' }; },
    } } };
  } });
  await tick();
  assert.equal(defaultBookModel(), 'device');
  assert.equal(p.win.localStorage.getItem('chat:mode:v3'), 'cloud', 'book does not change the separate Ask AI preference');
  assert.equal(p.root.querySelector('[data-book-model]'), null, 'book has no provider picker');
  assert.equal(prepared, 0);
  assert.equal(generations, 0);
  assert.ok(p.requests.every(request => request.method === 'GET'));
  p.click();
  await until(() => p.root.dataset.bookGenerated === 'true', 'explicit local generation completes');
  assert.equal(selected, 'device');
  assert.equal(prepared, 1);
  assert.equal(generations, 1);
  assert.equal(p.origin(), 'Written by local AI');
  assert.ok(p.requests.every(request => request.method === 'GET'), 'no question is posted to a service');
});

test('an unavailable local model advances to sourced reviewed content without posting a prompt', async t => {
  const p = book(t, 'wellbeing', 'quotes');
  let prepared = 0;
  p.mount({ prepareModel: async (_signal, mode) => { prepared++; assert.equal(mode, 'device'); return { kind: 'unavailable' }; } });
  await tick();
  assert.equal(defaultBookModel(), 'device');
  assert.equal(prepared, 0, 'reviewed preview does not initialize a local model');
  p.click();
  await until(() => p.text() !== p.sample, 'reviewed thought advances');
  assert.equal(prepared, 1);
  assert.equal(p.root.dataset.bookGenerated, 'false');
  assert.equal(p.origin(), 'Reviewed thought');
  const source = p.root.querySelector<HTMLAnchorElement>('[data-book-sources] a')!;
  assert.match(source.href, /^https:\/\/www\.who\.int\//);
  assert.ok(p.requests.every(request => request.method === 'GET'));
});

test('approved local profile text keeps its portfolio citation outside the animated inscription', async t => {
  const p = book(t, 'profile');
  p.mount({ prepareModel: async () => ({ kind: 'ready', model: { label: 'On-device AI', dispose() {}, generator: {
    id: 'builtin', conversational: true, citesSources: true,
    async *generate({ question, chunks }) {
      assert.match(question, /Daniil.*public portfolio facts/);
      assert.ok(chunks.some(chunk => chunk.id === biography.id));
      yield { type: 'block', text: personal, cites: [biography.id] };
      yield { type: 'done', stop: 'end_turn' };
    },
  } } }) });
  await tick(); p.click();
  await until(() => p.root.dataset.bookGenerated === 'true', 'grounded personal text is accepted');
  assert.equal(p.text(), personal);
  assert.equal(p.origin(), 'Written by local AI');
  assert.ok(!p.text()?.includes('[['), 'source markers never appear as ink');
  const source = p.root.querySelector<HTMLAnchorElement>('[data-book-sources] a')!;
  assert.equal(source.textContent, biography.title);
  assert.equal(source.getAttribute('href'), biography.url);
});

test('an explicit local model download is never started by preview or preparation', async t => {
  const p = book(t);
  let preparations = 0, downloads = 0, generations = 0;
  p.mount({ prepareModel: async (_signal, mode) => {
    preparations++; assert.equal(mode, 'device');
    return { kind: 'download', dispose() {}, async load() {
      downloads++;
      return { label: 'On-device AI', dispose() {}, generator: {
        id: 'builtin', conversational: true,
        async *generate() { generations++; yield { type: 'block', text: reviewedThought('ai').text, cites: [] }; yield { type: 'done', stop: 'end_turn' }; },
      } };
    } };
  } });
  await tick();
  assert.equal(preparations, 0);
  p.click();
  await until(() => !p.root.querySelector<HTMLElement>('[data-book-consent]')!.hidden, 'local download offer appears');
  assert.equal(preparations, 1);
  assert.equal(downloads, 0);
  assert.equal(generations, 0);
  p.root.querySelector<HTMLButtonElement>('[data-book-download]')!.click();
  await until(() => p.root.dataset.bookGenerated === 'true', 'approved local download writes');
  assert.equal(downloads, 1);
  assert.equal(generations, 1);
  assert.equal(p.origin(), 'Written by local AI');
  assert.ok(p.requests.every(request => request.method === 'GET'));
});

test('Next page generates locally in place once and retained pages do not request inference', async t => {
  const p = book(t);
  let preparations = 0, generations = 0;
  const first = reviewedThought('ai', 0).text, second = reviewedThought('ai', 1).text;
  p.mount({ prepareModel: async (_signal, mode) => {
    preparations++; assert.equal(mode, 'device');
    return { kind: 'ready', model: { label: 'On-device AI', dispose() {}, generator: {
      id: 'builtin', conversational: true,
      async *generate() { const text = generations++ === 0 ? first : second; yield { type: 'block', text, cites: [] }; yield { type: 'done', stop: 'end_turn' }; },
    } } };
  } });
  await tick(); p.click();
  await until(() => p.root.dataset.bookGenerated === 'true', 'first local thought completes');
  assert.equal(p.count(), '03 — 04');
  p.next();
  await until(() => generations === 2 && p.root.dataset.bookBusy === 'false', 'Next page completes local generation');
  assert.equal(p.count(), '05 — 06', 'generation replaces the preview on one new spread');
  assert.equal(p.text(), second);
  assert.equal(p.origin(), 'Written by local AI');
  assert.equal(preparations, 1, 'ready local model is reused');
  p.previous(); await tick();
  assert.equal(p.count(), '03 — 04');
  assert.equal(p.text(), first);
  p.next(); await tick();
  assert.equal(p.count(), '05 — 06');
  assert.equal(p.text(), second);
  assert.equal(generations, 2, 'history navigation replays its retained local outputs');
  assert.ok(p.requests.every(request => request.method === 'GET'));
});

test('even a stale cloud mode argument can only prepare and run the local model', async t => {
  const p = book(t, 'ai', 'cloud');
  let availability = 0, sessions = 0, prompts = 0, destroyed = 0;
  Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
    async availability() { availability++; return 'available'; },
    async create() {
      sessions++;
      return {
        async clone() { throw new Error('This book creates a request-scoped local session'); },
        promptStreaming(input: string) {
          prompts++; assert.match(input, /artificial intelligence/);
          return new ReadableStream<string>({ start(controller) { controller.enqueue(reviewedThought('ai').text); controller.close(); } });
        },
        destroy() { destroyed++; },
      };
    },
  } });
  const choice = await prepareBookModel(new AbortController().signal, 'cloud');
  assert.equal(choice.kind, 'ready');
  assert.equal(availability, 1);
  assert.equal(sessions, 0, 'preparation checks an already available model without beginning inference');
  assert.equal(p.requests.length, 0);
  if (choice.kind !== 'ready') return;
  assert.equal(choice.model.generator.id, 'builtin');
  const answer = await generateAnswer({ generator: choice.model.generator, question: bookPrompt('ai'), prev: [], chunks: [], byId: new Map(), locale: 'en', stop: new AbortController().signal });
  assert.equal(answer.kind, 'answer');
  assert.equal(sessions, 1);
  assert.equal(prompts, 1);
  assert.equal(destroyed, 1);
  assert.equal(p.requests.length, 0, 'local generation never creates a cloud transport or sends a question');
  choice.model.dispose();
});

test('unsupported personal output falls back to sourced reviewed content', async t => {
  const p = book(t, 'profile');
  const unsupported = 'Daniil worked at Tesla as a research engineer before joining VirtaMed.';
  p.mount({ prepareModel: async () => ({ kind: 'ready', model: { label: 'On-device AI', dispose() {}, generator: {
    id: 'builtin', conversational: true, citesSources: true,
    async *generate() { yield { type: 'block', text: unsupported, cites: [biography.id] }; yield { type: 'done', stop: 'end_turn' }; },
  } } }) });
  await tick(); p.click();
  await until(() => p.root.dataset.bookBusy === 'false' && p.text() !== p.sample, 'unsupported output falls back');
  assert.equal(p.root.dataset.bookGenerated, 'false');
  assert.equal(p.origin(), 'Reviewed thought');
  assert.notEqual(p.text(), unsupported);
  assert.match(p.root.querySelector('[data-book-model-note]')!.textContent ?? '', /reviewed thought/);
  assert.ok(p.root.querySelector('[data-book-sources] a'), 'fallback retains a real public source');
});

test('an evicted browser model cannot start a download when the next thought is requested', async t => {
  const p = book(t);
  let available = true, sessions = 0;
  Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
    availability: async () => available ? 'available' : 'downloadable',
    create: async () => { sessions++; throw new Error('An evicted model must not be created'); },
  } });
  const choice = await prepareBookModel(new AbortController().signal);
  assert.equal(choice.kind, 'ready');
  if (choice.kind !== 'ready') return;
  available = false;
  const result = await generateAnswer({ generator: choice.model.generator, question: bookPrompt('ai'), prev: [], chunks: [], byId: new Map(), locale: 'en', stop: new AbortController().signal });
  assert.equal(result.kind, 'fallback');
  assert.equal(sessions, 0);
  assert.equal(p.requests.length, 0);
  choice.model.dispose();
});
