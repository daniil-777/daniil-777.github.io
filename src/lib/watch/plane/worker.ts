import { DQNTrainer, type TrainingMetrics } from './trainer.ts';
import { validateCheckpoint, type PolicyCheckpoint } from './network.ts';
import { PlaneEnvironment, PHYSICS_DT } from './environment.ts';
import { argmax, forward, workspace } from './network.ts';

type Request = { type: 'start'; checkpoint: PolicyCheckpoint; paused?: boolean } | { type: 'pause'; paused: boolean } | { type: 'reset'; checkpoint?: PolicyCheckpoint };
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: unknown) => void };
let trainer: DQNTrainer | null = null; let initial: PolicyCheckpoint | null = null; let paused = true; let timer: ReturnType<typeof setTimeout> | null = null;
let lastPublished = 0; let acceptedScore = -1; let evaluating: { checkpoint: PolicyCheckpoint; env: PlaneEnvironment; episode: number; safe: number; steps: number; initial?: boolean } | null = null;
const work = workspace();
function metrics(): TrainingMetrics | null { return trainer ? { ...trainer.metrics(), steps: trainer.steps - (initial?.trainingSteps ?? 0), pretrainedSteps: initial?.trainingSteps ?? 0 } : null; }
function loop(): void {
  timer = null;
  if (!trainer || paused) return;
  const until = performance.now() + 2;
  while (performance.now() < until) {
    if (evaluating) {
      const action = argmax(forward(evaluating.checkpoint.weights, evaluating.env.observation(), work).q);
      const result = evaluating.env.step(action); evaluating.steps++;
      if (result.terminal || evaluating.steps >= 60 / PHYSICS_DT) {
        if (!result.terminal) evaluating.safe++; evaluating.episode++; evaluating.steps = 0;
        if (evaluating.episode >= 20) {
          const score = evaluating.safe / 20;
          if (evaluating.initial) acceptedScore = score;
          else if (score >= acceptedScore) { acceptedScore = score; scope.postMessage({ type: 'policy', checkpoint: evaluating.checkpoint, validation: { episodes: 20, collisionFreeRate: score }, metrics: metrics() }); }
          evaluating = null;
        } else evaluating.env = new PlaneEnvironment(900000 + evaluating.episode, {}, evaluating.episode * 2.13);
      }
    } else trainer.step();
    if (!evaluating && trainer.steps - lastPublished >= 2000) {
      lastPublished = trainer.steps; evaluating = { checkpoint: trainer.checkpoint(), env: new PlaneEnvironment(900000), episode: 0, safe: 0, steps: 0 };
    }
  }
  scope.postMessage({ type: 'metrics', metrics: metrics(), validationActive: !!evaluating, trackedArrayBytes: trainer.replay.bytes + trainer.weights.byteLength * 4 + trainer.gradient.byteLength });
  timer = setTimeout(loop, 100);
}
scope.onmessage = (event: MessageEvent<Request>): void => {
  const request = event.data;
  if (request.type === 'start') {
    initial = validateCheckpoint(request.checkpoint); trainer = new DQNTrainer({ seed: 61417, epsilonFloor: 0.1, learningRate: 0.0002, curriculumSteps: 0 }, initial);
    lastPublished = trainer.steps; paused = request.paused ?? false;
    evaluating = { checkpoint: initial, env: new PlaneEnvironment(900000), episode: 0, safe: 0, steps: 0, initial: true };
  } else if (request.type === 'pause') paused = request.paused;
  else if (request.type === 'reset' && initial) { if (request.checkpoint) initial = validateCheckpoint(request.checkpoint); trainer = new DQNTrainer({ seed: 61417, epsilonFloor: 0.1, learningRate: 0.0002, curriculumSteps: 0 }, initial); lastPublished = trainer.steps; evaluating = { checkpoint: initial, env: new PlaneEnvironment(900000), episode: 0, safe: 0, steps: 0, initial: true }; acceptedScore = -1; }
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (!paused && trainer) timer = setTimeout(loop, 0);
};
