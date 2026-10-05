import { ANGULAR_SPEED, DEFAULT_SETTINGS, ENVIRONMENT_VERSION, PHYSICS_DT, PlaneEnvironment, isActionSafe, lookAheadAction, wrapAngle } from './environment.ts';
import { argmax, forward, validateCheckpoint, workspace, type PolicyCheckpoint } from './network.ts';
import type { TrainingMetrics } from './trainer.ts';

export interface RenderCloud { id: number; angle: number; radial: number; angularHalfWidth: number; radialHalfWidth: number; opacity: number; appearance: number }
export interface PlaneRenderState {
  angle: number; heading: number; radial: number; velocity: number; bank: number; loaded: boolean; paused: boolean; clouds: RenderCloud[];
  diagnostics: { policyVersion: number; shieldEnabled: boolean; shieldInterventions: number; collisions: number; loadError: string | null; training: TrainingMetrics | null };
}
export interface PlaneOptions { phaseOffset?: number; shield?: boolean; seed?: number; trackInnerRadius?: number; trackWidth?: number }
export interface PlaneController {
  loadPolicy(url?: string): Promise<void>; tick(clockPhaseSeconds: number, dtSeconds: number): PlaneRenderState;
  sync(clockPhaseSeconds: number): void; setPaused(paused: boolean): void; setPolicy(checkpoint: PolicyCheckpoint): void;
  setShield(enabled: boolean): void; setLearning(enabled: boolean): void; resetLearning(): void; dispose(): void;
}
/** Clock phase is authoritative; integration never accumulates the aircraft's displayed orbit. */
export function createPlaneController(options: PlaneOptions = {}): PlaneController {
  const phaseOffset = options.phaseOffset ?? 0; const seed = options.seed ?? 72631;
  const trackInnerRadius = options.trackInnerRadius ?? 162; const trackWidth = options.trackWidth ?? 33;
  let environment = new PlaneEnvironment(seed); let previousPhysical = environment.physical;
  let weights: Float32Array | null = null; let checkpoint: PolicyCheckpoint | null = null;
  let phase = 0; let lastPhase: number | null = null; let accumulator = 0; let paused = false; let disposed = false;
  let shieldEnabled = options.shield ?? false; let interventions = 0; let collisions = 0; let resets = 0; let loadError: string | null = null;
  const work = workspace(); let requestVersion = 0; let learningWorker: Worker | null = null; let training: TrainingMetrics | null = null;
  let publishedCheckpoint: PolicyCheckpoint | null = null;
  let loadAbort: AbortController | null = null;
  const storageKey = 'chronos-plane-local-v1';
  async function readAsset(url: string, signal: AbortSignal): Promise<Response> {
    try { const response = await fetch(url, { signal }); if (!response.ok) throw new Error(`Plane asset HTTP ${response.status}`); return response; }
    catch (error) { if (signal.aborted) throw error; const cached = typeof caches !== 'undefined' ? await (await caches.open('chronos-plane-assets-v1')).match(url) : undefined; if (cached) return cached; throw error; }
  }
  function sync(clockPhaseSeconds: number): void {
    if (disposed) return;
    phase = clockPhaseSeconds * ANGULAR_SPEED + phaseOffset;
    environment = new PlaneEnvironment((seed + resets++ * 7919) >>> 0, {}, phase / ANGULAR_SPEED);
    previousPhysical = environment.physical; lastPhase = clockPhaseSeconds; accumulator = 0;
  }
  function setPolicy(value: PolicyCheckpoint): void {
    if (disposed) return;
    const checked = validateCheckpoint(value);
    if (checked.environmentVersion !== ENVIRONMENT_VERSION) throw new Error('Plane policy environment mismatch');
    checkpoint = checked; weights = new Float32Array(checked.weights); loadError = null;
  }
  function render(): PlaneRenderState {
    const blend = accumulator / PHYSICS_DT;
    const radial = previousPhysical.radial + (environment.radial - previousPhysical.radial) * blend;
    const velocity = previousPhysical.velocity + (environment.velocity - previousPhysical.velocity) * blend;
    return { angle: phase, heading: phase + Math.PI / 2 - Math.atan2(trackWidth * velocity, (trackInnerRadius + trackWidth * radial) * ANGULAR_SPEED), radial, velocity, bank: Math.max(-0.24, Math.min(0.24, velocity * 0.32)), loaded: !!weights, paused,
      clouds: environment.clouds.map(c => ({ id: c.id, angle: c.centerTime * ANGULAR_SPEED, radial: c.radial,
        angularHalfWidth: c.angularHalfWidth, radialHalfWidth: c.radialHalfWidth, appearance: c.appearance,
        opacity: Math.min(1, Math.max(0, (environment.time - c.bornTime) / 0.8)) })),
      diagnostics: { policyVersion: checkpoint?.version ?? 0, shieldEnabled, shieldInterventions: interventions, collisions, loadError, training } };
  }
  return {
    async loadPolicy(url = '/watch/plane/policy.json'): Promise<void> {
      if (disposed) return;
      const request = ++requestVersion;
      loadAbort?.abort(); const abort = new AbortController(); loadAbort = abort;
      const timeout = setTimeout(() => abort.abort(new Error('Plane asset download timed out')), 15000);
      try {
        const response = await readAsset(url, abort.signal); const raw = await response.text();
        if (disposed || request !== requestVersion) return;
        const manifestUrl = url.replace(/policy\.json(?:\?.*)?$/, 'manifest.json');
        const manifestResponse = await readAsset(manifestUrl, abort.signal); const manifest = await manifestResponse.json() as { checkpointSha256: string; environmentVersion: string };
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), byte => byte.toString(16).padStart(2, '0')).join('');
        if (manifest.checkpointSha256 !== hash || manifest.environmentVersion !== ENVIRONMENT_VERSION) throw new Error('Plane checkpoint integrity mismatch');
        const value: unknown = JSON.parse(raw); if (disposed || request !== requestVersion) return; setPolicy(value as PolicyCheckpoint); publishedCheckpoint = checkpoint;
        try {
          if (typeof caches !== 'undefined') {
            const cache = await caches.open('chronos-plane-assets-v1');
            await cache.put(url, new Response(raw, { headers: { 'Content-Type': 'application/json' } })); await cache.put(manifestUrl, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
            const allowed = [new URL(url, location.href).href, new URL(manifestUrl, location.href).href];
            for (const key of await cache.keys()) if (!allowed.includes(key.url)) await cache.delete(key);
          }
        } catch { /* Integrity checked inference does not require optional offline storage. */ }
        try {
          const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
          if (stored && stored.length >= 100000) localStorage.removeItem(storageKey);
          if (stored && stored.length < 100000) {
            const local = validateCheckpoint(JSON.parse(stored));
            if (local.environmentVersion === ENVIRONMENT_VERSION && local.normalization === checkpoint?.normalization && local.trainingSteps > (checkpoint?.trainingSteps ?? 0)) setPolicy(local);
          }
        } catch { try { localStorage.removeItem(storageKey); } catch { /* Storage unavailable; inference remains fully functional. */ } }
      } catch (error) { if (!disposed && request === requestVersion) { loadError = error instanceof Error ? error.message : 'Plane checkpoint unavailable'; throw error; } }
      finally { clearTimeout(timeout); if (loadAbort === abort) loadAbort = null; }
    },
    tick(clockPhaseSeconds: number, dtSeconds: number): PlaneRenderState {
      if (disposed) return render();
      if (!Number.isFinite(clockPhaseSeconds) || !Number.isFinite(dtSeconds) || dtSeconds < 0) throw new Error('Invalid clock tick');
      const delta = lastPhase === null ? 0 : wrapAngle((clockPhaseSeconds - lastPhase) * ANGULAR_SPEED) / ANGULAR_SPEED;
      if (lastPhase === null || dtSeconds > 0.25 || Math.abs(delta - dtSeconds) > 0.25) sync(clockPhaseSeconds);
      phase = clockPhaseSeconds * ANGULAR_SPEED + phaseOffset; lastPhase = clockPhaseSeconds;
      if (!weights || paused) return render();
      accumulator = Math.min(0.2, accumulator + Math.min(dtSeconds, 0.1));
      while (accumulator >= PHYSICS_DT) {
        previousPhysical = environment.physical;
        let action = argmax(forward(weights, environment.observation(), work).q);
        if (shieldEnabled && !isActionSafe(environment, action)) { const safe = lookAheadAction(environment); if (safe !== action) { action = safe; interventions++; } }
        const result = environment.step(action); accumulator -= PHYSICS_DT;
        if (result.terminal) { collisions++; sync(clockPhaseSeconds); break; }
      }
      return render();
    },
    sync,
    setPaused(value: boolean): void { if (disposed || paused === value) return; paused = value; if (!paused && lastPhase !== null) sync(lastPhase); learningWorker?.postMessage({ type: 'pause', paused }); },
    setPolicy,
    setShield(value: boolean): void { if (!disposed) shieldEnabled = value; },
    setLearning(enabled: boolean): void {
      if (disposed) return;
      if (!enabled) { learningWorker?.terminate(); learningWorker = null; training = null; return; }
      if (learningWorker || !checkpoint || typeof Worker === 'undefined') return;
      // Trainer is split by Vite into a worker fetched only after explicit Learn activation.
      learningWorker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      learningWorker.onmessage = (event: MessageEvent<{ type: string; metrics?: TrainingMetrics; checkpoint?: PolicyCheckpoint }>) => {
        if (disposed) return;
        if (event.data.metrics) training = event.data.metrics;
        if (event.data.type === 'policy' && event.data.checkpoint) {
          setPolicy(event.data.checkpoint);
          try { if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify(event.data.checkpoint)); } catch { /* No persistence required for actual learning. */ }
        }
      };
      learningWorker.postMessage({ type: 'start', checkpoint, paused });
    },
    resetLearning(): void { if (disposed) return; learningWorker?.postMessage({ type: 'reset', checkpoint: publishedCheckpoint }); training = null; if (publishedCheckpoint) setPolicy(publishedCheckpoint); try { if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey); } catch { /* Optional bounded storage. */ } },
    dispose(): void { disposed = true; requestVersion++; loadAbort?.abort(); loadAbort = null; learningWorker?.terminate(); learningWorker = null; weights = null; checkpoint = null; publishedCheckpoint = null; training = null; environment.clouds = []; },
  };
}

export const PLANE_GEOMETRY = { radialHalfWidth: DEFAULT_SETTINGS.planeRadialHalfWidth, angularHalfWidth: DEFAULT_SETTINGS.planeAngularHalfWidth, innerLane: 0.15, middleLane: 0.5, outerLane: 0.85 } as const;
