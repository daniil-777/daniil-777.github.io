/** A continuous-looking paper curl, with a seekable gesture and atomic page commit. */
export interface TurnPages {
  right: HTMLElement;
  leftNext: HTMLElement;
  rightNext: HTMLElement;
  direction?: 'forward' | 'backward';
}
export interface BookTurnGesture {
  /** Normalized paper progress; does not commit content, even at 1. */
  progress(value: number): void;
  /** Land on the incoming spread, or return to the original one. */
  finish(complete?: boolean): Promise<boolean>;
  cancel(): void;
}

const SEGMENTS = 12;
const OFFSETS = [0, .12, .26, .42, .58, .76, .9, 1];
const ANGLES = [0, 8, 32, 77, 133, 166, 177, 180];
const BENDS = [0, 2.3, 2.6, 2.9, 3.2, 3.5, 3.8, 4.1, 4.4, 4.7, 5, 5.3];
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function createBookPageTurn(spread: HTMLElement) {
  let animations: Animation[] = [];
  let cleanup: (() => void) | undefined;
  let serial = 0;
  let phase: 'drag' | 'settling' | undefined;

  function cancel() {
    ++serial;
    cleanup?.(); cleanup = undefined; phase = undefined;
    delete spread.dataset.bookTurning;
  }
  function snapshot(source: HTMLElement, reference = source) {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.classList.add('ai-book__turn-copy');
    clone.style.padding = getComputedStyle(reference).padding;
    // Freeze the currently visible contour stroke if the outgoing art was
    // still being drawn. cloneNode does not preserve WAAPI presentation state.
    const sourcePaths = source.querySelectorAll<SVGPathElement>('.ai-book__contour, .ai-book__contour-accent');
    clone.querySelectorAll<SVGPathElement>('.ai-book__contour, .ai-book__contour-accent').forEach((path, i) => {
      if (source.isConnected && sourcePaths[i]) path.style.strokeDashoffset = getComputedStyle(sourcePaths[i]).strokeDashoffset;
    });
    for (const element of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
      element.removeAttribute('id'); element.removeAttribute('tabindex');
      for (const attribute of [...element.attributes]) {
        if (attribute.name.startsWith('data-book-')) element.removeAttribute(attribute.name);
      }
    }
    clone.setAttribute('aria-hidden', 'true'); clone.inert = true;
    return clone;
  }

  function start(pages: TurnPages, commit: () => void, enabled: boolean, duration: number, interactive: boolean): BookTurnGesture {
    cancel();
    const revision = serial;
    const backward = pages.direction === 'backward';
    const sign = backward ? 1 : -1;
    const leftReference = spread.querySelector<HTMLElement>('.ai-book__page--left') ?? pages.right;
    const outgoing = backward ? leftReference : pages.right;
    const incomingBack = backward ? pages.rightNext : pages.leftNext;
    const incomingReference = backward ? pages.right : leftReference;
    let progress = 0, finished = false, landing: Promise<boolean> | undefined;
    let tracks: Animation[] = [], remove: (() => void) | undefined;
    phase = interactive ? 'drag' : 'settling';

    if (enabled && typeof spread.animate === 'function') {
      const underlay = snapshot(backward ? pages.leftNext : pages.rightNext, backward ? leftReference : pages.right);
      underlay.classList.add('ai-book__turn-underlay');
      const shadow = document.createElement('div');
      shadow.className = 'ai-book__turn-shadow'; shadow.setAttribute('aria-hidden', 'true');
      const sheet = document.createElement('div');
      sheet.className = 'ai-book__turn-sheet'; sheet.setAttribute('aria-hidden', 'true'); sheet.inert = true;
      if (backward) {
        underlay.classList.add('ai-book__turn-underlay--backward');
        shadow.classList.add('ai-book__turn-shadow--backward');
        sheet.classList.add('ai-book__turn-sheet--backward');
      }

      const panels: HTMLElement[] = [];
      let parent = sheet;
      for (let i = 0; i < SEGMENTS; i++) {
        const panel = document.createElement('div');
        panel.className = 'ai-book__turn-panel';
        panel.style.setProperty('--book-strip-shade', String(.035 + .04 * (i / (SEGMENTS - 1)) ** 2));
        const front = document.createElement('div'); front.className = 'ai-book__turn-face ai-book__turn-face--front';
        const frontCopy = snapshot(outgoing);
        frontCopy.style.left = `${-100 * (backward ? SEGMENTS - 1 - i : i)}%`;
        front.append(frontCopy);
        const back = document.createElement('div'); back.className = 'ai-book__turn-face ai-book__turn-face--back';
        const backCopy = snapshot(incomingBack, incomingReference);
        backCopy.style.left = `${-100 * (backward ? i : SEGMENTS - 1 - i)}%`;
        back.append(backCopy);
        panel.append(front, back); parent.append(panel);
        panels.push(panel); parent = panel;
      }
      spread.append(underlay, shadow, sheet);
      spread.dataset.bookTurning = 'true';

      const timing: KeyframeAnimationOptions = { duration, easing: 'linear', fill: 'both' };
      const wave = (p: number) => Math.sin(Math.PI * p);
      tracks = [
        sheet.animate(OFFSETS.map((p, i) => ({
          offset: p,
          transform: `translateZ(0.5px) rotateY(${sign * ANGLES[i]}deg) rotateZ(${sign * .35 * wave(p)}deg)`,
          '--book-page-shade': wave(p),
        })), timing),
        // Connected local hinges share an edge. Their small angles accumulate
        // into a smooth bend instead of a large, visibly folded outer section.
        ...panels.slice(1).map((panel, index) => panel.animate(OFFSETS.map(p => ({
          offset: p,
          transform: `rotateY(${-sign * BENDS[index + 1] * wave(p)}deg)`,
          '--book-page-shade': wave(p),
        })), timing)),
        shadow.animate(OFFSETS.map(p => ({
          offset: p, opacity: .24 * wave(p),
          transform: `translateX(${sign * p * 100}%) scaleX(${1 - .72 * wave(p)})`,
        })), timing),
      ];
      animations = tracks;
      for (const animation of tracks) {
        animation.pause(); animation.currentTime = 0;
        // Drag sessions may be cancelled before finish() subscribes below.
        // Always observe finished rejection so cancellation stays silent.
        void animation.finished.catch(() => {});
      }
      remove = () => {
        for (const animation of tracks) animation.cancel();
        if (animations === tracks) animations = [];
        underlay.remove(); shadow.remove(); sheet.remove();
        if (revision === serial) delete spread.dataset.bookTurning;
      };
      cleanup = remove;
    }

    function finish(complete = true): Promise<boolean> {
      if (landing) return landing;
      if (finished || revision !== serial) return Promise.resolve(false);
      phase = 'settling';
      const distance = complete ? 1 - progress : progress;
      landing = (async () => {
        if (tracks.length && distance > .001) {
          // Automatic turns take the full duration; a dragged leaf lands in
          // 120–420 ms so release feels attached to the visitor's hand.
          const settleMs = interactive ? Math.max(120, Math.min(420, distance * duration)) : duration;
          for (const animation of tracks) {
            animation.playbackRate = (complete ? 1 : -1) * (distance * duration / settleMs);
            animation.play();
          }
          try { await Promise.all(tracks.map(animation => animation.finished)); }
          catch { /* cancel() keeps the original real spread untouched. */ }
        }
        if (revision !== serial) return false;
        finished = true;
        try { if (complete) commit(); }
        finally {
          remove?.();
          if (revision === serial) { cleanup = undefined; phase = undefined; }
        }
        return complete;
      })();
      return landing;
    }
    return {
      progress(value) {
        if (finished || landing || revision !== serial) return;
        progress = clamp(value);
        for (const animation of tracks) animation.currentTime = progress * duration;
      },
      finish,
      cancel() { if (revision === serial) cancel(); },
    };
  }

  return {
    turn(pages: TurnPages, commit: () => void, enabled: boolean, duration = 900) {
      return start(pages, commit, enabled, duration, false).finish(true);
    },
    begin(pages: TurnPages, commit: () => void, enabled: boolean, duration = 900) {
      return start(pages, commit, enabled, duration, true);
    },
    pause() { if (phase === 'settling') for (const animation of animations) animation.pause(); },
    resume() { if (phase === 'settling') for (const animation of animations) animation.play(); },
    cancel,
    unmount: cancel,
  };
}
