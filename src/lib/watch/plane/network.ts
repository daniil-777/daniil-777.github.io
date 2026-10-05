/** 16→32→32→3 ReLU Q-network. Browser inference has no trainer imports. */
export const ARCHITECTURE = [16, 32, 32, 3] as const;
export const PARAMETER_COUNT = 1699;
export const OFFSETS = { w1: 0, b1: 512, w2: 544, b2: 1568, w3: 1600, b3: 1696 } as const;
export interface ForwardWorkspace { hidden1: Float32Array; hidden2: Float32Array; q: Float32Array }
export interface PolicyCheckpoint {
  format: 'chronos-dqn-v1'; environmentVersion: string; architecture: number[]; weights: number[];
  seed: number; trainingSteps: number; version: number; normalization: string;
  trainingMethod: 'double-dqn' | 'double-dqn-expert-warmstart'; expertWarmstartSteps: number; expertLossWeight: number;
}
export function workspace(): ForwardWorkspace { return { hidden1: new Float32Array(32), hidden2: new Float32Array(32), q: new Float32Array(3) }; }
export function forward(weights: ArrayLike<number>, input: ArrayLike<number>, work = workspace()): ForwardWorkspace {
  for (let out = 0; out < 32; out++) {
    let value = weights[OFFSETS.b1 + out]!;
    for (let i = 0; i < 16; i++) value += input[i]! * weights[OFFSETS.w1 + out * 16 + i]!;
    work.hidden1[out] = Math.max(0, value);
  }
  for (let out = 0; out < 32; out++) {
    let value = weights[OFFSETS.b2 + out]!;
    for (let i = 0; i < 32; i++) value += work.hidden1[i]! * weights[OFFSETS.w2 + out * 32 + i]!;
    work.hidden2[out] = Math.max(0, value);
  }
  for (let out = 0; out < 3; out++) {
    let value = weights[OFFSETS.b3 + out]!;
    for (let i = 0; i < 32; i++) value += work.hidden2[i]! * weights[OFFSETS.w3 + out * 32 + i]!;
    work.q[out] = value;
  }
  return work;
}
export function argmax(values: ArrayLike<number>): 0 | 1 | 2 { let best = 0; for (let i = 1; i < 3; i++) if (values[i]! > values[best]!) best = i; return best as 0 | 1 | 2; }
export function validateCheckpoint(value: unknown): PolicyCheckpoint {
  const p = value as PolicyCheckpoint;
  if (!p || p.format !== 'chronos-dqn-v1' || p.architecture?.join(',') !== ARCHITECTURE.join(',') || p.weights?.length !== PARAMETER_COUNT || p.weights.some(w => !Number.isFinite(w)) || !Number.isSafeInteger(p.trainingSteps) || p.trainingSteps <= 0 || !Number.isSafeInteger(p.version) || p.version < 1) throw new Error('Invalid/untrained plane checkpoint');
  return p;
}
