import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { mountAiBook, type AiBookOptions } from '../src/lib/book/app.ts';

const sample = 'A calm thought keeps its ink while the next page is turning.';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 300 && !check(); attempt++) await tick();
  assert.ok(check(), 'the requested runtime transition happened');
}
function fixture(options: AiBookOptions = {}) {
  const win = new Window();
  Object.assign(globalThis, {
    window: win, document: win.document, HTMLElement: win.HTMLElement, MutationObserver: win.MutationObserver,
    getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator });
  const animations: { pause(): void; play(): void; cancel(): void; finish(): void; state: string }[] = [];
  Object.defineProperty(win.HTMLElement.prototype, 'animate', { configurable: true, value() {
    let resolve!: () => void, reject!: (error: Error) => void;
    const finished = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const animation = {
      state: 'running', finished,
      pause() { this.state = 'paused'; }, play() { this.state = 'running'; },
      cancel() { this.state = 'idle'; reject(new Error('Animation cancelled')); },
      finish() { this.state = 'finished'; resolve(); },
    };
    animations.push(animation);
    return animation as unknown as Animation;
  } });
  win.document.body.innerHTML = `<article data-book>
    <div class="ai-book__stage" tabindex="0"><div class="ai-book__volume"><div class="ai-book__spread">
      <div class="ai-book__page ai-book__page--left"><p>Calm art</p><span class="ai-book__page-number">01</span></div>
      <div class="ai-book__page ai-book__page--right"><div class="ai-book__writing-area"><p data-book-output>${sample}</p><span data-book-cursor></span></div><span class="ai-book__page-number">02</span></div>
      <span data-book-quill></span>
    </div></div></div><p data-book-accessible>${sample}</p><span data-book-origin></span><p data-book-status></p>
    <select data-book-topic><option value="ai">AI</option><option value="profile">About me</option></select>
    <input type="checkbox" checked data-book-animate><button data-book-generate><span data-book-generate-label></span></button>
    <button data-book-replay>Replay</button><button data-book-pause aria-pressed="false"><span data-book-pause-label></span></button>
    <button data-book-previous>Previous</button><button data-book-next>Next</button><span data-book-page-count></span>
    <div data-book-consent hidden><button data-book-download>Download</button></div><button data-book-cancel hidden>Cancel</button>
  </article>`;
  const root = win.document.querySelector('[data-book]')! as unknown as HTMLElement;
  const node = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const fetchBefore = globalThis.fetch;
  // Decorative asset failure still exercises the full transition: pages.ts
  // deliberately keeps existing artwork readable and performs a normal turn.
  globalThis.fetch = async () => { throw new Error('Offline in runtime regression'); };
  const handle = mountAiBook(root, { cycleDelayMs: 60_000, letterDelayMs: 1, ...options });
  return {
    win, root, node, animations, output: () => node('[data-book-output]').textContent,
    click: (selector: string) => node<HTMLButtonElement>(selector).click(),
    async close() { handle.unmount(); globalThis.fetch = fetchBefore; await win.happyDOM.close(); },
  };
}

test('resuming a paused page turn and then hiding preserves the outgoing inscription', async () => {
  const f = fixture();
  try {
    await until(() => f.output() === sample && f.root.dataset.bookWriting === 'false');
    f.click('[data-book-next]');
    await until(() => f.root.dataset.bookTurning === 'true' && f.animations.length === 13);
    f.click('[data-book-pause]');
    assert.ok(f.animations.every(animation => animation.state === 'paused'));
    f.click('[data-book-pause]');
    assert.ok(f.animations.every(animation => animation.state === 'running'));
    assert.equal(f.output(), sample, 'resuming the leaf does not clear its original real ink');
    f.root.hidden = true;
    f.root.dispatchEvent(new f.win.Event('ai-widget-hide') as unknown as Event);
    await tick();
    assert.equal(f.output(), sample, 'cancelled leaf returns to the unchanged outgoing page');
    assert.equal(f.root.querySelector('.ai-book__turn-sheet'), null);
  } finally { await f.close(); }
});

test('New thought turns immediately while local model preparation waits, then writes into that spread', async () => {
  let ready!: (choice: Awaited<ReturnType<NonNullable<AiBookOptions['prepareModel']>>>) => void;
  const waiting = new Promise<Awaited<ReturnType<NonNullable<AiBookOptions['prepareModel']>>>>(resolve => { ready = resolve; });
  const f = fixture({ prepareModel: () => waiting });
  try {
    await until(() => f.output() === sample);
    f.click('[data-book-generate]');
    assert.equal(f.root.dataset.bookTurning, 'true', 'the spread is reserved in the click handler');
    await until(() => f.animations.length === 13);
    assert.equal(f.output(), sample, 'the outgoing ink remains intact during the curl');
    f.animations.forEach(animation => animation.finish());
    await until(() => f.node('[data-book-page-count]').textContent === '03 — 04');
    assert.equal(f.root.dataset.bookBusy, 'true', 'the paper lands without waiting for the language model');
    const generated = 'A gentle new thought finds its home on this freshly opened page.';
    ready({ kind: 'ready', model: { label: 'Local AI', dispose() {}, generator: {
      id: 'builtin', conversational: true,
      async *generate() { yield { type: 'block', text: generated, cites: [] }; yield { type: 'done', stop: 'end_turn' }; },
    } } });
    await until(() => f.root.dataset.bookGenerated === 'true');
    assert.equal(f.node('[data-book-accessible]').textContent, generated);
    assert.equal(f.node('[data-book-page-count]').textContent, '03 — 04', 'the answer fills the reserved spread without a second curl');
    assert.equal(f.animations.length, 13);
  } finally { await f.close(); }
});

test('cancelling a pending thought and hiding the curl keeps stale output off the current page', async () => {
  let ready!: (choice: Awaited<ReturnType<NonNullable<AiBookOptions['prepareModel']>>>) => void;
  const waiting = new Promise<Awaited<ReturnType<NonNullable<AiBookOptions['prepareModel']>>>>(resolve => { ready = resolve; });
  let disposed = 0, inferred = 0;
  const f = fixture({ prepareModel: () => waiting });
  try {
    await until(() => f.output() === sample);
    f.click('[data-book-generate]');
    await until(() => f.animations.length === 13);
    f.root.hidden = true;
    f.root.dispatchEvent(new f.win.Event('ai-widget-hide') as unknown as Event);
    ready({ kind: 'ready', model: { label: 'Local AI', dispose() { disposed++; }, generator: {
      id: 'builtin', conversational: true,
      async *generate() { inferred++; yield { type: 'done', stop: 'end_turn' }; },
    } } });
    await until(() => disposed === 1);
    assert.equal(inferred, 0);
    assert.equal(f.output(), sample);
    assert.equal(f.node('[data-book-page-count]').textContent, '01 — 02');
    assert.equal(f.root.querySelector('.ai-book__turn-sheet'), null);
  } finally { await f.close(); }
});

test('switching animation off during New thought cancels its destination without replacing the outgoing page', async () => {
  let ready!: (choice: Awaited<ReturnType<NonNullable<AiBookOptions['prepareModel']>>>) => void;
  const waiting = new Promise<Awaited<ReturnType<NonNullable<AiBookOptions['prepareModel']>>>>(resolve => { ready = resolve; });
  const f = fixture({ prepareModel: () => waiting });
  try {
    await until(() => f.output() === sample);
    f.click('[data-book-generate]');
    await until(() => f.animations.length === 13);
    f.node<HTMLInputElement>('[data-book-animate]').checked = false;
    f.node('[data-book-animate]').dispatchEvent(new f.win.Event('change') as unknown as Event);
    ready({ kind: 'ready', model: { label: 'Local AI', dispose() {}, generator: {
      id: 'builtin', conversational: true,
      async *generate() { yield { type: 'block', text: 'This cancelled thought must never replace the outgoing inscription.', cites: [] }; yield { type: 'done', stop: 'end_turn' }; },
    } } });
    await until(() => f.root.dataset.bookBusy === 'false');
    assert.equal(f.output(), sample);
    assert.equal(f.root.dataset.bookGenerated, 'false');
    assert.equal(f.node('[data-book-page-count]').textContent, '01 — 02');
  } finally { await f.close(); }
});

test('repeated visible observer updates do not restart the automatic page dwell', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  let notify!: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void;
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class {
    constructor(callback: typeof notify) { notify = callback; }
    observe() {} disconnect() {}
  } });
  const f = fixture({ cycleDelayMs: 50 });
  let refresh: ReturnType<typeof setInterval> | undefined;
  try {
    notify([{ isIntersecting: true, intersectionRatio: 1 }]);
    await until(() => f.output() === sample);
    refresh = setInterval(() => notify([{ isIntersecting: true, intersectionRatio: 1 }]), 10);
    await until(() => f.root.dataset.bookTurning === 'true' && f.animations.length === 13);
    f.animations.forEach(animation => animation.finish());
    await until(() => f.node('[data-book-page-count]').textContent === '03 — 04');
  } finally {
    clearInterval(refresh);
    await f.close();
    if (before) Object.defineProperty(globalThis, 'IntersectionObserver', before);
    else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  }
});

test('focus-scoped next-arrow presses cannot supersede an already moving leaf', async () => {
  const f = fixture();
  try {
    await until(() => f.output() === sample && f.root.dataset.bookWriting === 'false');
    f.click('[data-book-next]');
    await until(() => f.root.dataset.bookTurning === 'true' && f.animations.length === 13);
    const sheet = f.root.querySelector('.ai-book__turn-sheet');
    f.node('.ai-book__stage').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }) as unknown as Event);
    await tick();
    assert.equal(f.animations.length, 13, 'no second transition is scheduled while the leaf is moving');
    assert.equal(f.root.querySelector('.ai-book__turn-sheet'), sheet, 'the existing leaf remains attached');
    f.animations.forEach(animation => animation.finish());
    await until(() => f.root.dataset.bookTurning !== 'true');
  } finally { await f.close(); }
});
