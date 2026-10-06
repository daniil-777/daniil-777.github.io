import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { mountAiBook } from '../src/lib/book/app.ts';
const sample = 'There is wonder in the space between a question and its answer. A quiet mind leaves room for both.';
const generated = 'A patient hand turns the smallest task into a quiet lantern that lights the way forward.';
const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

async function until(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 250 && !check(); attempt++) await tick();
  assert.ok(check(), label);
}

function page({ reduced = false, animate = true } = {}) {
  const win = new Window();
  Object.assign(globalThis, {
    window: win, document: win.document,
    HTMLElement: win.HTMLElement, MutationObserver: win.MutationObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  });
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  const matchMedia = win.matchMedia.bind(win);
  win.matchMedia = (query: string) => {
    const result = matchMedia(query);
    Object.defineProperty(result, 'matches', { value: reduced && query.includes('reduced-motion') });
    return result;
  };
  win.document.body.innerHTML = `<article data-book>
    <div class="ai-book__volume"><div class="ai-book__writing-area"><p data-book-output>${sample}</p><span data-book-cursor></span></div><span data-book-quill></span></div>
    <p data-book-accessible>${sample}</p><span data-book-origin></span><p data-book-status role="status"></p>
    <select data-book-topic><option value="ai">AI</option><option value="profile">About me</option><option value="wellbeing">Wellbeing</option></select>
    <input type="checkbox" data-book-animate ${animate ? 'checked' : ''}>
    <button data-book-generate><span data-book-generate-label></span></button>
    <button data-book-replay>Replay</button><button data-book-pause aria-pressed="false"><span data-book-pause-label></span></button>
    <div data-book-consent hidden><button data-book-download>Download &amp; write</button></div><button data-book-cancel hidden>Cancel</button>
  </article>`;
  const root = win.document.querySelector('[data-book]') as unknown as HTMLElement;
  const node = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  return {
    win, root, node,
    output: () => node('[data-book-output]').textContent ?? '',
    thought: () => node('[data-book-accessible]').textContent ?? '',
    click: (selector: string) => node<HTMLButtonElement>(selector).click(),
    event: (selector: string, type: string) => node(selector).dispatchEvent(new win.Event(type, { bubbles: true }) as unknown as Event),
    widgetEvent: (type: string) => root.dispatchEvent(new win.Event(type) as unknown as Event),
  };
}

function unavailable(counter: { calls: number }) {
  return async () => { counter.calls++; return { kind: 'unavailable' as const }; };
}

test('active writing animates with reduced motion enabled and switching it off stops future previews', async () => {
  const p = page({ reduced: true, animate: true });
  const counter = { calls: 0 };
  const handle = mountAiBook(p.root, { prepareModel: unavailable(counter), letterDelayMs: 1, cycleDelayMs: 20 });
  try {
    await until(() => p.output().length > 0 && p.output().length < p.thought().length, 'ink unfolds despite the OS reduced-motion setting');
    assert.equal(p.root.dataset.bookWriting, 'true');
    p.node<HTMLInputElement>('[data-book-animate]').checked = false;
    p.event('[data-book-animate]', 'change');
    assert.equal(p.output(), p.thought(), 'disabling animation leaves a complete readable inscription');
    assert.equal(p.root.dataset.bookWriting, 'false');
    const thought = p.thought();
    await tick(120);
    assert.equal(p.thought(), thought, 'disabled animation does not rotate preview thoughts');
    assert.equal(counter.calls, 0, 'animation never prepares a local model');
  } finally { handle.unmount(); await p.win.happyDOM.close(); }
});

test('replaying paused writing resumes the ink and updates the pause control', async () => {
  const p = page();
  const handle = mountAiBook(p.root, { letterDelayMs: 1, cycleDelayMs: 60_000 });
  try {
    await until(() => p.output().length > 0 && p.output().length < p.thought().length, 'initial ink is writing');
    p.click('[data-book-pause]');
    assert.equal(p.node('[data-book-pause]').getAttribute('aria-pressed'), 'true');
    assert.equal(p.root.dataset.bookWriting, 'false');
    p.click('[data-book-replay]');
    assert.equal(p.node('[data-book-pause]').getAttribute('aria-pressed'), 'false');
    await until(() => p.output().length > 0 && p.output().length < p.thought().length, 'Replay resumes a paused inscription');
    assert.equal(p.root.dataset.bookWriting, 'true');
  } finally { handle.unmount(); await p.win.happyDOM.close(); }
});

test('returning to the book tab replays an inscription that had finished writing', async () => {
  const p = page();
  const handle = mountAiBook(p.root, { letterDelayMs: 1, cycleDelayMs: 60_000 });
  try {
    await until(() => p.output() === p.thought() && p.root.dataset.bookWriting === 'false', 'first inscription finishes');
    const completed = p.output();
    p.root.hidden = true;
    p.widgetEvent('ai-widget-hide');
    p.root.hidden = false;
    p.widgetEvent('ai-widget-show');
    await until(() => p.output().length > 0 && p.output().length < completed.length, 'tab reentry visibly replays the completed inscription');
    assert.equal(p.thought(), completed);
    assert.equal(p.root.dataset.bookWriting, 'true');
  } finally { handle.unmount(); await p.win.happyDOM.close(); }
});

test('changing a theme and requesting an offline thought each replace the sample', async () => {
  const p = page({ reduced: true, animate: false });
  const counter = { calls: 0 };
  const handle = mountAiBook(p.root, { prepareModel: unavailable(counter), letterDelayMs: 1, cycleDelayMs: 20 });
  try {
    const initial = p.output();
    p.node<HTMLSelectElement>('[data-book-topic]').value = 'profile';
    p.event('[data-book-topic]', 'change');
    await until(() => p.thought() !== initial, 'the next theme spread is prepared');
    assert.notEqual(p.thought(), initial, 'theme selection changes the sample inscription');
    assert.equal(p.output(), p.thought());
    assert.equal(counter.calls, 0, 'theme selection does not initiate a model download');
    const themed = p.thought();
    p.click('[data-book-generate]');
    await until(() => p.root.dataset.bookBusy === 'false' && p.thought() !== themed, 'an unavailable model still advances to another clearly labelled sample');
    assert.equal(counter.calls, 1);
    assert.equal(p.root.dataset.bookGenerated, 'false');
    assert.equal(p.node('[data-book-origin]').textContent, 'Reviewed thought');
  } finally { handle.unmount(); await p.win.happyDOM.close(); }
});

test('visible preview thoughts cycle without preparing a model', async () => {
  const p = page();
  const counter = { calls: 0 };
  const handle = mountAiBook(p.root, { prepareModel: unavailable(counter), letterDelayMs: 1, cycleDelayMs: 20 });
  try {
    const first = p.thought();
    await until(() => p.thought() !== first, 'a subsequent preview thought starts automatically');
    assert.equal(p.root.dataset.bookGenerated, 'false');
    assert.equal(p.node('[data-book-origin]').textContent, 'Reviewed thought');
    assert.equal(counter.calls, 0, 'automatic samples cannot trigger inference or downloads');
  } finally { handle.unmount(); await p.win.happyDOM.close(); }
});

test('pause, hiding the widget, and disposal cancel automatic previews', async () => {
  const p = page();
  const counter = { calls: 0 };
  const handle = mountAiBook(p.root, { prepareModel: unavailable(counter), letterDelayMs: 1, cycleDelayMs: 20 });
  let disposed = false;
  try {
    await until(() => p.output().length > 0, 'initial writing begins');
    p.click('[data-book-pause]');
    const paused = { thought: p.thought(), output: p.output() };
    await tick(150);
    assert.deepEqual({ thought: p.thought(), output: p.output() }, paused, 'pause freezes both ink and automatic thought selection');
    p.click('[data-book-pause]');
    await until(() => p.thought() !== paused.thought, 'unpausing allows previews to continue');
    p.root.hidden = true;
    p.widgetEvent('ai-widget-hide');
    const hidden = { thought: p.thought(), output: p.output() };
    await tick(150);
    assert.deepEqual({ thought: p.thought(), output: p.output() }, hidden, 'a hidden widget does no further writing');
    p.root.hidden = false;
    p.widgetEvent('ai-widget-show');
    await until(() => p.root.dataset.bookWriting === 'true', 'visible writing resumes');
    handle.unmount(); disposed = true;
    const unmounted = { thought: p.thought(), output: p.output() };
    await tick(150);
    assert.deepEqual({ thought: p.thought(), output: p.output() }, unmounted, 'unmount cancels ink and preview timers');
    assert.equal(counter.calls, 0);
  } finally { if (!disposed) handle.unmount(); await p.win.happyDOM.close(); }
});

test('a generated thought is replayed automatically without another inference request', async () => {
  const p = page();
  let prepares = 0, generations = 0;
  const handle = mountAiBook(p.root, {
    letterDelayMs: 1, cycleDelayMs: 20,
    prepareModel: async () => {
      prepares++;
      return { kind: 'ready', model: { label: 'On-device AI', dispose() {}, generator: {
        id: 'builtin', conversational: true,
        async *generate() { generations++; yield { type: 'block', text: generated, cites: [] }; yield { type: 'done', stop: 'end_turn' }; },
      } } };
    },
  });
  try {
    p.click('[data-book-generate]');
    await until(() => p.root.dataset.bookGenerated === 'true', 'the requested local sentence is accepted');
    assert.equal(p.thought(), generated);
    await until(() => p.output() === generated && p.root.dataset.bookWriting === 'false', 'generated ink finishes');
    await until(() => p.root.dataset.bookWriting === 'true' && p.output().length < generated.length, 'the generated inscription is replayed after its dwell time');
    assert.equal(p.thought(), generated, 'autoplay preserves the actual model output');
    assert.equal(p.node('[data-book-origin]').textContent, 'Written by local AI');
    assert.equal(prepares, 1);
    assert.equal(generations, 1, 'autoplay never spends another model request');
  } finally { handle.unmount(); await p.win.happyDOM.close(); }
});
