import { createPlaneController, type PlaneRenderState } from './plane/controller.ts';
import type { ClockSnapshot } from './types.ts';

const NS = 'http://www.w3.org/2000/svg';
/** Rendering and swept collision use the same normalized annulus and cloud footprints. */
export function mountPlane(root: HTMLElement) {
  const plane = root.querySelector<SVGElement>('[data-watch-plane]')!;
  const clouds = root.querySelector<SVGGElement>('[data-watch-clouds]')!;
  const metrics = root.querySelector<HTMLElement>('[data-watch-metrics]')!;
  const learning = root.querySelector<HTMLElement>('[data-watch-learning]')!;
  const controller = createPlaneController({ shield: true });
  const nodes = new Map<number, SVGEllipseElement>();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let showPlane = true, showClouds = true, paused = false, lastMetrics = 0, requestedLearning = false, disposed = false;
  const animated = () => !motion.matches && root.dataset.watchTicking !== 'true';
  function paint(state: PlaneRenderState) {
    const active = state.loaded && showPlane && animated();
    plane.style.display = active ? '' : 'none'; clouds.style.display = active && showClouds ? '' : 'none';
    // Y-up local aircraft shape rotated to the clockwise tangent.
    const radius = 162 + state.radial * 33;
    const x = 220 + Math.sin(state.angle) * radius, y = 220 - Math.cos(state.angle) * radius;
    plane.setAttribute('transform', `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${(state.heading * 180 / Math.PI).toFixed(2)})`);
    const existing = new Set<number>();
    for (const cloud of state.clouds) {
      existing.add(cloud.id);
      let node = nodes.get(cloud.id);
      if (!node) {
        node = document.createElementNS(NS, 'ellipse'); node.setAttribute('fill', '#dce8e5');
        clouds.append(node); nodes.set(cloud.id, node);
      }
      const r = 162 + cloud.radial * 33;
      node.setAttribute('cx', String(220 + Math.sin(cloud.angle) * r));
      node.setAttribute('cy', String(220 - Math.cos(cloud.angle) * r));
      node.setAttribute('rx', String(r * cloud.angularHalfWidth)); node.setAttribute('ry', String(33 * cloud.radialHalfWidth));
      node.setAttribute('transform', `rotate(${cloud.angle * 180 / Math.PI} ${220 + Math.sin(cloud.angle) * r} ${220 - Math.cos(cloud.angle) * r})`);
      node.setAttribute('opacity', String(cloud.opacity * .72));
    }
    for (const [id, node] of nodes) if (!existing.has(id)) { node.remove(); nodes.delete(id); }
    if (performance.now() - lastMetrics > 1000) {
      const d = state.diagnostics;
      metrics.textContent = state.loaded ? `Trained hybrid DQN · 1,699 parameters · policy ${d.policyVersion} · Safety assist on · ${d.shieldInterventions} interventions · ${d.collisions} collisions` : 'Aircraft policy unavailable; the clock remains operational.';
      const t = d.training;
      learning.textContent = t ? `${state.paused ? 'Simulation paused' : 'Learning in simulation'} · ${t.steps.toLocaleString('en')} steps · epsilon ${t.epsilon.toFixed(2)} · recent return ${t.recentReturn.toFixed(2)} · ${(t.collisionRate * 100).toFixed(1)}% collisions · policy ${t.policyVersion}` : 'Frozen trained policy · Safety assist checks the aircraft’s next path.';
      lastMetrics = performance.now();
    }
  }
  plane.style.display = 'none'; clouds.style.display = 'none';
  void controller.loadPolicy().then(() => { if (!disposed) controller.setLearning(requestedLearning && animated()); }).catch(() => { if (!disposed) metrics.textContent = 'Aircraft policy unavailable; the clock remains operational.'; });
  return {
    frame(clock: ClockSnapshot, elapsed: number) {
      if (disposed) return;
      controller.setPaused(paused || !showPlane || !animated());
      if (requestedLearning && animated()) controller.setLearning(true);
      paint(controller.tick(clock.parts.seconds + clock.parts.milliseconds / 1000, Math.max(0, elapsed)));
    },
    pause(value: boolean) { paused = value; controller.setPaused(paused); },
    setPlane(value: boolean) { showPlane = value; },
    setClouds(value: boolean) { showClouds = value; },
    learn(value: boolean) { requestedLearning = value; controller.setLearning(value && animated()); },
    resetLearning() { controller.resetLearning(); },
    dispose() { disposed = true; controller.dispose(); nodes.forEach(node => node.remove()); nodes.clear(); },
  };
}
