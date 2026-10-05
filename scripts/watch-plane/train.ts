import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, platform, release, arch } from 'node:os';
import { DQNTrainer } from '../../src/lib/watch/plane/trainer.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/watch/plane/environment.ts';
const args = Object.fromEntries(process.argv.slice(2).map((value, i, values) => value.startsWith('--') ? [value.slice(2), values[i + 1]] : null).filter(Boolean) as [string, string][]);
const steps = Number(args.steps ?? 100000); const output = args.output ?? 'public/watch/plane/policy.json';
if (!Number.isSafeInteger(steps) || steps < 1000 || steps > 2000000) throw new Error('steps must be an integer between 1000 and 2000000');
const trainer = new DQNTrainer({ seed: Number(args.seed ?? 82419), learningRate: Number(args.lr ?? 0.001), epsilonDecay: Number(args.decay ?? 50000), epsilonFloor: Number(args.epsilon ?? 0.05), discount: Number(args.discount ?? 0.99), targetEvery: Number(args.target ?? 500), expertLossWeight: Number(args.expert ?? 0), expertWarmstartSteps: Number(args.warmstart ?? 0) });
const beforeHash = createHash('sha256').update(Buffer.from(trainer.weights.buffer)).digest('hex');
const started = performance.now(); const logs = [];
for (let step = 0; step < steps; step++) {
  trainer.step();
  if (trainer.steps % 10000 === 0) { const metric = { ...trainer.metrics(), elapsedSeconds: (performance.now() - started) / 1000 }; logs.push(metric); console.log(JSON.stringify(metric)); }
  if (args.snapshots && trainer.steps % 50000 === 0) { mkdirSync(args.snapshots, { recursive: true }); writeFileSync(`${args.snapshots}/policy-${trainer.steps}.json`, JSON.stringify(trainer.checkpoint())); }
}
const serialized = JSON.stringify(trainer.checkpoint()); mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true }); writeFileSync(output, serialized);
const record = { trainedAt: new Date().toISOString(), node: process.version, device: cpus()[0]?.model, platform: `${platform()} ${release()} ${arch()}`, config: trainer.config,
  environment: DEFAULT_SETTINGS, wallSeconds: (performance.now() - started) / 1000, stepsPerSecond: steps / ((performance.now() - started) / 1000),
  checkpointBytes: Buffer.byteLength(serialized), parameters: trainer.weights.length, parameterBytes: trainer.weights.byteLength,
  checkpointSha256: createHash('sha256').update(serialized).digest('hex'), beforeWeightsSha256: beforeHash,
  afterWeightsSha256: createHash('sha256').update(Buffer.from(trainer.weights.buffer)).digest('hex'), processMemory: process.memoryUsage(), peakProcessRssKiB: process.resourceUsage().maxRSS,
  metrics: trainer.metrics(), rewardComponents: trainer.rewardTotals, expertLabelCount: trainer.expertLabelCount, logs };
writeFileSync(output.replace(/\.json$/, '-training.json'), JSON.stringify(record, null, 2)); console.log(JSON.stringify({ output, ...record.metrics, wallSeconds: record.wallSeconds }));
