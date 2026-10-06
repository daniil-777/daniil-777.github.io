import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { mountAiBook } from '../src/lib/book/app.ts';
import { bookPrompt, cleanBookSentence, type BookModel, type BookModelChoice } from '../src/lib/book/model.ts';

const sample = 'There is wonder in the space between a question and its answer. A quiet mind leaves room for both.';
const generated = 'A patient hand turns the smallest task into a quiet lantern that lights the way forward.';

function page(reduced = true) {
  const win = new Window();
  Object.assign(globalThis, {
    window: win, document: win.document,
    HTMLElement: win.HTMLElement, MutationObserver: win.MutationObserver, getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  });
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  const matchMedia = win.matchMedia.bind(win);
  win.matchMedia = ((query: string) => {
    const result = matchMedia(query);
    Object.defineProperty(result, 'matches', { value: reduced && query.includes('reduced-motion') });
    return result;
  }) as typeof win.matchMedia;
  win.document.body.innerHTML = `<article data-book>
    <p data-book-output>${sample}</p><span data-book-quill></span><p data-book-accessible></p>
    <span data-book-origin></span><p data-book-status role="status"></p>
    <select data-book-topic><option value="ai">AI</option><option value="profile">About me</option><option value="wellbeing">Wellbeing</option></select>
    <button data-book-generate><span data-book-generate-label>Write with AI</span></button>
    <button data-book-replay>Replay</button><button data-book-pause><span data-book-pause-label>Pause</span></button>
    <div data-book-consent hidden><button data-book-download>Download &amp; write</button></div><button data-book-cancel hidden>Cancel</button>
  </article>`;
  const root = win.document.querySelector('[data-book]')! as unknown as HTMLElement;
  const click = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click();
  return { win, root, click };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) await tick();
  assert.ok(check(), 'state transition completed');
}
function ready(dispose = () => {}): BookModel {
  return { label: 'On-device AI', dispose, generator: {
    id: 'builtin', conversational: true,
    async *generate() { yield { type: 'block', text: generated, cites: [] }; yield { type: 'done', stop: 'end_turn' }; },
  } };
}

test('book prompts use the general LLM path and accept only one bounded, complete sentence', () => {
  assert.notEqual(bookPrompt('ai', 0), bookPrompt('ai', 1));
  assert.equal(cleanBookSentence(generated), generated);
  assert.equal(cleanBookSentence('Daniil completed the course with a documented grade of 5.75 out of six.'), 'Daniil completed the course with a documented grade of 5.75 out of six.');
  assert.equal(cleanBookSentence('This incomplete sentence has enough words but no ending'), undefined);
  assert.equal(cleanBookSentence('This is a complete sentence. This is another complete sentence.'), undefined);
  assert.equal(cleanBookSentence('a '.repeat(160) + '.'), undefined);
  assert.equal(cleanBookSentence('An inscription with <img src=x> remains unsafe markup.'), undefined);
});

test('mounting, replaying and pausing never prepare or download a model', async () => {
  const { win, root, click } = page(false);
  let prepared = 0;
  const handle = mountAiBook(root, { prepareModel: async () => { prepared++; return { kind: 'unavailable' }; } });
  click('[data-book-replay]'); click('[data-book-pause]');
  assert.equal(prepared, 0);
  assert.equal(root.dataset.bookWriting, 'false');
  assert.equal(root.querySelector('[data-book-origin]')!.textContent, 'Sample inscription');
  click('[data-book-pause]');
  assert.equal(root.dataset.bookWriting, 'true');
  handle.unmount(); await win.happyDOM.close();
});

test('an accepted generator sentence replaces the sample with accurate provenance', async () => {
  const { win, root, click } = page();
  let disposed = 0;
  const handle = mountAiBook(root, { prepareModel: async () => ({ kind: 'ready', model: ready(() => disposed++) }) });
  assert.equal(root.querySelector('[data-book-output]')!.textContent, sample);
  click('[data-book-generate]');
  await until(() => root.dataset.bookGenerated === 'true');
  assert.equal(root.querySelector('[data-book-output]')!.textContent, generated);
  assert.equal(root.querySelector('[data-book-accessible]')!.textContent, generated);
  assert.equal(root.querySelector('[data-book-origin]')!.textContent, 'Written by local AI');
  assert.equal(root.dataset.bookBusy, 'false');
  handle.unmount(); assert.equal(disposed, 1); await win.happyDOM.close();
});

test('the downloadable model loads only after Download & write is pressed', async () => {
  const { win, root, click } = page();
  let downloads = 0;
  const handle = mountAiBook(root, { prepareModel: async () => ({ kind: 'download', dispose() {}, async load() { downloads++; return ready(); } }) });
  click('[data-book-generate]');
  await until(() => !root.querySelector<HTMLElement>('[data-book-consent]')!.hidden);
  assert.equal(downloads, 0);
  assert.equal(root.querySelector<HTMLButtonElement>('[data-book-cancel]')!.hidden, false);
  click('[data-book-download]');
  await until(() => root.dataset.bookGenerated === 'true');
  assert.equal(downloads, 1);
  handle.unmount(); await win.happyDOM.close();
});

test('switching widgets aborts preparation and prevents stale output from writing', async () => {
  const { win, root, click } = page();
  let resolve!: (choice: BookModelChoice) => void;
  let signal!: AbortSignal, disposed = 0;
  const pending = new Promise<BookModelChoice>(done => { resolve = done; });
  const handle = mountAiBook(root, { prepareModel: async request => { signal = request; return pending; } });
  click('[data-book-generate]');
  root.hidden = true;
  root.dispatchEvent(new win.Event('ai-widget-hide') as unknown as Event);
  assert.equal(signal.aborted, true);
  resolve({ kind: 'ready', model: ready(() => disposed++) });
  await tick();
  assert.equal(root.dataset.bookGenerated, 'false');
  assert.equal(root.querySelector('[data-book-output]')!.textContent, sample);
  assert.equal(disposed, 1);
  handle.unmount(); await win.happyDOM.close();
});

test('the primary action becomes Stop writing and cancels a pending model request', async () => {
  const { win, root, click } = page();
  let signal!: AbortSignal;
  const handle = mountAiBook(root, { prepareModel: async request => {
    signal = request;
    return await new Promise<BookModelChoice>(resolve => request.addEventListener('abort', () => resolve({ kind: 'unavailable' }), { once: true }));
  } });
  click('[data-book-generate]');
  assert.equal(root.querySelector('[data-book-generate-label]')!.textContent, 'Stop writing');
  assert.equal(root.querySelector<HTMLButtonElement>('[data-book-generate]')!.disabled, false);
  click('[data-book-generate]');
  assert.equal(signal.aborted, true);
  await tick();
  assert.equal(root.dataset.bookBusy, 'false');
  assert.equal(root.querySelector('[data-book-generate-label]')!.textContent, 'New thought');
  assert.equal(root.dataset.bookGenerated, 'false', 'cancelled inference never becomes generated ink');
  assert.equal(root.querySelector('[data-book-output]')!.textContent, root.querySelector('[data-book-accessible]')!.textContent, 'the immediately opened reviewed page remains readable');
  handle.unmount(); await win.happyDOM.close();
});
