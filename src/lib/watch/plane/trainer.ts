import { ENVIRONMENT_VERSION, PHYSICS_DT, PlaneEnvironment, conservativeExpertAction, seededRandom, type LaneAction, type EnvironmentSettings } from './environment.ts';
import { ARCHITECTURE, OFFSETS, PARAMETER_COUNT, argmax, forward, workspace, type PolicyCheckpoint, type ForwardWorkspace } from './network.ts';

export interface TrainerConfig {
  seed: number; capacity: number; batchSize: number; warmup: number; updateEvery: number;
  discount: number; learningRate: number; targetEvery: number; epsilonDecay: number; epsilonFloor: number;
  gradientClip: number; curriculumSteps: number; environment?: Partial<EnvironmentSettings>;
  expertLossWeight: number; expertWarmstartSteps: number; expertMargin: number;
}
export const DEFAULT_TRAINER: TrainerConfig = { seed: 82419, capacity: 4096, batchSize: 32, warmup: 512, updateEvery: 4,
  discount: 0.99, learningRate: 0.001, targetEvery: 500, epsilonDecay: 50000, epsilonFloor: 0.05, gradientClip: 10, curriculumSteps: 15000,
  expertLossWeight: 0, expertWarmstartSteps: 0, expertMargin: 0.25 };
export function initializeWeights(random: () => number): Float32Array {
  const weights = new Float32Array(PARAMETER_COUNT);
  for (const [offset, inputs, outputs] of [[OFFSETS.w1, 16, 32], [OFFSETS.w2, 32, 32], [OFFSETS.w3, 32, 3]])
    for (let i = 0; i < inputs! * outputs!; i++) weights[offset! + i] = (random() * 2 - 1) * Math.sqrt(6 / inputs!);
  for (let i = 0; i < 32; i++) { weights[OFFSETS.b1 + i] = 0.02; weights[OFFSETS.b2 + i] = 0.02; }
  return weights;
}
/** Accumulate d(loss)/d(parameters) with an externally supplied scalar Q derivative. */
export function backward(weights: ArrayLike<number>, input: ArrayLike<number>, work: ForwardWorkspace, action: number, derivative: number, gradient: Float64Array): void {
  const d2 = new Float64Array(32); const d1 = new Float64Array(32);
  gradient[OFFSETS.b3 + action] += derivative;
  for (let i = 0; i < 32; i++) {
    gradient[OFFSETS.w3 + action * 32 + i] += derivative * work.hidden2[i]!;
    d2[i] = work.hidden2[i]! > 0 ? derivative * weights[OFFSETS.w3 + action * 32 + i]! : 0;
  }
  for (let out = 0; out < 32; out++) {
    gradient[OFFSETS.b2 + out] += d2[out]!;
    for (let i = 0; i < 32; i++) {
      gradient[OFFSETS.w2 + out * 32 + i] += d2[out]! * work.hidden1[i]!;
      d1[i] += d2[out]! * weights[OFFSETS.w2 + out * 32 + i]!;
    }
  }
  for (let out = 0; out < 32; out++) if (work.hidden1[out]! > 0) {
    gradient[OFFSETS.b1 + out] += d1[out]!;
    for (let i = 0; i < 16; i++) gradient[OFFSETS.w1 + out * 16 + i] += d1[out]! * input[i]!;
  }
}
export class Replay {
  readonly states: Float32Array; readonly nextStates: Float32Array; readonly actions: Uint8Array; readonly rewards: Float32Array; readonly terminals: Uint8Array;
  readonly capacity: number;
  readonly experts: Uint8Array;
  cursor = 0; length = 0;
  constructor(capacity: number) { this.capacity = capacity; this.states = new Float32Array(capacity * 16); this.nextStates = new Float32Array(capacity * 16); this.actions = new Uint8Array(capacity); this.rewards = new Float32Array(capacity); this.terminals = new Uint8Array(capacity); this.experts = new Uint8Array(capacity); }
  get bytes(): number { return this.states.byteLength + this.nextStates.byteLength + this.actions.byteLength + this.rewards.byteLength + this.terminals.byteLength + this.experts.byteLength; }
  add(state: Float32Array, next: Float32Array, action: LaneAction, reward: number, terminal: boolean, expert = action): void {
    const index = this.cursor; this.states.set(state, index * 16); this.nextStates.set(next, index * 16);
    this.actions[index] = action; this.rewards[index] = reward; this.terminals[index] = +terminal; this.experts[index] = expert;
    this.cursor = (index + 1) % this.capacity; this.length = Math.min(this.capacity, this.length + 1);
  }
}
export interface TrainingMetrics { steps: number; updates: number; epsilon: number; recentReturn: number; collisionRate: number; episodes: number; policyVersion: number; lastLoss: number; replayBytes: number; pretrainedSteps?: number }
export class DQNTrainer {
  readonly config: TrainerConfig; readonly random: () => number; readonly weights: Float32Array; readonly target: Float32Array; readonly replay: Replay;
  readonly gradient = new Float64Array(PARAMETER_COUNT); readonly momentum = new Float32Array(PARAMETER_COUNT); readonly variance = new Float32Array(PARAMETER_COUNT);
  environment: PlaneEnvironment;
  steps = 0; updates = 0; episodes = 0; lastLoss = 0; version = 1;
  expertLabelCount = 0;
  readonly inheritedCheckpoint: PolicyCheckpoint | undefined;
  rewardTotals = { survival: 0, collision: 0, pass: 0, speed: 0, acceleration: 0, clearancePotential: 0 };
  private episodeSteps = 0; private episodeReturn = 0; private recent: { return: number; collision: boolean }[] = [];
  private liveWork = workspace(); private targetWork = workspace(); private trainWork = workspace();
  private nextWork = workspace();
  constructor(config: Partial<TrainerConfig> = {}, checkpoint?: PolicyCheckpoint) {
    this.config = { ...DEFAULT_TRAINER, ...config }; this.random = seededRandom(this.config.seed);
    this.inheritedCheckpoint = checkpoint;
    for (const key of ['capacity', 'batchSize', 'warmup', 'updateEvery', 'targetEvery', 'epsilonDecay'] as const) if (!Number.isSafeInteger(this.config[key]) || this.config[key] < 1) throw new Error(`Invalid trainer ${key}`);
    if (!(this.config.learningRate > 0) || !(this.config.discount > 0 && this.config.discount <= 1) || !(this.config.epsilonFloor >= 0 && this.config.epsilonFloor <= 1) || !Number.isFinite(this.config.expertLossWeight)) throw new Error('Invalid trainer numeric configuration');
    this.weights = checkpoint ? new Float32Array(checkpoint.weights) : initializeWeights(this.random);
    this.target = new Float32Array(this.weights); this.replay = new Replay(this.config.capacity);
    this.steps = checkpoint?.trainingSteps ?? 0; this.version = checkpoint?.version ?? 1; this.environment = this.newEnvironment();
  }
  private newEnvironment(): PlaneEnvironment {
    const curriculum = this.steps < this.config.curriculumSteps ? { spacingMin: 5, spacingMax: 6.5, cloudRadialMax: 0.17 } : {};
    return new PlaneEnvironment(Math.floor(this.random() * 0xffffffff), { ...curriculum, ...this.config.environment }, this.random() * 60);
  }
  get epsilon(): number { return Math.max(this.config.epsilonFloor, 1 - (1 - this.config.epsilonFloor) * this.steps / this.config.epsilonDecay); }
  step(): void {
    const observation = this.environment.observation();
    const expert = this.config.expertLossWeight > 0 ? conservativeExpertAction(this.environment) : 1;
    if (this.config.expertLossWeight > 0) this.expertLabelCount++;
    const action = this.steps < this.config.expertWarmstartSteps && this.random() > 0.15 ? expert : this.random() < this.epsilon ? Math.floor(this.random() * 3) as LaneAction : argmax(forward(this.weights, observation, this.liveWork).q);
    const result = this.environment.step(action);
    this.replay.add(observation, result.observation, action, result.reward, result.terminal, expert);
    this.steps++; this.episodeSteps++; this.episodeReturn += result.reward;
    for (const key of Object.keys(this.rewardTotals) as (keyof typeof this.rewardTotals)[]) this.rewardTotals[key] += result.components[key];
    if (this.replay.length >= this.config.warmup && this.steps % this.config.updateEvery === 0) this.update();
    // Time limits are truncations: replay terminal remains false and TD continues to bootstrap.
    if (result.terminal || this.episodeSteps >= Math.round(60 / PHYSICS_DT)) {
      this.episodes++; this.recent.push({ return: this.episodeReturn, collision: result.terminal }); if (this.recent.length > 100) this.recent.shift();
      this.environment = this.newEnvironment(); this.episodeSteps = 0; this.episodeReturn = 0;
    }
  }
  update(): void {
    const c = this.config; this.gradient.fill(0); let loss = 0;
    for (let n = 0; n < c.batchSize; n++) {
      const index = Math.floor(this.random() * this.replay.length);
      const state = this.replay.states.subarray(index * 16, index * 16 + 16); const next = this.replay.nextStates.subarray(index * 16, index * 16 + 16);
      const action = this.replay.actions[index]!;
      const nextAction = argmax(forward(this.weights, next, this.nextWork).q);
      const target = this.replay.rewards[index]! + (this.replay.terminals[index] ? 0 : c.discount * forward(this.target, next, this.targetWork).q[nextAction]!);
      const work = forward(this.weights, state, this.trainWork); const td = work.q[action]! - target;
      loss += Math.abs(td) <= 1 ? td * td / 2 : Math.abs(td) - 0.5;
      backward(this.weights, state, work, action, Math.max(-1, Math.min(1, td)) / c.batchSize, this.gradient);
      if (c.expertLossWeight > 0) {
        const expert = this.replay.experts[index]!; const marginQ = Array.from(work.q, (q, i) => q + (i === expert ? 0 : c.expertMargin));
        const other = argmax(marginQ); const violation = marginQ[other]! - work.q[expert]!;
        if (violation > 0 && other !== expert) {
          const weight = this.steps < c.expertWarmstartSteps ? 1 : c.expertLossWeight;
          backward(this.weights, state, work, other, weight / c.batchSize, this.gradient);
          backward(this.weights, state, work, expert, -weight / c.batchSize, this.gradient);
          loss += weight * violation;
        }
      }
    }
    let norm = 0; for (const g of this.gradient) norm += g * g;
    const scale = Math.min(1, c.gradientClip / (Math.sqrt(norm) + 1e-12)); this.updates++;
    const correction1 = 1 - 0.9 ** this.updates; const correction2 = 1 - 0.999 ** this.updates;
    for (let i = 0; i < PARAMETER_COUNT; i++) {
      const g = this.gradient[i]! * scale;
      this.momentum[i] = 0.9 * this.momentum[i]! + 0.1 * g; this.variance[i] = 0.999 * this.variance[i]! + 0.001 * g * g;
      this.weights[i] -= c.learningRate * (this.momentum[i]! / correction1) / (Math.sqrt(this.variance[i]! / correction2) + 1e-8);
    }
    if (this.updates % c.targetEvery === 0) { this.target.set(this.weights); this.version++; }
    this.lastLoss = loss / c.batchSize;
  }
  metrics(): TrainingMetrics {
    return { steps: this.steps, updates: this.updates, epsilon: this.epsilon, recentReturn: this.recent.length ? this.recent.reduce((a, b) => a + b.return, 0) / this.recent.length : 0,
      collisionRate: this.recent.length ? this.recent.filter(r => r.collision).length / this.recent.length : 0, episodes: this.episodes, policyVersion: this.version, lastLoss: this.lastLoss, replayBytes: this.replay.bytes };
  }
  checkpoint(): PolicyCheckpoint { return { format: 'chronos-dqn-v1', environmentVersion: ENVIRONMENT_VERSION, architecture: [...ARCHITECTURE], weights: Array.from(this.weights), seed: this.config.seed,
    trainingSteps: this.steps, version: this.version, normalization: 'r∈[0,1];v/maxSpeed∈[-1,1];sinθ,cosθ;cloud=[wrappedAngle/(ω*4.2),r,angularHalfWidth/.052,radialHalfWidth/.25];absent=[-2,-2,0,0]',
    trainingMethod: this.config.expertLossWeight > 0 || this.inheritedCheckpoint?.trainingMethod === 'double-dqn-expert-warmstart' ? 'double-dqn-expert-warmstart' : 'double-dqn',
    expertWarmstartSteps: Math.max(this.config.expertWarmstartSteps, this.inheritedCheckpoint?.expertWarmstartSteps ?? 0), expertLossWeight: this.config.expertLossWeight || this.inheritedCheckpoint?.expertLossWeight || 0 }; }
}
