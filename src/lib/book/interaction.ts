import type { BookPageGesture } from './pages.ts';

/** The paper follows primary mouse, pen and touch pointers; vertical scrolling stays native. */
export function mountBookInteraction(volume: HTMLElement, options: {
  allowed(): boolean;
  start(): void;
  begin(back: boolean): Promise<BookPageGesture | undefined>;
  navigate(back: boolean): void;
  settled(result: { moved: boolean; newPage: boolean }): void;
  cancel(): void;
}) {
  const events = new AbortController();
  const on = (name: string, handler: (event: PointerEvent) => void) => volume.addEventListener(name, handler as EventListener, { signal: events.signal });
  type Drag = { id: number; x: number; y: number; time: number; width: number; direction: number; progress: number; active: boolean; gesture?: BookPageGesture; release?: boolean };
  let drag: Drag | undefined, serial = 0, landing = false;
  function releaseCapture(id: number) {
    try { if (volume.hasPointerCapture(id)) volume.releasePointerCapture(id); } catch { /* Detached targets no longer own capture. */ }
  }
  function cancel() {
    ++serial;
    const current = drag; drag = undefined; landing = false;
    delete volume.dataset.bookDragging;
    if (current) { current.gesture?.cancel(); releaseCapture(current.id); }
    options.cancel();
  }
  async function finish(current: Drag, complete: boolean) {
    if (!current.gesture) { current.release = complete; return; }
    landing = true;
    drag = undefined; delete volume.dataset.bookDragging; releaseCapture(current.id);
    const revision = serial;
    const result = await current.gesture.finish(complete);
    if (revision !== serial) return;
    landing = false; options.settled(result);
  }
  on('pointerdown', event => {
    if (drag || landing || !options.allowed() || event.isPrimary === false || event.button !== 0 ||
        (event.target as Element).closest('a, button, input, select')) return;
    const box = volume.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, width: box.width, direction: 0, progress: 0, active: false };
  });
  on('pointermove', event => {
    const current = drag;
    if (!current || current.id !== event.pointerId || current.release !== undefined) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = undefined; return; }
      if (Math.abs(dx) < 9 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      current.active = true; current.direction = Math.sign(dx); volume.dataset.bookDragging = 'true'; options.start();
      try { volume.setPointerCapture(current.id); } catch { /* Synthetic pointers may not be capturable. */ }
      const revision = ++serial;
      void options.begin(dx > 0).then(gesture => {
        if (revision !== serial || drag !== current) { gesture?.cancel(); return; }
        current.gesture = gesture;
        if (!gesture) { drag = undefined; delete volume.dataset.bookDragging; releaseCapture(current.id); options.settled({ moved: false, newPage: false }); return; }
        gesture.progress(current.progress);
        if (current.release !== undefined) void finish(current, current.release);
      }).catch(() => { if (revision === serial) cancel(); });
    }
    event.preventDefault();
    current.progress = Math.max(0, Math.min(1, dx * current.direction / Math.max(1, current.width * .5)));
    current.gesture?.progress(current.progress);
  });
  on('pointerup', event => {
    const current = drag;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.active) {
      event.preventDefault();
      const distance = dx * current.direction;
      current.progress = Math.max(0, Math.min(1, distance / Math.max(1, current.width * .5)));
      current.gesture?.progress(current.progress);
      const velocity = distance / Math.max(80, event.timeStamp - current.time);
      void finish(current, current.progress >= .28 || (distance >= 38 && velocity > .45));
    } else {
      drag = undefined;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || event.timeStamp - current.time > 700) return;
      const fraction = (event.clientX - volume.getBoundingClientRect().left) / Math.max(1, current.width);
      if (fraction < .28 || fraction > .72) options.navigate(fraction < .28);
    }
  });
  on('pointercancel', event => { if (drag?.id === event.pointerId) cancel(); });
  // Touch first captures the ink element implicitly. Its loss bubbles when
  // capture moves to the volume; only losing our own capture cancels the turn.
  on('lostpointercapture', event => { if (event.target === volume && drag?.id === event.pointerId && drag.release === undefined) cancel(); });
  return { cancel, unmount() { cancel(); events.abort(); } };
}
