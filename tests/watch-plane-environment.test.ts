import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaneEnvironment, ANGULAR_SPEED, PHYSICS_DT, advanceRadial, sweptCloudCollision, reachable, lookAheadAction, type Cloud } from '../src/lib/watch/plane/environment.ts';

test('seeded environment is deterministic, bounded, observable, and rotates once per60seconds', () => {
  const a = new PlaneEnvironment(4242); const b = new PlaneEnvironment(4242);
  assert.deepEqual(a.clouds, b.clouds); assert.equal(a.observation().length, 16); assert.ok(a.clouds.length <= 3);
  for (let i = 0; i < 1200; i++) { const action = lookAheadAction(a); const x = a.step(action); const y = b.step(action); assert.deepEqual(x, y); if (x.terminal) break; }
  assert.equal(a.terminal, false); assert.ok(Math.abs(a.time * ANGULAR_SPEED - Math.PI * 2) < 1e-10);
  assert.ok(a.radial >= 0.05 && a.radial <= 0.95); assert.ok(a.clouds.every(c => c.centerTime - a.time < 9.1));
});

test('observations keep trailing clouds until physical clearance and absent sentinel is distinct', () => {
  const env = new PlaneEnvironment(3, {}, 55); const cloud = env.clouds[0]!;
  env.time = cloud.centerTime + cloud.angularHalfWidth / ANGULAR_SPEED; env.radial = cloud.radial < 0.5 ? 0.85 : 0.15;
  assert.ok(env.observation()[4]! < 0); env.step(env.radial < 0.5 ? 0 : 2); assert.ok(env.clouds.some(c => c.id === cloud.id));
  env.clouds = []; assert.deepEqual(Array.from(env.observation().subarray(4)), [-2, -2, 0, 0, -2, -2, 0, 0, -2, -2, 0, 0]);
});

test('swept collision catches tunneling and reachability tests actual transitions', () => {
  const cloud: Cloud = { id: 1, centerTime: 1, radial: 0.5, angularHalfWidth: 0.01, radialHalfWidth: 0.05, appearance: 0, bornTime: 0 };
  assert.equal(sweptCloudCollision({ radial: 0.5, velocity: 0 }, { radial: 0.5, velocity: 0 }, 0, 2, cloud), true);
  assert.equal(sweptCloudCollision({ radial: 0.1, velocity: 0 }, { radial: 0.1, velocity: 0 }, 0, 2, cloud), false);
  assert.equal(reachable({ radial: 0.5, velocity: 0 }, 0, [cloud]), true);
  assert.equal(reachable({ radial: 0.5, velocity: 0 }, 0, [{ ...cloud, centerTime: 0.01, radialHalfWidth: 1 }]), false);
  let state = { radial: 0.5, velocity: 0 }; for (let i = 0; i < 300; i++) state = advanceRadial(state, 2, PHYSICS_DT);
  assert.ok(Math.abs(state.radial - 0.85) < 0.01); assert.ok(Math.abs(state.velocity) < 0.03);
});
