import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createBookPageTurn, type TurnPages } from '../src/lib/book/page-turn.ts';

type RecordedAnimation = {
  target: HTMLElement;
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
  state: 'running' | 'paused' | 'finished' | 'idle';
  pauses: number;
  plays: number;
  cancellations: number;
  finish(): void;
};

function fixture() {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, getComputedStyle: win.getComputedStyle.bind(win) });
  const animations: RecordedAnimation[] = [];
  Object.defineProperty(win.HTMLElement.prototype, 'animate', { configurable: true, value(this: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    let resolve!: () => void, reject!: (error: Error) => void;
    const finished = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const animation: RecordedAnimation = {
      target: this, frames, timing, state: 'running', pauses: 0, plays: 0, cancellations: 0,
      finish() { if (this.state !== 'idle') { this.state = 'finished'; resolve(); } },
    };
    animations.push(animation);
    return {
      finished,
      pause() { animation.state = 'paused'; animation.pauses++; },
      play() { animation.state = 'running'; animation.plays++; },
      cancel() { animation.cancellations++; if (animation.state !== 'finished') reject(new Error('Animation cancelled')); animation.state = 'idle'; },
    } as unknown as Animation;
  } });
  win.document.body.innerHTML = `<div class="ai-book__spread">
    <div class="ai-book__page ai-book__page--left" style="padding: 10px 12px"><p id="old-left">OLD LEFT CALM ART</p></div>
    <div class="ai-book__page ai-book__page--right" style="padding: 10px 12px"><p id="old-right" data-book-output>OLD RIGHT INK</p><span data-book-cursor></span></div>
  </div>`;
  const spread = win.document.querySelector('.ai-book__spread')! as unknown as HTMLElement;
  const left = spread.querySelector<HTMLElement>('.ai-book__page--left')!;
  const right = spread.querySelector<HTMLElement>('.ai-book__page--right')!;
  const leftNext = left.cloneNode(true) as HTMLElement;
  leftNext.querySelector('p')!.textContent = 'NEW LEFT CALM ART';
  const rightNext = right.cloneNode(true) as HTMLElement;
  rightNext.querySelector('p')!.textContent = 'NEW RIGHT INK';
  const pages: TurnPages = { right, leftNext, rightNext };
  const turns = createBookPageTurn(spread);
  return { win, animations, spread, left, right, pages, turns };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const temporaryNodes = (spread: HTMLElement) => spread.querySelectorAll('.ai-book__turn-sheet, .ai-book__turn-underlay, .ai-book__turn-shadow').length;

test('a page is committed only after the sheet, curl and shadow all finish', async () => {
  const f = fixture();
  let commits = 0;
  try {
    const result = f.turns.turn(f.pages, () => {
      commits++;
      assert.equal(temporaryNodes(f.spread), 3, 'last frame covers the atomic content commit');
      f.right.querySelector('p')!.textContent = 'NEW RIGHT INK';
    }, true);
    assert.equal(f.animations.length, 13);
    assert.ok(f.animations.every(animation => animation.timing.duration === 900));
    assert.equal(f.right.querySelector('p')!.textContent, 'OLD RIGHT INK');
    assert.equal(f.spread.querySelector('.ai-book__turn-face--front')!.textContent, 'OLD RIGHT INK');
    f.animations[0].finish(); await flush();
    assert.equal(commits, 0, 'the sheet finishing cannot expose a half-finished curl');
    f.animations[1].finish(); await flush();
    assert.equal(commits, 0, 'the moving cast shadow also finishes before commit');
    f.animations.slice(2).forEach(animation => animation.finish());
    assert.equal(await result, true);
    assert.equal(commits, 1);
    assert.equal(f.right.querySelector('p')!.textContent, 'NEW RIGHT INK');
    assert.equal(temporaryNodes(f.spread), 0);
    assert.equal(f.spread.dataset.bookTurning, undefined);
  } finally { f.turns.unmount(); await f.win.happyDOM.close(); }
});

test('cancelling a moving leaf keeps outgoing ink and removes every temporary layer', async () => {
  const f = fixture();
  let commits = 0;
  try {
    const result = f.turns.turn(f.pages, () => { commits++; }, true);
    f.animations[0].finish();
    f.turns.cancel();
    assert.equal(await result, false);
    assert.equal(commits, 0);
    assert.equal(f.right.querySelector('[data-book-output]')!.textContent, 'OLD RIGHT INK');
    assert.equal(f.left.textContent, 'OLD LEFT CALM ART');
    assert.equal(temporaryNodes(f.spread), 0);
    assert.equal(f.spread.dataset.bookTurning, undefined);
    assert.ok(f.animations.every(animation => animation.cancellations === 1));
    for (const animation of f.animations) animation.finish();
    await flush();
    assert.equal(commits, 0, 'a cancelled frame cannot deliver a late commit');
  } finally { f.turns.unmount(); await f.win.happyDOM.close(); }
});

test('reverse turns snapshot the outgoing left and show upright incoming right on the back', async () => {
  const f = fixture();
  try {
    const result = f.turns.turn({ ...f.pages, direction: 'backward' }, () => {}, true);
    const sheet = f.spread.querySelector('.ai-book__turn-sheet')!;
    assert.ok(sheet.classList.contains('ai-book__turn-sheet--backward'));
    assert.equal(sheet.querySelector('.ai-book__turn-face--front')!.textContent, 'OLD LEFT CALM ART');
    assert.equal(sheet.querySelector('.ai-book__turn-face--back')!.textContent, 'NEW RIGHT INK');
    assert.equal(f.spread.querySelector('.ai-book__turn-underlay')!.textContent, 'NEW LEFT CALM ART');
    assert.match(String(f.animations[0].frames.at(-1)!.transform), /translateZ\(0\.5px\) rotateY\(180deg\)/);
    assert.ok(String(f.animations[1].frames[2].transform).startsWith('rotateY(-'), 'the local hinges curl toward the backward turn');
    assert.equal(f.animations[12].frames.at(-1)!.transform, 'translateX(100%) scaleX(0.9999999999999999)');
    assert.equal(f.spread.querySelectorAll('[data-book-output]').length, 1, 'temporary copies have no live ink hooks');
    assert.equal(f.spread.querySelectorAll('#old-right').length, 1, 'temporary copies have no duplicate identifiers');
    for (const face of sheet.querySelectorAll('.ai-book__turn-copy')) {
      assert.equal(face.getAttribute('aria-hidden'), 'true');
      assert.equal((face as HTMLElement).inert, true);
      assert.equal((face as HTMLElement).style.padding, '10px 12px', 'narrow strips preserve original page padding');
    }
    f.animations.forEach(animation => animation.finish());
    assert.equal(await result, true);
  } finally { f.turns.unmount(); await f.win.happyDOM.close(); }
});

test('pausing and resuming controls the whole leaf, curl and shadow together', async () => {
  const f = fixture();
  let commits = 0;
  try {
    const result = f.turns.turn(f.pages, () => { commits++; }, true);
    f.turns.pause();
    assert.ok(f.animations.every(animation => animation.state === 'paused' && animation.pauses === 2));
    await flush();
    assert.equal(commits, 0);
    f.turns.resume();
    assert.ok(f.animations.every(animation => animation.state === 'running' && animation.plays === 2));
    f.animations.forEach(animation => animation.finish());
    assert.equal(await result, true);
    assert.equal(commits, 1);
  } finally { f.turns.unmount(); await f.win.happyDOM.close(); }
});

test('the visitor animation switch commits immediately without motion layers', async () => {
  const f = fixture();
  let commits = 0;
  try {
    assert.equal(await f.turns.turn(f.pages, () => { commits++; }, false), true);
    assert.equal(commits, 1);
    assert.equal(f.animations.length, 0);
    assert.equal(temporaryNodes(f.spread), 0);
  } finally { f.turns.unmount(); await f.win.happyDOM.close(); }
});

test('a superseded turn cannot commit or remove the replacement sheet', async () => {
  const f = fixture();
  let firstCommits = 0, secondCommits = 0;
  try {
    const first = f.turns.turn(f.pages, () => { firstCommits++; }, true);
    const second = f.turns.turn({ ...f.pages, direction: 'backward' }, () => { secondCommits++; }, true);
    assert.equal(await first, false);
    assert.equal(firstCommits, 0);
    assert.equal(temporaryNodes(f.spread), 3, 'replacement layers survive the cancelled promise');
    assert.ok(f.spread.querySelector('.ai-book__turn-sheet--backward'));
    f.animations.slice(13).forEach(animation => animation.finish());
    assert.equal(await second, true);
    assert.equal(secondCommits, 1);
    assert.equal(temporaryNodes(f.spread), 0);
  } finally { f.turns.unmount(); await f.win.happyDOM.close(); }
});

test('unmount aborts a page turn without a late commit', async () => {
  const f = fixture();
  let commits = 0;
  try {
    const result = f.turns.turn(f.pages, () => { commits++; }, true);
    f.turns.unmount();
    assert.equal(await result, false);
    assert.equal(commits, 0);
    assert.equal(temporaryNodes(f.spread), 0);
    assert.equal(f.right.querySelector('p')!.textContent, 'OLD RIGHT INK');
  } finally { await f.win.happyDOM.close(); }
});
