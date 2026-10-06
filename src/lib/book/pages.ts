import { applyBookArt, generateBookArt, type BookArt } from './artwork.ts';
import { createBookPageTurn } from './page-turn.ts';
import type { BookThought } from './content.ts';
import type { BookTopic } from './model.ts';

export interface BookPage { thought: BookThought; mode: BookTopic; origin: string; seed: number; art?: BookArt }
export interface BookPageGesture {
  progress(value: number): void;
  finish(complete: boolean): Promise<{ moved: boolean; newPage: boolean }>;
  cancel(): void;
}
export function createBookPages(root: HTMLElement, initial: BookPage, options: {
  motion(): boolean; visible(): boolean; start(): void; commit(page: BookPage): void; settled(): void;
}) {
  const spread = root.querySelector<HTMLElement>('.ai-book__spread');
  const left = spread?.querySelector<HTMLElement>('.ai-book__page--left');
  const right = spread?.querySelector<HTMLElement>('.ai-book__page--right');
  const previous = root.querySelector<HTMLButtonElement>('[data-book-previous]');
  const next = root.querySelector<HTMLButtonElement>('[data-book-next]');
  const counter = root.querySelector('[data-book-page-count]');
  const turn = spread ? createBookPageTurn(spread) : undefined;
  let history = [initial], index = 0, revision = 0, disposed = false;
  let generation: AbortController | undefined;
  let drawing: Animation[] = [];
  function ensureCurrentArt(force = false) {
    const page = history[index];
    if (disposed || !left?.querySelector('[data-book-artwork]') || page.art || generation || (!force && !options.visible())) return;
    const serial = revision, request = new AbortController(); generation = request;
    void generateBookArt(page.mode, page.seed, request.signal).then(art => {
      if (disposed || serial !== revision || request.signal.aborted) return;
      page.art = art; applyBookArt(left, art); generation = undefined; replayArt(); options.settled();
    }).catch(() => { /* A later visible replay can retry the cached decorative model. */ })
      .finally(() => { if (generation === request) generation = undefined; });
  }

  function navigation() {
    if (previous) previous.disabled = index === 0 || root.dataset.bookTurning === 'true';
    if (next) next.disabled = root.dataset.bookTurning === 'true';
    const numbers = [index * 2 + 1, index * 2 + 2].map(n => String(n).padStart(2, '0'));
    if (counter) counter.textContent = numbers.join(' — ');
    spread?.querySelectorAll('.ai-book__page-number').forEach((node, i) => { node.textContent = numbers[i]; });
  }
  function stopDrawing() { drawing.forEach(animation => animation.cancel()); drawing = []; }
  function replayArt() {
    ensureCurrentArt();
    stopDrawing();
    if (!left || !options.motion()) return;
    for (const path of left.querySelectorAll<SVGPathElement>('[data-book-contour], [data-book-contour-accent]')) {
      if (!path.getAttribute('d') || typeof path.animate !== 'function') continue;
      const animation = path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 4400, easing: 'cubic-bezier(.2,.45,.45,1)', fill: 'both' });
      if (!options.visible()) animation.pause();
      drawing.push(animation);
    }
  }
  function syncArt(playing: boolean) {
    if (playing) ensureCurrentArt();
    if (!options.motion()) { stopDrawing(); return; }
    for (const animation of drawing) if (animation.playState !== 'finished') playing ? animation.play() : animation.pause();
  }
  function cancel() {
    ++revision; generation?.abort(); generation = undefined; turn?.cancel();
    delete root.dataset.bookTurning; syncArt(false); navigation();
  }
  async function prepare(page: BookPage, target: number, reset = false) {
    cancel();
    const serial = revision;
    root.dataset.bookTurning = 'true'; options.start(); navigation();
    const direction: 'backward' | 'forward' = target < index ? 'backward' : 'forward';
    const commit = () => {
      if (disposed || serial !== revision) return;
      if (reset) { history = [page]; index = 0; }
      else if (target < history.length) index = target;
      else { history = history.slice(0, index + 1); history.push(page); index = history.length - 1; }
      // Keep retained history bounded without changing the displayed spread.
      if (history.length > 32) { history.shift(); index--; }
      if (left && page.art) applyBookArt(left, page.art);
      navigation(); options.commit(page);
    };
    if (left && right && turn) {
      const request = new AbortController(); generation = request;
      try {
        page.art ??= await generateBookArt(page.mode, page.seed, request.signal);
      } catch { if (request.signal.aborted || disposed) return; /* Existing artwork remains readable offline. */ }
      if (disposed || serial !== revision || request.signal.aborted) return;
    }
    const leftNext = left?.cloneNode(true) as HTMLElement | undefined;
    if (leftNext && page.art) applyBookArt(leftNext, page.art);
    const rightNext = right?.cloneNode(true) as HTMLElement | undefined;
    const newInk = rightNext?.querySelector('[data-book-output]');
    if (newInk) newInk.textContent = direction === 'backward' ? page.thought.text : '';
    return {
      pages: right && leftNext && rightNext ? { right, leftNext, rightNext, direction } : undefined,
      commit, enabled: options.motion() && options.visible(),
      settle(moved: boolean) {
        if (disposed || serial !== revision) return false;
        generation = undefined; delete root.dataset.bookTurning; navigation();
        if (moved) replayArt();
        options.settled();
        return moved;
      },
    };
  }
  async function present(page: BookPage, target: number, reset = false) {
    const prepared = await prepare(page, target, reset);
    if (!prepared) return false;
    if (!prepared.pages || !turn) { prepared.commit(); return prepared.settle(true); }
    return prepared.settle(await turn.turn(prepared.pages, prepared.commit, prepared.enabled));
  }
  // The first left page is genuinely generated as soon as the lazy assets arrive.
  ensureCurrentArt(true);
  navigation();
  return {
    show(thought: BookThought, mode: BookTopic, origin: string, reset = false) {
      const page: BookPage = { thought, mode, origin, seed: (history[index].seed + 104729) >>> 0 };
      return present(page, reset ? 0 : index + 1, reset);
    },
    replace(thought: BookThought, origin: string) { const page = history[index]; page.thought = thought; page.origin = origin; options.commit(page); options.settled(); },
    previous() { if (index > 0) { void present(history[index - 1], index - 1); return true; } return false; },
    next() { if (index + 1 < history.length) { void present(history[index + 1], index + 1); return true; } return false; },
    async gesture(back: boolean, thought: BookThought, mode: BookTopic, origin: string): Promise<BookPageGesture | undefined> {
      if (back && index === 0) return;
      const target = index + (back ? -1 : 1), newPage = target >= history.length;
      const page = newPage ? { thought, mode, origin, seed: (history[index].seed + 104729) >>> 0 } : history[target];
      const prepared = await prepare(page, target);
      if (!prepared) return;
      const gesture = prepared.pages && turn ? turn.begin(prepared.pages, prepared.commit, prepared.enabled) : undefined;
      let landing: Promise<{ moved: boolean; newPage: boolean }> | undefined;
      return {
        progress(value) { gesture?.progress(value); },
        finish(complete) {
          return landing ??= (async () => {
            if (!gesture && complete) prepared.commit();
            const moved = prepared.settle(gesture ? await gesture.finish(complete) : complete);
            return { moved, newPage };
          })();
        },
        cancel() { gesture?.cancel(); prepared.settle(false); },
      };
    },
    replayArt, syncArt, cancel,
    refreshLabels() { if (left && history[index].art) applyBookArt(left, history[index].art!); },
    pause() { turn?.pause(); syncArt(false); },
    resume() { turn?.resume(); syncArt(options.visible()); },
    unmount() { disposed = true; cancel(); stopDrawing(); turn?.unmount(); },
  };
}
