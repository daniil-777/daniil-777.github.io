import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { createHash } from 'node:crypto';
import { PlaneEnvironment } from '../../src/lib/watch/plane/environment.ts';
import { argmax, forward, validateCheckpoint, workspace } from '../../src/lib/watch/plane/network.ts';
const raw = readFileSync('public/watch/plane/policy.json'); const checkpoint = validateCheckpoint(JSON.parse(raw.toString()));
const weights = new Float32Array(checkpoint.weights); const work = workspace(); const states: Float32Array[] = [];
let environment = new PlaneEnvironment(32941);
for (let i = 0; i < 1000; i++) {
  states.push(environment.observation());
  const result = environment.step(argmax(forward(weights, states.at(-1)!, work).q));
  if (result.terminal) environment = new PlaneEnvironment(32941 + i, {}, i % 60);
}
for (let i = 0; i < 10000; i++) forward(weights, states[i % states.length]!, work);
const durations = [];
for (let i = 0; i < 50000; i++) { const at = performance.now(); forward(weights, states[i % states.length]!, work); durations.push((performance.now() - at) * 1000); }
const sorted = durations.toSorted((a, b) => a - b);
const report = { format: 'chronos-plane-node-benchmark-v1', measuredAt: new Date().toISOString(), checkpointSha256: createHash('sha256').update(raw).digest('hex'),
  device: cpus()[0]?.model, os: `${platform()} ${release()}`, runtime: process.version, provider: 'JavaScript CPU', gpuMlAllocationsBytes: 0,
  methodology: '10,000 warmup forwards;50,000 timed reused-workspace forwards across1,000 real simulation observations. Includes per-call timer overhead. This is Node, not a browser/frame benchmark.',
  samples: durations.length, meanMicroseconds: durations.reduce((a, b) => a + b, 0) / durations.length,
  p50Microseconds: sorted[Math.floor(sorted.length * 0.5)], p95Microseconds: sorted[Math.floor(sorted.length * 0.95)], p99Microseconds: sorted[Math.floor(sorted.length * 0.99)],
  parameterBytes: weights.byteLength, forwardWorkspaceBytes: work.hidden1.byteLength + work.hidden2.byteLength + work.q.byteLength,
  processMemory: process.memoryUsage(), peakProcessRssKiB: process.resourceUsage().maxRSS, memoryLimitations: 'Whole-process Node memory includes TypeScript/runtime, benchmark states and timings; not incremental browser memory.' };
writeFileSync('public/watch/plane/benchmark-node.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
