import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argmax, forward, PARAMETER_COUNT, validateCheckpoint } from '../src/lib/watch/plane/network.ts';
import { backward, initializeWeights, DQNTrainer, Replay } from '../src/lib/watch/plane/trainer.ts';
import { seededRandom } from '../src/lib/watch/plane/environment.ts';

test('DQN parameter layout has 1699 genuine weights and analytical derivatives match finite differences', () => {
  const random = seededRandom(391); const weights = initializeWeights(random); const input = Float32Array.from({ length: 16 }, () => random() * 0.8 + 0.1);
  assert.equal(weights.length, PARAMETER_COUNT); assert.equal(weights.byteLength, 6796);
  const gradient = new Float64Array(PARAMETER_COUNT); const work = forward(weights, input); backward(weights, input, work, 2, 0.7, gradient);
  const epsilon = 0.001;
  for (const i of [0, 43, 183, 350, 511, 516, 540, 545, 712, 901, 1311, 1569, 1589, 1600, 1667, 1687, 1698]) {
    const original = weights[i]!; weights[i] = original + epsilon; const plus = forward(weights, input).q[2]! * 0.7;
    weights[i] = original - epsilon; const minus = forward(weights, input).q[2]! * 0.7; weights[i] = original;
    const numerical = (plus - minus) / (2 * epsilon);
    assert.ok(Math.abs(numerical - gradient[i]!) < 0.00025, `parameter ${i}: analytical ${gradient[i]}, numerical ${numerical}`);
  }
  assert.equal(argmax([3, 5, 4]), 1); assert.equal(argmax([4, 4, 4]), 0);
});

test('training changes weights, preserves bounded replay, and exports a trained numeric checkpoint', () => {
  const trainer = new DQNTrainer({ capacity: 96, warmup: 64, batchSize: 8, targetEvery: 8 }); const before = trainer.weights.slice();
  for (let i = 0; i < 160; i++) trainer.step();
  assert.ok(trainer.weights.some((w, i) => w !== before[i])); assert.equal(trainer.replay.length, 96); assert.ok(trainer.updates > 0);
  assert.ok(trainer.weights.every(Number.isFinite)); assert.equal(validateCheckpoint(trainer.checkpoint()).trainingSteps, 160);
  assert.throws(() => validateCheckpoint({ ...trainer.checkpoint(), trainingSteps: 0 }), /Invalid/);
  const replay = new Replay(4096); assert.equal(replay.bytes, 552960);
});
