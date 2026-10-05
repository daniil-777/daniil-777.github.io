import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaneController } from '../src/lib/watch/plane/controller.ts';
import { ANGULAR_SPEED, wrapAngle } from '../src/lib/watch/plane/environment.ts';
import { DQNTrainer } from '../src/lib/watch/plane/trainer.ts';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('plane phase follows rendered seconds exactly through minute wrap, time correction, collision reset and pause/resume', () => {
  const controller = createPlaneController({ phaseOffset: 0.2, shield: true });
  const trainer = new DQNTrainer(); trainer.steps = 1; controller.setPolicy(trainer.checkpoint());
  let phase = 59.95; controller.sync(phase);
  for (let i = 0; i < 3000; i++) {
    phase = (phase + 1 / 60) % 60; const state = controller.tick(phase, 1 / 60);
    assert.ok(Math.abs(wrapAngle(state.angle - (phase * ANGULAR_SPEED + 0.2))) < 1e-12);
    assert.ok(state.radial >= 0.05 && state.radial <= 0.95); assert.ok(state.clouds.length <= 3);
  }
  controller.setPaused(true); const before = controller.tick(12, 2); assert.equal(before.paused, true);
  controller.setPaused(false); const resumed = controller.tick(18.2, 6.2); assert.equal(resumed.paused, false);
  assert.equal(resumed.radial, 0.5); assert.ok(Math.abs(resumed.angle - (18.2 * ANGULAR_SPEED + 0.2)) < 1e-12);
  assert.equal(resumed.diagnostics.shieldEnabled, true); controller.dispose(); assert.equal(controller.tick(19, 1).loaded, false);
});

test('unloaded controller exposes unavailable state and ignores a stale checkpoint after dispose', async () => {
  const controller = createPlaneController(); assert.equal(controller.tick(3, 0).loaded, false);
  const originalFetch = globalThis.fetch; let resolve!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch;
  try {
    const request = controller.loadPolicy(); controller.dispose(); const trainer = new DQNTrainer(); trainer.steps = 1;
    resolve(new Response(JSON.stringify(trainer.checkpoint()))); await request;
    assert.equal(controller.tick(4, 0).loaded, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('real deployed checkpoint is hash-verified and corrupt downloads remain unavailable', async () => {
  const originalFetch = globalThis.fetch; const raw = readFileSync(new URL('../public/watch/plane/policy.json', import.meta.url), 'utf8');
  const checkpoint = JSON.parse(raw); const manifest = { checkpointSha256: createHash('sha256').update(raw).digest('hex'), environmentVersion: checkpoint.environmentVersion };
  try {
    globalThis.fetch = (async (url: string | URL | Request) => new Response(String(url).endsWith('manifest.json') ? JSON.stringify(manifest) : raw)) as typeof fetch;
    const controller = createPlaneController(); await controller.loadPolicy(); assert.equal(controller.tick(4, 0).loaded, true); controller.dispose();
    globalThis.fetch = (async (url: string | URL | Request) => new Response(String(url).endsWith('manifest.json') ? JSON.stringify({ ...manifest, checkpointSha256: 'invalid' }) : raw)) as typeof fetch;
    const corrupt = createPlaneController(); await assert.rejects(corrupt.loadPolicy(), /integrity/); assert.equal(corrupt.tick(4, 0).loaded, false); assert.match(corrupt.tick(4, 0).diagnostics.loadError ?? '', /integrity/); corrupt.dispose();
  } finally { globalThis.fetch = originalFetch; }
});

test('disposal aborts an in-flight checkpoint fetch and does not publish a stale error/result', async () => {
  const originalFetch = globalThis.fetch; let signal: AbortSignal | null = null;
  globalThis.fetch = ((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = options?.signal ?? null; signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch;
  try {
    const controller = createPlaneController(); const pending = controller.loadPolicy(); controller.dispose(); await pending;
    assert.equal((signal as AbortSignal | null)?.aborted, true); assert.equal(controller.tick(5, 0).loaded, false); assert.equal(controller.tick(5, 0).diagnostics.loadError, null);
  } finally { globalThis.fetch = originalFetch; }
});
