import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ENVIRONMENT_VERSION } from '../src/lib/watch/plane/environment.ts';
import { validateCheckpoint } from '../src/lib/watch/plane/network.ts';
const folder = new URL('../public/watch/plane/', import.meta.url);
const json = (name: string) => JSON.parse(readFileSync(new URL(name, folder), 'utf8'));

test('shipped learned weights and held-out evaluation bind to the same environment and immutable artifact', () => {
  const raw = readFileSync(new URL('policy.json', folder)); const checkpoint = validateCheckpoint(JSON.parse(raw.toString()));
  const manifest = json('manifest.json'); const evaluation = json('evaluation.json'); const training = json('policy-training.json');
  const hash = createHash('sha256').update(raw).digest('hex');
  assert.equal(checkpoint.environmentVersion, ENVIRONMENT_VERSION); assert.equal(manifest.checkpointSha256, hash); assert.equal(evaluation.checkpointSha256, hash); assert.equal(training.checkpointSha256, hash);
  assert.equal(evaluation.environmentVersion, ENVIRONMENT_VERSION); assert.equal(evaluation.settings.planeAngularHalfWidth, 0.061); assert.equal(manifest.settings.planeAngularHalfWidth, 0.061);
  assert.equal(checkpoint.trainingSteps, 500000); assert.equal(training.metrics.updates, 124873); assert.equal(checkpoint.trainingMethod, 'double-dqn-expert-warmstart');
  assert.notEqual(training.beforeWeightsSha256, training.afterWeightsSha256); assert.equal(evaluation.seedStart, 1000000); assert.equal(evaluation.seedEnd, 1000999);
  for (const name of ['fixed-middle', 'random', 'look-ahead', 'learned-unshielded', 'learned-shielded']) assert.equal(evaluation.results.find((r: { name: string }) => r.name === name)?.episodes, 1000);
  const unshielded = evaluation.results.find((r: { name: string }) => r.name === 'learned-unshielded'); assert.equal(unshielded.shieldInterventions, 0);
  assert.equal(evaluation.targetAchieved, unshielded.collisionFreeRate >= 0.95);
  const comparison = json('pure-dqn-evaluation.json'); assert.equal(comparison.results[0].episodes, 1000); assert.equal(comparison.shieldUsed, false);
  assert.equal(comparison.environmentVersion, ENVIRONMENT_VERSION); assert.equal(comparison.settings.planeAngularHalfWidth, 0.061);
});
