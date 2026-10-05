import { readClock, validateTimeZone } from './clock.ts';
import type { DialController, DialOptions, WatchMotion } from './types.ts';

/** Only hand transforms change per frame; language and simulation stay independent. */
export function mountDial(root: HTMLElement, options: DialOptions = {}): DialController {
  const hands = ['hour', 'minute', 'second'].map(name => ({
    name: name as 'hour' | 'minute' | 'second',
    nodes: Array.from(root.querySelectorAll<SVGElement>(`[data-watch-hand="${name}"]`)),
  }));
  const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-watch-time]'));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const now = options.now ?? (() => new Date());
  let timeZone = validateTimeZone(options.timeZone);
  let motion: WatchMotion = options.motion ?? 'sweep';
  let frame = 0;
  let suspended = false;
  let disposed = false;
  let lastEpoch = 0;
  let lastTick = -1;
  let lastLabel = '';

  const draw = () => {
    frame = 0;
    if (disposed || suspended || document.hidden) return;
    const clock = readClock(now(), timeZone);
    const ticking = motion === 'tick' || reduced.matches;
    const tickValue = String(ticking);
    if (root.dataset.watchTicking !== tickValue) root.dataset.watchTicking = tickValue;
    const tick = Math.floor(clock.epochMs / 1_000);
    if (!ticking || tick !== lastTick) {
      const angles = ticking ? readClock(new Date(tick * 1_000), timeZone).angles : clock.angles;
      for (const hand of hands) {
        for (const node of hand.nodes) {
          const center = node.dataset.watchCenter ?? '220';
          node.setAttribute('transform', `rotate(${angles[hand.name]} ${center} ${center})`);
        }
      }
      lastTick = tick;
    }
    if (lastLabel !== clock.label) {
      for (const label of labels) {
        label.textContent = clock.label;
        if (label instanceof HTMLTimeElement) label.dateTime = new Date(clock.epochMs).toISOString();
      }
      lastLabel = clock.label;
    }
    const elapsed = lastEpoch ? (clock.epochMs - lastEpoch) / 1_000 : 0;
    options.onFrame?.(clock, elapsed);
    lastEpoch = clock.epochMs;
    if (!disposed && !suspended && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; lastEpoch = 0; };
  const start = () => {
    if (!disposed && !suspended && !document.hidden && !frame) {
      lastTick = -1;
      options.onResume?.();
      draw();
    }
  };
  const onVisibility = () => { document.hidden ? stop() : start(); };
  const onReduced = () => { lastTick = -1; };
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener('change', onReduced);
  start();
  return {
    setTimeZone(value) { timeZone = validateTimeZone(value); lastTick = -1; lastLabel = ''; },
    setMotion(value) { motion = value; lastTick = -1; },
    suspend() { suspended = true; stop(); },
    resume() { suspended = false; start(); },
    dispose() {
      disposed = true; stop();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onReduced);
    },
  };
}
