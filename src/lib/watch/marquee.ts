import type { WatchMotion } from './types.ts';

/** A continuous advertising-style loop. Every word passes through the window. */
export function planMarquee(viewport: number, text: number, font: number) {
  const overflow = Math.max(0, text - viewport);
  const speed = Math.max(32, font * 2.6);
  const gap = font * 1.8;
  const distance = text + gap;
  const readMs = text / speed * 1000;
  const duration = distance / speed * 1000;
  return { overflow, gap, readMs, duration, frames: [
    { transform: 'translateX(0px)' }, { transform: `translateX(${-distance}px)` },
  ] };
}

/** Owns only the decorative copy. The complete accessible caption stays outside. */
export function mountMarquee(output: HTMLElement, onMotionChange: () => void, motion: WatchMotion = 'sweep') {
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
  const respectsReduction = () => motion === 'system' && media.matches;
  let wasReduced = respectsReduction();
  function sync() {
    if (animation) {
      if (blocked || hovered) animation.pause(); else animation.play();
    }
    output.dataset.watchMarqueeState = !animation ? 'static' : blocked || hovered ? 'paused' : 'playing';
  }
  function refresh() {
    if (!enabled || disposed) return;
    const reduced = respectsReduction();
    if (wasReduced && !reduced) { windowNode.scrollLeft = 0; read = false; }
    wasReduced = reduced;
    root.dataset.watchMarqueeStatic = String(reduced);
    if (output.firstChild !== windowNode) output.replaceChildren(windowNode);
    track.textContent = sentence;
    track.dataset.watchMarqueeCopy = sentence;
    const width = windowNode.clientWidth;
    const font = Number.parseFloat(getComputedStyle(output).fontSize);
    const textWidth = track.getBoundingClientRect().width;
    const nextSignature = `${sentence}:${width}:${textWidth}:${font}:${respectsReduction()}`;
    if (signature === nextSignature) return;
    const progress = readMs && animation ? Math.min(1, Number(animation.currentTime ?? 0) / readMs) : 0;
    read ||= progress >= 1;
    animation?.cancel(); animation = undefined; signature = nextSignature;
    track.style.transform = '';
    const plan = planMarquee(width, textWidth, font);
    readMs = plan.readMs;
    output.dataset.watchMarqueeReadMs = String(readMs);
    output.style.setProperty('--watch-marquee-gap', `${plan.gap}px`);
    if (!respectsReduction() && width > 0 && sentence) {
      animation = track.animate(plan.frames, { duration: plan.duration, iterations: Infinity, easing: 'linear' });
      animation.currentTime = progress * readMs;
    }
    sync();
  }
  media.addEventListener('change', () => { root.dataset.watchMarqueeStatic = String(respectsReduction()); onMotionChange(); }, { signal: abort.signal });
  output.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovered = true; sync(); } }, { signal: abort.signal });
  output.addEventListener('pointerleave', () => { hovered = false; sync(); }, { signal: abort.signal });
  root.dataset.watchMarqueeStatic = String(respectsReduction());
  return {
    get reducedMotion() { return respectsReduction(); },
    get readyForNext() {
      if (!enabled) return true;
      if (hovered) return false;
      if (!animation) return true;
      read ||= Number(animation.currentTime ?? 0) >= readMs;
      return read;
    },
    setText(text: string, active: boolean) {
      if (sentence !== text || (active && !enabled)) { read = false; signature = ''; windowNode.scrollLeft = 0; animation?.cancel(); animation = undefined; }
      sentence = text; enabled = active;
      if (active) refresh();
      else { animation?.cancel(); animation = undefined; signature = ''; hovered = false; output.textContent = text; }
    },
    refresh,
    setMotion(value: WatchMotion) { motion = value; root.dataset.watchMarqueeStatic = String(respectsReduction()); refresh(); },
    pause(value: boolean) { blocked = value; sync(); },
    dispose() { disposed = true; abort.abort(); animation?.cancel(); animation = undefined; },
  };
}
