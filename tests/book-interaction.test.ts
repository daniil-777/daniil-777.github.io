import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { mountBookInteraction } from '../src/lib/book/interaction.ts';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function page() {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement });
  win.document.body.innerHTML = '<div data-volume><button>Replay</button><input type="checkbox"><a href="#book">Source</a><span>Paper</span></div>';
  const volume = win.document.querySelector('[data-volume]') as unknown as HTMLElement;
  volume.getBoundingClientRect = () => ({ left: 100, right: 900, top: 20, bottom: 470, width: 800, height: 450, x: 100, y: 20, toJSON() {} }) as DOMRect;
  const captures = new Set<number>();
  const released: number[] = [];
  volume.setPointerCapture = id => { captures.add(id); };
  volume.hasPointerCapture = id => captures.has(id);
  volume.releasePointerCapture = id => { captures.delete(id); released.push(id); };
  function pointer(type: string, x: number, y: number, time: number, options: { id?: number; kind?: string; primary?: boolean; button?: number; target?: HTMLElement } = {}) {
    const event = new win.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: options.id ?? 1,
      pointerType: options.kind ?? 'mouse', isPrimary: options.primary ?? true,
      button: options.button ?? 0, clientX: x, clientY: y,
    });
    Object.defineProperty(event, 'timeStamp', { value: time });
    (options.target ?? volume).dispatchEvent(event as unknown as Event);
    return event;
  }
  return { win, volume, captures, released, pointer };
}

function gesture(settle?: Promise<{ moved: boolean; newPage: boolean }>) {
  const progresses: number[] = [], finishes: boolean[] = [];
  let cancels = 0;
  const handle = {
    progress(value: number) { progresses.push(value); },
    async finish(complete: boolean) { finishes.push(complete); return settle ? await settle : { moved: complete, newPage: complete }; },
    cancel() { cancels++; },
  };
  return { handle, progresses, finishes, get cancels() { return cancels; } };
}

function mount(p: ReturnType<typeof page>, begin?: (back: boolean) => Promise<ReturnType<typeof gesture>['handle'] | undefined>) {
  const g = gesture();
  let allowed = true, starts = 0, cancels = 0;
  const directions: boolean[] = [], navigations: boolean[] = [], settlements: { moved: boolean; newPage: boolean }[] = [];
  const interaction = mountBookInteraction(p.volume, {
    allowed: () => allowed,
    start() { starts++; },
    async begin(back: boolean) { directions.push(back); return begin ? await begin(back) : g.handle; },
    navigate(back: boolean) { navigations.push(back); },
    settled(result: { moved: boolean; newPage: boolean }) { settlements.push(result); },
    cancel() { cancels++; },
  });
  return { interaction, g, directions, navigations, settlements, setAllowed(value: boolean) { allowed = value; }, get starts() { return starts; }, get cancels() { return cancels; } };
}

async function close(p: ReturnType<typeof page>, mounted: ReturnType<typeof mount>) {
  mounted.interaction.unmount();
  await p.win.happyDOM.close();
}

test('mouse drag seeks the leaf continuously and commits only on release', async () => {
  const p = page(), m = mount(p);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    const first = p.pointer('pointermove', 620, 202, 150);
    await flush();
    assert.equal(first.defaultPrevented, true);
    assert.deepEqual(m.directions, [false], 'dragging left opens the following spread');
    assert.equal(p.volume.dataset.bookDragging, 'true');
    assert.ok(p.captures.has(1));
    assert.deepEqual(m.g.finishes, [], 'seeking does not commit');
    p.pointer('pointermove', 560, 203, 300);
    assert.equal(m.g.progresses.at(-1), .35);
    p.pointer('pointerup', 560, 203, 400);
    await flush();
    assert.deepEqual(m.g.finishes, [true]);
    assert.deepEqual(m.settlements, [{ moved: true, newPage: true }]);
    assert.equal(p.volume.dataset.bookDragging, undefined);
    assert.deepEqual(p.released, [1]);
    assert.equal(m.starts, 1);
  } finally { await close(p, m); }
});

test('a primary touch drag right seeks the previous spread', async () => {
  const p = page(), m = mount(p);
  try {
    p.pointer('pointerdown', 300, 200, 0, { kind: 'touch', id: 7 });
    p.pointer('pointermove', 450, 203, 200, { kind: 'touch', id: 7 });
    await flush();
    assert.deepEqual(m.directions, [true]);
    assert.equal(m.g.progresses.at(-1), .375);
    p.pointer('pointerup', 450, 203, 350, { kind: 'touch', id: 7 });
    await flush();
    assert.deepEqual(m.g.finishes, [true]);
    assert.deepEqual(p.released, [7]);
  } finally { await close(p, m); }
});

test('a short slow drag lands back on the original spread', async () => {
  const p = page(), m = mount(p);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    p.pointer('pointermove', 640, 200, 300);
    await flush();
    assert.equal(m.g.progresses.at(-1), .15);
    p.pointer('pointerup', 640, 200, 500);
    await flush();
    assert.deepEqual(m.g.finishes, [false]);
    assert.deepEqual(m.settlements, [{ moved: false, newPage: false }]);
    assert.deepEqual(m.navigations, []);
    assert.equal(p.volume.dataset.bookDragging, undefined);
  } finally { await close(p, m); }
});

test('reversing a drag across its starting point snaps back instead of committing the wrong direction', async () => {
  const p = page(), m = mount(p);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    p.pointer('pointermove', 620, 200, 100);
    await flush();
    p.pointer('pointermove', 830, 200, 140);
    assert.equal(m.g.progresses.at(-1), 0, 'progress stays in the direction of the selected leaf');
    p.pointer('pointerup', 830, 200, 150);
    await flush();
    assert.deepEqual(m.directions, [false]);
    assert.deepEqual(m.g.finishes, [false], 'reversed velocity cannot commit the original forward leaf');
  } finally { await close(p, m); }
});

test('short edge taps navigate, while middle taps and controls keep their own behavior', async () => {
  const p = page(), m = mount(p);
  try {
    for (const x of [180, 820, 500]) {
      p.pointer('pointerdown', x, 200, 0);
      p.pointer('pointerup', x, 200, 100);
    }
    assert.deepEqual(m.navigations, [true, false]);
    for (const selector of ['button', 'input', 'a']) {
      const target = p.volume.querySelector(selector) as unknown as HTMLElement;
      p.pointer('pointerdown', 180, 200, 0, { target });
      p.pointer('pointerup', 180, 200, 100, { target });
    }
    p.pointer('pointerdown', 180, 200, 0, { button: 2 });
    p.pointer('pointerup', 180, 200, 100, { button: 2 });
    p.pointer('pointerdown', 180, 200, 0, { kind: 'touch', primary: false });
    p.pointer('pointerup', 180, 200, 100, { kind: 'touch', primary: false });
    m.setAllowed(false);
    p.pointer('pointerdown', 180, 200, 0);
    p.pointer('pointerup', 180, 200, 100);
    assert.deepEqual(m.navigations, [true, false], 'interactive elements, secondary pointers and disabled navigation do not turn pages');
    assert.equal(m.starts, 0);
    assert.deepEqual(m.directions, []);
  } finally { await close(p, m); }
});

test('release during asynchronous page preparation is applied when its gesture becomes ready', async () => {
  const p = page(), waiting = deferred<ReturnType<typeof gesture>['handle'] | undefined>(), g = gesture();
  const m = mount(p, () => waiting.promise);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    p.pointer('pointermove', 530, 200, 200);
    p.pointer('pointerup', 530, 200, 400);
    assert.deepEqual(g.finishes, [], 'an unresolved gesture cannot finish yet');
    p.pointer('pointerdown', 300, 200, 500, { id: 2 });
    p.pointer('pointermove', 450, 200, 600, { id: 2 });
    assert.equal(m.starts, 1, 'pending release prevents a second drag from taking over');
    waiting.resolve(g.handle);
    await flush();
    assert.equal(g.progresses.at(-1), .425);
    assert.deepEqual(g.finishes, [true]);
    assert.deepEqual(m.settlements, [{ moved: true, newPage: true }]);
    assert.equal(p.volume.dataset.bookDragging, undefined);
    assert.equal(p.captures.size, 0);
  } finally { await close(p, m); }
});

test('pointercancel during page preparation cancels its late handle without a late commit', async () => {
  const p = page(), waiting = deferred<ReturnType<typeof gesture>['handle'] | undefined>(), g = gesture();
  const m = mount(p, () => waiting.promise);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    p.pointer('pointermove', 530, 200, 100);
    p.pointer('pointercancel', 530, 200, 150);
    waiting.resolve(g.handle);
    await flush();
    assert.equal(g.cancels, 1);
    assert.deepEqual(g.finishes, []);
    assert.deepEqual(m.settlements, [], 'cancelled preparation must never publish a moved page');
    assert.equal(m.cancels, 1);
    assert.equal(p.volume.dataset.bookDragging, undefined);
    assert.equal(p.captures.size, 0);
  } finally { await close(p, m); }
});

test('vertical touch scrolling stays native and lost capture cancels an active leaf', async () => {
  const p = page(), m = mount(p);
  try {
    p.pointer('pointerdown', 500, 200, 0, { kind: 'touch' });
    const move = p.pointer('pointermove', 503, 236, 100, { kind: 'touch' });
    p.pointer('pointerup', 503, 260, 200, { kind: 'touch' });
    assert.equal(move.defaultPrevented, false);
    assert.equal(m.starts, 0);
    assert.equal(p.captures.size, 0);
    assert.deepEqual(m.navigations, []);
    p.pointer('pointerdown', 700, 200, 300);
    p.pointer('pointermove', 550, 200, 400);
    await flush();
    p.pointer('lostpointercapture', 550, 200, 450);
    p.pointer('pointerup', 550, 200, 500);
    await flush();
    assert.equal(m.g.cancels, 1);
    assert.deepEqual(m.g.finishes, []);
    assert.deepEqual(m.settlements, []);
    assert.equal(p.volume.dataset.bookDragging, undefined);
  } finally { await close(p, m); }
});

test('cancelling a released leaf suppresses late settlement and allows a later drag', async () => {
  const p = page(), landing = deferred<{ moved: boolean; newPage: boolean }>(), first = gesture(landing.promise), second = gesture();
  let begins = 0;
  const m = mount(p, async () => ++begins === 1 ? first.handle : second.handle);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    p.pointer('pointermove', 530, 200, 100);
    await flush();
    p.pointer('pointerup', 530, 200, 200);
    assert.deepEqual(first.finishes, [true]);
    m.interaction.cancel();
    landing.resolve({ moved: true, newPage: true });
    await flush();
    assert.deepEqual(m.settlements, [], 'cancelled landing cannot publish a late moved result');
    p.pointer('pointerdown', 700, 200, 300);
    p.pointer('pointermove', 530, 200, 400);
    await flush();
    p.pointer('pointerup', 530, 200, 500);
    await flush();
    assert.equal(begins, 2);
    assert.deepEqual(m.settlements, [{ moved: true, newPage: true }]);
  } finally { await close(p, m); }
});

test('unmount cancels pending preparation and removes pointer listeners', async () => {
  const p = page(), waiting = deferred<ReturnType<typeof gesture>['handle'] | undefined>(), g = gesture();
  const m = mount(p, () => waiting.promise);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    p.pointer('pointermove', 530, 200, 100);
    m.interaction.unmount();
    waiting.resolve(g.handle);
    await flush();
    assert.equal(g.cancels, 1);
    assert.deepEqual(g.finishes, []);
    assert.deepEqual(m.settlements, []);
    p.pointer('pointerdown', 700, 200, 200);
    p.pointer('pointermove', 530, 200, 300);
    assert.equal(m.starts, 1, 'unmounted widgets have no active pointer listeners');
    assert.equal(p.captures.size, 0);
    assert.equal(p.volume.dataset.bookDragging, undefined);
  } finally { await p.win.happyDOM.close(); }
});

test('pointer release coordinates determine final progress even when its last move was coalesced', async () => {
  const p = page(), m = mount(p);
  try {
    p.pointer('pointerdown', 700, 200, 0);
    p.pointer('pointermove', 530, 200, 200);
    await flush();
    assert.equal(m.g.progresses.at(-1), .425);
    p.pointer('pointerup', 720, 200, 600);
    await flush();
    assert.equal(m.g.progresses.at(-1), 0, 'release across the starting point returns the leaf completely');
    assert.deepEqual(m.g.finishes, [false], 'a stale high move progress cannot commit a reversed release');
    p.pointer('pointerdown', 700, 200, 700);
    p.pointer('pointermove', 660, 200, 900);
    await flush();
    p.pointer('pointerup', 500, 200, 1700);
    await flush();
    assert.equal(m.g.progresses.at(-1), .5, 'final release seeks the leaf even without a matching pointermove');
    assert.deepEqual(m.g.finishes, [false, true]);
  } finally { await close(p, m); }
});

test('transferring implicit touch capture from the ink to the volume keeps the finger attached', async () => {
  const p = page(), m = mount(p);
  try {
    const ink = p.volume.querySelector<HTMLElement>('span')!;
    p.pointer('pointerdown', 700, 200, 0, { kind: 'touch', target: ink });
    p.pointer('pointermove', 660, 200, 100, { kind: 'touch', target: ink });
    await flush();
    p.pointer('lostpointercapture', 660, 200, 110, { kind: 'touch', target: ink });
    assert.equal(m.g.cancels, 0, 'bubbled loss of the ink’s implicit capture does not cancel the volume');
    assert.equal(p.volume.dataset.bookDragging, 'true');
    p.pointer('pointermove', 500, 200, 300, { kind: 'touch' });
    p.pointer('pointerup', 500, 200, 600, { kind: 'touch' });
    await flush();
    assert.deepEqual(m.g.finishes, [true]);
    assert.equal(m.settlements.length, 1);
  } finally { await close(p, m); }
});
