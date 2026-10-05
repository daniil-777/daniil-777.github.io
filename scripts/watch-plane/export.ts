import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ENVIRONMENT_VERSION, DEFAULT_SETTINGS } from '../../src/lib/watch/plane/environment.ts';
import { validateCheckpoint, PARAMETER_COUNT } from '../../src/lib/watch/plane/network.ts';
const path = 'public/watch/plane/'; const raw = readFileSync(path + 'policy.json'); const checkpoint = validateCheckpoint(JSON.parse(raw.toString()));
if (checkpoint.environmentVersion !== ENVIRONMENT_VERSION) throw new Error('Exported policy does not match shared environment');
const evaluation = JSON.parse(readFileSync(path + 'evaluation.json', 'utf8'));
const hash = createHash('sha256').update(raw).digest('hex'); if (evaluation.checkpointSha256 !== hash) throw new Error('Evaluation belongs to a different checkpoint');
const manifest = { format: 'chronos-plane-manifest-v1', environmentVersion: ENVIRONMENT_VERSION, architecture: checkpoint.architecture, parameters: PARAMETER_COUNT, dtype: 'float32', rawParameterBytes: PARAMETER_COUNT * 4,
  checkpointSha256: hash, checkpointBytes: raw.byteLength, checkpointGzipBytes: gzipSync(raw).byteLength, checkpointPath: '/watch/plane/policy.json',
  trainingMethod: checkpoint.trainingMethod, trainingSteps: checkpoint.trainingSteps, expertWarmstartSteps: checkpoint.expertWarmstartSteps, expertLossWeight: checkpoint.expertLossWeight,
  settings: DEFAULT_SETTINGS, evaluationPath: '/watch/plane/evaluation.json', evaluation, intendedLimit: 'Clock-phase-locked radial aircraft control on the documented reachable distribution; optional separately labeled deterministic Safety assist.' };
writeFileSync(path + 'manifest.json', JSON.stringify(manifest, null, 2)); console.log(JSON.stringify({ parameters: manifest.parameters, bytes: manifest.checkpointBytes, gzipBytes: manifest.checkpointGzipBytes, hash, targetAchieved: evaluation.targetAchieved }));
