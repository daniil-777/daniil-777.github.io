import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { ANGULAR_SPEED, DEFAULT_SETTINGS, PHYSICS_DT, PlaneEnvironment, isActionSafe, lookAheadAction, seededRandom, type LaneAction } from '../../src/lib/watch/plane/environment.ts';
import { argmax, forward, validateCheckpoint, workspace } from '../../src/lib/watch/plane/network.ts';
const args = Object.fromEntries(process.argv.slice(2).map((value, i, values) => value.startsWith('--') ? [value.slice(2), values[i + 1]] : null).filter(Boolean) as [string, string][]);
const input = args.checkpoint ?? 'public/watch/plane/policy.json'; const count = Number(args.episodes ?? 1000); const seedStart = Number(args.seed ?? 500000);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000 || !Number.isSafeInteger(seedStart) || seedStart < 0 || seedStart + count > 0xffffffff) throw new Error('Invalid evaluation count/seed range');
const raw = readFileSync(input, 'utf8'); const checkpoint = validateCheckpoint(JSON.parse(raw)); const weights = new Float32Array(checkpoint.weights); const work = workspace();
function wilson(success: number, total: number): [number, number] { const z = 1.959963984540054; const p = success / total; const d = 1 + z * z / total; const center = (p + z * z / (2 * total)) / d; const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d; return [center - radius, center + radius]; }
const started = performance.now(); const results = [];
for (const name of (args.only ? [args.only] : ['fixed-middle', 'random', 'look-ahead', 'learned-unshielded', 'learned-shielded'])) {
  let safe = 0; let reward = 0; let passed = 0; let inferenceMs = 0; let decisions = 0; let rejected = 0; let interventions = 0;
  const random = seededRandom(271828); const at = performance.now();
  for (let i = 0; i < count; i++) {
    const environment = new PlaneEnvironment(seedStart + i, {}, (i * 13.731) % 60); let alive = true;
    for (let t = 0; t < Math.round(60 / PHYSICS_DT); t++) {
      let action: LaneAction;
      if (name === 'fixed-middle') action = 1;
      else if (name === 'random') action = Math.floor(random() * 3) as LaneAction;
      else if (name === 'look-ahead') action = lookAheadAction(environment);
      else { const before = performance.now(); action = argmax(forward(weights, environment.observation(), work).q); inferenceMs += performance.now() - before; decisions++;
        if (name === 'learned-shielded' && !isActionSafe(environment, action)) { const next = lookAheadAction(environment); if (next !== action) { action = next; interventions++; } }
      }
      const result = environment.step(action); reward += result.reward;
      if (result.terminal) { alive = false; break; }
    }
    if (alive) safe++; passed += environment.passedClouds; rejected += environment.rejectedLayouts;
  }
  const result = { name, episodes: count, collisionFreeEpisodes: safe, collisionFreeRate: safe / count, wilson95: wilson(safe, count), meanReturn: reward / count, meanPassedClouds: passed / count,
    seconds: (performance.now() - at) / 1000, policyInferenceMeanMicroseconds: decisions ? inferenceMs * 1000 / decisions : null, decisions, rejectedLayouts: rejected, shieldInterventions: interventions };
  results.push(result); console.log(JSON.stringify(result));
}
const report = { format: 'chronos-plane-evaluation-v1', evaluatedAt: new Date().toISOString(), checkpointSha256: createHash('sha256').update(raw).digest('hex'),
  environmentVersion: checkpoint.environmentVersion,
  trainingSteps: checkpoint.trainingSteps, seedStart, seedEnd: seedStart + count - 1, windowSeconds: 60, physicsHz: 1 / PHYSICS_DT, angularSpeed: ANGULAR_SPEED,
  settings: DEFAULT_SETTINGS, device: cpus()[0]?.model, node: process.version, totalSeconds: (performance.now() - started) / 1000, targetCollisionFreeRate: 0.95,
  targetAchieved: results.some(r => r.name === 'learned-unshielded' && r.collisionFreeRate >= 0.95), results, shieldUsed: results.some(r => r.shieldInterventions > 0),
  trainingMethod: checkpoint.trainingMethod ?? 'double-dqn', expertWarmstartSteps: checkpoint.expertWarmstartSteps ?? 0, expertLossWeight: checkpoint.expertLossWeight ?? 0 };
writeFileSync(args.output ?? 'public/watch/plane/evaluation.json', JSON.stringify(report, null, 2));
