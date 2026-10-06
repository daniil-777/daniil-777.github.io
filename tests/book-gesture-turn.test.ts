import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createBookPageTurn } from '../src/lib/book/page-turn.ts';

function fixture() {
  const win = new Window();
  Object.assign(globalThis, { document: win.document, getComputedStyle: win.getComputedStyle.bind(win) });
  const tracks: { currentTime: number; playbackRate: number; state: string; frames: Keyframe[]; finish(): void }[] = [];
  Object.defineProperty(win.HTMLElement.prototype, 'animate', { configurable: true, value(frames: Keyframe[], timing: KeyframeAnimationOptions) {
    let resolve!: () => void, reject!: (error: Error) => void;
    const finished = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const animation = {
      currentTime: 0, playbackRate: 1, state: 'running', frames, finished,
      pause() { this.state = 'paused'; }, play() { this.state = 'running'; },
      cancel() { this.state = 'idle'; reject(new Error('Cancelled')); },
      finish() { this.currentTime = this.playbackRate < 0 ? 0 : Number(timing.duration); this.state = 'finished'; resolve(); },
    };
    tracks.push(animation);
    return animation as unknown as Animation;
  } });
  win.document.body.innerHTML = `<div class="ai-book__spread"><div class="ai-book__page--left"><p>OLD ART</p></div><div class="ai-book__page--right"><p data-book-output>OLD INK</p></div></div>`;
  const spread = win.document.querySelector('.ai-book__spread')! as unknown as HTMLElement;
  const right = spread.querySelector<HTMLElement>('.ai-book__page--right')!;
  const leftNext = spread.querySelector('.ai-book__page--left')!.cloneNode(true) as HTMLElement;
  leftNext.querySelector('p')!.textContent = 'NEW ART';
  const rightNext = right.cloneNode(true) as HTMLElement; rightNext.querySelector('p')!.textContent = 'NEW INK';
  const helper = createBookPageTurn(spread);
  return { win, tracks, spread, right, helper, pages: { right, leftNext, rightNext }, async close() { helper.unmount(); await win.happyDOM.close(); } };
}

test('a drag seeks all connected hinges and shadow without changing real content', async () => {
  const f = fixture(); let commits = 0;
  try {
    const gesture = f.helper.begin(f.pages, () => { commits++; }, true);
    assert.equal(f.spread.querySelectorAll('.ai-book__turn-panel').length, 12);
    assert.equal(f.tracks.length, 13);
    assert.ok(f.tracks.every(track => track.state === 'paused' && track.currentTime === 0));
    gesture.progress(.4);
    assert.ok(f.tracks.every(track => track.currentTime === 360));
    f.helper.resume();
    assert.ok(f.tracks.every(track => track.state === 'paused'), 'drag progress owns the paused timeline');
    assert.equal(f.right.textContent, 'OLD INK'); assert.equal(commits, 0);
    const landing = gesture.finish(true);
    assert.ok(f.tracks.every(track => track.state === 'running' && track.playbackRate > 0));
    f.tracks.slice(0, 12).forEach(track => track.finish()); await Promise.resolve();
    assert.equal(commits, 0, 'all hinge and shadow tracks must land together');
    f.tracks[12].finish(); assert.equal(await landing, true);
    assert.equal(commits, 1); assert.equal(f.spread.querySelector('.ai-book__turn-sheet'), null);
  } finally { await f.close(); }
});

test('an incomplete drag reverses to zero and never commits incoming artwork or ink', async () => {
  const f = fixture(); let commits = 0;
  try {
    const gesture = f.helper.begin(f.pages, () => { commits++; }, true);
    gesture.progress(.6);
    const returning = gesture.finish(false);
    assert.ok(f.tracks.every(track => track.playbackRate < 0));
    f.tracks.forEach(track => track.finish());
    assert.equal(await returning, false); assert.equal(commits, 0);
    assert.equal(f.right.textContent, 'OLD INK');
    assert.equal(f.spread.dataset.bookTurning, undefined);
    assert.equal(f.spread.querySelector('.ai-book__turn-sheet'), null);
  } finally { await f.close(); }
});

test('animation-off gestures defer semantic commit until a successful release', async () => {
  const f = fixture(); let commits = 0;
  try {
    const cancelled = f.helper.begin(f.pages, () => { commits++; }, false);
    cancelled.progress(.6); assert.equal(f.tracks.length, 0);
    assert.equal(await cancelled.finish(false), false); assert.equal(commits, 0);
    const accepted = f.helper.begin(f.pages, () => { commits++; }, false);
    assert.equal(commits, 0); assert.equal(await accepted.finish(true), true); assert.equal(commits, 1);
    assert.equal(f.spread.querySelector('.ai-book__turn-sheet'), null);
  } finally { await f.close(); }
});

test('reverse curls preserve unmirrored front and back slice order', async () => {
  const f = fixture();
  try {
    const gesture = f.helper.begin({ ...f.pages, direction: 'backward' }, () => {}, true);
    const fronts = [...f.spread.querySelectorAll<HTMLElement>('.ai-book__turn-face--front > .ai-book__turn-copy')];
    const backs = [...f.spread.querySelectorAll<HTMLElement>('.ai-book__turn-face--back > .ai-book__turn-copy')];
    assert.deepEqual(fronts.map(node => node.style.left), Array.from({ length: 12 }, (_, i) => `${-100 * (11 - i)}%`));
    assert.deepEqual(backs.map(node => node.style.left), Array.from({ length: 12 }, (_, i) => `${-100 * i}%`));
    assert.ok(fronts.every(node => node.textContent === 'OLD ART'));
    assert.ok(backs.every(node => node.textContent === 'NEW INK'));
    assert.match(String(f.tracks[0].frames.at(-1)!.transform), /rotateY\(180deg\)/);
    gesture.cancel(); assert.equal(f.spread.dataset.bookTurning, undefined);
  } finally { await f.close(); }
});

test('a stale drag cannot seek, cancel or commit a replacement curl', async () => {
  const f = fixture(); let oldCommits = 0, newCommits = 0;
  try {
    const old = f.helper.begin(f.pages, () => { oldCommits++; }, true);
    old.progress(.5); const oldLanding = old.finish(true);
    const next = f.helper.begin(f.pages, () => { newCommits++; }, true);
    old.progress(.9); old.cancel();
    assert.equal(await oldLanding, false); assert.equal(await old.finish(true), false);
    assert.ok(f.tracks.slice(13).every(track => track.state === 'paused' && track.currentTime === 0));
    next.progress(1); assert.equal(newCommits, 0, 'seeking final frame is still presentation only');
    assert.equal(await next.finish(true), true); assert.equal(newCommits, 1); assert.equal(oldCommits, 0);
  } finally { await f.close(); }
});
