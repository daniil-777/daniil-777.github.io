/** Shared deterministic, normalized aircraft dynamics. No rendering or learning dependencies. */
export const ENVIRONMENT_VERSION = 'chronos-plane-2';
export const ANGULAR_SPEED = Math.PI * 2 / 60;
export const PHYSICS_DT = 1 / 20;
export const LANES = [0.15, 0.5, 0.85] as const;
export type LaneAction = 0 | 1 | 2;
export interface PhysicalState { radial: number; velocity: number }
export interface Cloud {
  id: number; centerTime: number; radial: number; angularHalfWidth: number; radialHalfWidth: number;
  appearance: number; bornTime: number;
}
export interface EnvironmentSettings {
  maxSpeed: number; acceleration: number; planeRadialHalfWidth: number; planeAngularHalfWidth: number;
  cloudRadialMin: number; cloudRadialMax: number; cloudAngularMin: number; cloudAngularMax: number;
  leadSeconds: number; spacingMin: number; spacingMax: number; spawnHorizon: number;
  survivalReward: number; collisionReward: number; passReward: number; speedPenalty: number; accelerationPenalty: number;
  potentialStrength: number; potentialDiscount: number;
}
export const DEFAULT_SETTINGS: Readonly<EnvironmentSettings> = Object.freeze({
  maxSpeed: 0.7, acceleration: 2.8, planeRadialHalfWidth: 0.13, planeAngularHalfWidth: 0.023,
  cloudRadialMin: 0.10, cloudRadialMax: 0.18, cloudAngularMin: 0.028, cloudAngularMax: 0.052,
  leadSeconds: 3.0, spacingMin: 3.4, spacingMax: 4.6, spawnHorizon: 4.2,
  survivalReward: 0.08, collisionReward: -2, passReward: 0.4, speedPenalty: 0.015, accelerationPenalty: 0.0008,
  potentialStrength: 0.4, potentialDiscount: 0.99,
});
export interface RewardComponents { survival: number; collision: number; pass: number; speed: number; acceleration: number; clearancePotential: number }
export interface StepResult { observation: Float32Array; reward: number; components: RewardComponents; terminal: boolean; passed: number }

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value + 0x6d2b79f5) >>> 0; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function wrapAngle(angle: number): number { return ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }
export function advanceRadial(state: PhysicalState, action: LaneAction, dt = PHYSICS_DT, settings = DEFAULT_SETTINGS): PhysicalState {
  if (!Number.isInteger(action) || action < 0 || action > 2 || !Number.isFinite(dt) || dt < 0 || dt > 0.25) throw new Error('Invalid lane action/timestep');
  const error = LANES[action] - state.radial;
  const requested = Math.sign(error) * Math.min(settings.maxSpeed, Math.sqrt(2 * settings.acceleration * Math.abs(error)));
  const delta = Math.max(-settings.acceleration * dt, Math.min(settings.acceleration * dt, requested - state.velocity));
  let velocity = state.velocity + delta;
  let radial = state.radial + velocity * dt;
  if ((LANES[action] - state.radial) * (LANES[action] - radial) < 0 && Math.abs(velocity) <= settings.acceleration * dt * 2) { radial = LANES[action]; velocity = 0; }
  const minimum = settings.planeRadialHalfWidth; const maximum = 1 - minimum;
  if (radial < minimum || radial > maximum) { radial = Math.max(minimum, Math.min(maximum, radial)); velocity = 0; }
  return { radial, velocity };
}
/** Exact intersection of the swept center segment with the Minkowski-expanded ellipse. */
export function sweptCloudCollision(a: PhysicalState, b: PhysicalState, startTime: number, endTime: number, cloud: Cloud, settings = DEFAULT_SETTINGS): boolean {
  const angularSize = cloud.angularHalfWidth + settings.planeAngularHalfWidth;
  const radialSize = cloud.radialHalfWidth + settings.planeRadialHalfWidth;
  const x = (startTime - cloud.centerTime) * ANGULAR_SPEED / angularSize;
  const y = (a.radial - cloud.radial) / radialSize;
  const dx = (endTime - startTime) * ANGULAR_SPEED / angularSize;
  const dy = (b.radial - a.radial) / radialSize;
  const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, -(x * dx + y * dy) / denominator)) : 0;
  return (x + t * dx) ** 2 + (y + t * dy) ** 2 <= 1;
}
export function collides(a: PhysicalState, b: PhysicalState, startTime: number, endTime: number, clouds: readonly Cloud[], settings = DEFAULT_SETTINGS): boolean {
  return clouds.some(cloud => sweptCloudCollision(a, b, startTime, endTime, cloud, settings));
}
/** A retained state represents a real safe action sequence, so true certifies an executable trajectory.
 * Quantized pruning can reject valid arrangements, but cannot falsely certify impossible ones. */
export function reachable(initial: PhysicalState, time: number, clouds: readonly Cloud[], settings = DEFAULT_SETTINGS): boolean {
  if (!clouds.length) return true;
  const end = Math.max(...clouds.map(c => c.centerTime + (c.angularHalfWidth + settings.planeAngularHalfWidth) / ANGULAR_SPEED)) + 0.15;
  // Fast certification by complete constant-target trajectories; never substitutes a free-lane assumption.
  for (const action of [0, 1, 2] as const) {
    let state = { ...initial }; let safe = true;
    for (let at = time; at < end; at += PHYSICS_DT) {
      const next = advanceRadial(state, action, PHYSICS_DT, settings);
      if (collides(state, next, at, at + PHYSICS_DT, clouds, settings)) { safe = false; break; }
      state = next;
    }
    if (safe) return true;
  }
  let states: PhysicalState[] = [{ ...initial }];
  for (let at = time; at < end; at += PHYSICS_DT * 3) {
    const next = new Map<number, PhysicalState>();
    for (const state of states) for (const action of [0, 1, 2] as const) {
      let candidate = state; let safe = true;
      for (let sub = 0; sub < 3; sub++) {
        const advanced = advanceRadial(candidate, action, PHYSICS_DT, settings);
        if (collides(candidate, advanced, at + sub * PHYSICS_DT, at + (sub + 1) * PHYSICS_DT, clouds, settings)) { safe = false; break; }
        candidate = advanced;
      }
      if (safe) next.set(Math.round(candidate.radial * 35) * 100 + Math.round((candidate.velocity + settings.maxSpeed) * 18), candidate);
    }
    states = [...next.values()];
    if (!states.length) return false;
  }
  return true;
}

export class PlaneEnvironment {
  readonly settings: EnvironmentSettings;
  readonly random: () => number;
  radial = 0.5;
  velocity = 0;
  time = 0;
  clouds: Cloud[] = [];
  terminal = false;
  passedClouds = 0;
  rejectedLayouts = 0;
  private nextId = 1;
  constructor(seed = 1, settings: Partial<EnvironmentSettings> = {}, phaseSeconds = 0) {
    this.settings = Object.freeze({ ...DEFAULT_SETTINGS, ...settings });
    if (Object.values(this.settings).some(value => !Number.isFinite(value)) || this.settings.cloudRadialMin <= 0 || this.settings.cloudRadialMax >= 0.2 || this.settings.cloudRadialMin > this.settings.cloudRadialMax) throw new Error('Invalid cloud settings');
    if (!(this.settings.spawnHorizon * ANGULAR_SPEED < Math.PI) || this.settings.leadSeconds <= 1) throw new Error('Invalid cloud horizon/lead time');
    this.random = seededRandom(seed);
    this.time = phaseSeconds;
    this.spawn();
  }
  get physical(): PhysicalState { return { radial: this.radial, velocity: this.velocity }; }
  private spawn(): void {
    const s = this.settings;
    while (this.clouds.length < 3) {
      const lastTime = this.clouds.at(-1)?.centerTime;
      const centerTime = lastTime === undefined ? this.time + s.leadSeconds + this.random() * 0.5 : lastTime + s.spacingMin + this.random() * (s.spacingMax - s.spacingMin);
      if (centerTime - this.time > s.spawnHorizon) return;
      let cloud: Cloud | undefined;
      for (let attempt = 0; attempt < 16; attempt++) {
        const candidate: Cloud = { id: this.nextId, centerTime, radial: 0.2 + this.random() * 0.6,
          angularHalfWidth: s.cloudAngularMin + this.random() * (s.cloudAngularMax - s.cloudAngularMin),
          radialHalfWidth: s.cloudRadialMin + this.random() * (s.cloudRadialMax - s.cloudRadialMin),
          appearance: this.random(), bornTime: this.time };
        if (reachable(this.physical, this.time, [...this.clouds, candidate], s)) { cloud = candidate; break; }
        this.rejectedLayouts++;
      }
      if (!cloud) return;
      this.clouds.push(cloud); this.nextId++;
    }
  }
  observation(out = new Float32Array(16)): Float32Array {
    out[0] = this.radial; out[1] = this.velocity / this.settings.maxSpeed;
    out[2] = Math.sin(this.time * ANGULAR_SPEED); out[3] = Math.cos(this.time * ANGULAR_SPEED);
    for (let i = 0; i < 3; i++) {
      const c = this.clouds[i]; const at = 4 + i * 4;
      if (!c) { out[at] = -2; out[at + 1] = -2; out[at + 2] = 0; out[at + 3] = 0; }
      else { out[at] = wrapAngle((c.centerTime - this.time) * ANGULAR_SPEED) / (ANGULAR_SPEED * DEFAULT_SETTINGS.spawnHorizon); out[at + 1] = c.radial; out[at + 2] = c.angularHalfWidth / DEFAULT_SETTINGS.cloudAngularMax; out[at + 3] = c.radialHalfWidth / 0.25; }
    }
    return out;
  }
  private potential(): number {
    return -this.settings.potentialStrength * this.clouds.reduce((sum, cloud) => {
      const proximity = Math.max(0, 1 - Math.abs(this.radial - cloud.radial) / (cloud.radialHalfWidth + this.settings.planeRadialHalfWidth + 0.10));
      return sum + proximity ** 2 * Math.exp(-Math.max(0, cloud.centerTime - this.time));
    }, 0);
  }
  step(action: LaneAction): StepResult {
    if (this.terminal) throw new Error('Reset a terminal environment before stepping');
    const previous = this.physical; const previousPotential = this.potential();
    const advanced = advanceRadial(previous, action, PHYSICS_DT, this.settings);
    const hit = collides(previous, advanced, this.time, this.time + PHYSICS_DT, this.clouds, this.settings);
    this.radial = advanced.radial; this.velocity = advanced.velocity; this.time += PHYSICS_DT;
    let passed = 0;
    this.clouds = this.clouds.filter(c => {
      const cleared = (this.time - c.centerTime) * ANGULAR_SPEED > c.angularHalfWidth + this.settings.planeAngularHalfWidth;
      if (cleared) passed++;
      return !cleared;
    });
    this.passedClouds += passed; this.terminal = hit;
    if (!hit) this.spawn();
    const components: RewardComponents = { survival: this.settings.survivalReward * PHYSICS_DT,
      collision: hit ? this.settings.collisionReward : 0, pass: passed * this.settings.passReward,
      speed: -this.settings.speedPenalty * Math.abs(this.velocity) * PHYSICS_DT,
      acceleration: -this.settings.accelerationPenalty * Math.abs(this.velocity - previous.velocity),
      clearancePotential: this.settings.potentialDiscount * (hit ? 0 : this.potential()) - previousPotential };
    return { observation: this.observation(), reward: Object.values(components).reduce((a, b) => a + b, 0), components, terminal: hit, passed };
  }
}

/** Baseline/controller: choose the nearest lane with an executable fixed-lane look-ahead path. */
export function lookAheadAction(environment: PlaneEnvironment): LaneAction {
  const priorities = ([0, 1, 2] as LaneAction[]).sort((a, b) => Math.abs(LANES[a] - environment.radial) - Math.abs(LANES[b] - environment.radial));
  for (const action of priorities) {
    let state = environment.physical; let safe = true;
    const horizon = Math.min(4.4, Math.max(0.6, ...environment.clouds.map(c => c.centerTime - environment.time + c.angularHalfWidth / ANGULAR_SPEED + 0.2)));
    for (let dt = 0; dt < horizon; dt += PHYSICS_DT) {
      const next = advanceRadial(state, action, PHYSICS_DT, environment.settings);
      if (collides(state, next, environment.time + dt, environment.time + dt + PHYSICS_DT, environment.clouds, environment.settings)) { safe = false; break; }
      state = next;
    }
    if (safe) return action;
  }
  return priorities[0]!;
}

/** Conservative expert used solely for optional offline warmstart/regularization.
 * Widely separated extreme lanes leave clearance around every allowed individual cloud. */
export function conservativeExpertAction(environment: PlaneEnvironment): LaneAction {
  const cloud = environment.clouds[0];
  if (cloud) return cloud.radial >= 0.5 ? 0 : 2;
  return ([0, 1, 2] as LaneAction[]).sort((a, b) => Math.abs(LANES[a] - environment.radial) - Math.abs(LANES[b] - environment.radial))[0]!;
}

export function isActionSafe(environment: PlaneEnvironment, action: LaneAction, horizon = 1.25): boolean {
  let state = environment.physical;
  for (let t = 0; t < horizon; t += PHYSICS_DT) {
    const next = advanceRadial(state, action, PHYSICS_DT, environment.settings);
    if (collides(state, next, environment.time + t, environment.time + t + PHYSICS_DT, environment.clouds, environment.settings)) return false;
    state = next;
  }
  return true;
}
