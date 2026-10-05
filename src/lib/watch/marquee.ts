/** A readable pass, followed by a quiet reset and a right-to-left entrance. */
export function planMarquee(viewport: number, text: number, font: number) {
  const overflow = Math.max(0, text - viewport);
  const speed = Math.max(18, font * 1.35);
  const dwell = 1600, fade = 300, gap = 100;
  const travel = overflow / speed * 1000;
  const entrance = viewport / speed * 1000;
  const readMs = dwell + travel + dwell;
  const duration = readMs + fade + gap + entrance;
  const frame = (time: number, x: number, opacity = 1) => ({ offset: time / duration, transform: `translateX(${x}px)`, opacity });
  return { overflow, readMs, duration, frames: [
    frame(0, 0), frame(dwell, 0), frame(dwell + travel, -overflow),
    frame(readMs, -overflow), frame(readMs + fade, -overflow, 0),
    frame(readMs + fade + gap, viewport, 0), frame(duration, 0),
  ] };
}

/** Owns only the decorative copy. The complete accessible caption stays outside. */
export function mountMarquee(output: HTMLElement, onMotionChange: () => void) {
  const root = output.closest<HTMLElement>('[data-watch]')!;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const windowNode = document.createElement('span');
  windowNode.className = 'chronos__marquee-window';
  const track = document.createElement('span');
  track.dataset.watchMarqueeTrack = '';
  windowNode.append(track);
  let animation: Animation | undefined, enabled = false, blocked = false, hovered = false;
  let sentence = '', signature = '', readMs = 0, read = false, disposed = false;
  function sync() {
    if (animation) {
      if (blocked || hovered) animation.pause(); else animation.play();
    }
    output.dataset.watchMarqueeState = !animation ? 'static' : blocked || hovered ? 'paused' : 'playing';
  }
  function refresh() {
    if (!enabled || disposed) return;
    root.dataset.watchMarqueeStatic = String(media.matches);
    if (output.firstChild !== windowNode) output.replaceChildren(windowNode);
    track.textContent = sentence;
    const width = windowNode.clientWidth;
    const font = Number.parseFloat(getComputedStyle(output).fontSize);
    const textWidth = track.getBoundingClientRect().width;
    const nextSignature = `${sentence}:${width}:${textWidth}:${font}:${media.matches}`;
    if (signature === nextSignature) return;
    const progress = readMs && animation ? Math.min(1, Number(animation.currentTime ?? 0) / readMs) : 0;
    read ||= progress >= 1;
    animation?.cancel(); animation = undefined; signature = nextSignature;
    track.style.transform = '';
    const plan = planMarquee(width, textWidth, font);
    readMs = plan.readMs;
    output.dataset.watchMarqueeReadMs = String(readMs);
    if (!media.matches && width > 0 && plan.overflow > 1) {
      animation = track.animate(plan.frames, { duration: plan.duration, iterations: Infinity, easing: 'linear' });
      animation.currentTime = progress * readMs;
    }
    sync();
  }
  media.addEventListener('change', () => { root.dataset.watchMarqueeStatic = String(media.matches); onMotionChange(); }, { signal: abort.signal });
  output.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovered = true; sync(); } }, { signal: abort.signal });
  output.addEventListener('pointerleave', () => { hovered = false; sync(); }, { signal: abort.signal });
  root.dataset.watchMarqueeStatic = String(media.matches);
  return {
    get reducedMotion() { return media.matches; },
    get readyForNext() {
      if (!enabled) return true;
      if (hovered) return false;
      read ||= !animation || Number(animation.currentTime ?? 0) >= readMs;
      return read;
    },
    setText(text: string, active: boolean) {
      if (sentence !== text || (active && !enabled)) { read = false; signature = ''; animation?.cancel(); animation = undefined; }
      sentence = text; enabled = active;
      if (active) refresh();
      else { animation?.cancel(); animation = undefined; signature = ''; hovered = false; output.textContent = text; }
    },
    refresh,
    pause(value: boolean) { blocked = value; sync(); },
    dispose() { disposed = true; abort.abort(); animation?.cancel(); animation = undefined; },
  };
}
