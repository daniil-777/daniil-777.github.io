# Chronos aircraft policy

This is a real trained 16→32→32→3 ReLU Q-network: 1,699 parameters, 6,796 raw FP32 bytes. The browser runs only its forward pass unless the visitor explicitly enables **Learn**. Outputs are Q-values, not probabilities.

The deployed checkpoint is **hybrid Double DQN**, trained from random initialization with a conservative lane expert for the first 20,000 experience steps and an expert large-margin regularizer thereafter. It also receives genuine Bellman/Huber updates from randomized simulation experience. This is not a claim that pure DQN learned the behavior unaided or beats a deterministic controller. The pure-DQN comparison, unshielded hybrid policy, deterministic look-ahead, random actions and fixed-middle baseline are reported separately in `public/watch/plane/`.

## Reproduce

Use Node 24 or newer, without a training framework or extra package:

```sh
node --test tests/watch-plane*.test.ts
node scripts/watch-plane/train.ts --steps 500000 --seed 82423 --lr 0.0005 --decay 100000 --epsilon 0.02 --discount 0.99 --target 100 --expert 16 --warmstart 20000 --output public/watch/plane/policy.json
node scripts/watch-plane/evaluate.ts --episodes 1000 --seed 700000 --checkpoint public/watch/plane/policy.json --output public/watch/plane/evaluation.json
node scripts/watch-plane/train.ts --steps 500000 --seed 82421 --lr 0.0001 --decay 100000 --epsilon 0.02 --discount 0.99 --target 100 --output public/watch/plane/pure-dqn-comparison.json
node scripts/watch-plane/evaluate.ts --episodes 1000 --seed 700000 --checkpoint public/watch/plane/pure-dqn-comparison.json --only learned-unshielded --output public/watch/plane/pure-dqn-evaluation.json
node scripts/watch-plane/export.ts
node scripts/watch-plane/benchmark.ts
```

The corresponding `*-training.json` records the exact config, every reward component, initialization/final weight hashes, wall time, actual array sizes and Node process memory. The deployed expert-margin coefficient is16: strong supervised regularization is deliberate and must not be mistaken for unaided RL. Policy weights are finite numbers and a SHA-256 manifest protects the shipped checkpoint against missing/corrupt assets. Model assets are retained in a bounded two-entry CacheStorage cache for a subsequent offline load; first use requires downloading them. No GPU or cloud service is used for the aircraft.

## Physics and distribution

- `theta = sharedClockSeconds × 2π/60 + phaseOffset`; reinforcement learning changes radial motion only.
- Physics/control is 20 Hz. Normalized lane centers are `.15`, `.5`, `.85`; maximum speed `.7` track widths per second, acceleration `2.8` track widths per second squared.
- Aircraft has a heading-invariant bounding ellipse with radial halfwidth `.13`, angular halfwidth `.023` radians. On the 162–195 viewBox-unit track, the rendered aircraft is scaled to 5.28×6.8 units plus a .24-unit stroke; that silhouette fits within the conservative physical envelope at every heading. Position is constrained so its full bounding geometry stays within the track.
- Cloud radial centers are uniformly `.2–.8`; radial halfwidths `.10–.18`, angular halfwidths `.028–.052` radians. Collision geometry is stable through an encounter. Appearance randomness does not move it.
- Initial cloud lead is `3–3.5` seconds, subsequent candidate spacing `3.4–4.6` seconds. Candidates outside the `4.2`-second observable forward horizon wait for a later step. At most three clouds are retained, including overlapping trailing clouds. This distribution normally has one or two, not three simultaneously dense obstacles.
- Every new arrangement is certified by an executable time-indexed trajectory from the **actual** radial position and velocity. Full constant-target trajectories provide a fast certificate; otherwise a quantized search retains real safe trajectories. Pruning may reject a reachable arrangement, but does not create a false certificate. A previously present cloud is never removed to rescue a policy.
- Swept segment/expanded-ellipse intersections prevent tunneling. Clouds clear only after their trailing edge plus the aircraft angular footprint has passed.
- Terminal collisions receive `−2`; survival `+.08/second`; safely cleared clouds `+.4`; speed cost `−.015 × |v|/second`; acceleration cost `−.0008 × |Δv|`. A state-only clearance potential of strength `.4` supplies dense shaping through `.99 Φ(next) − Φ(current)`; terminal potential is zero. All components are logged. Time-limit truncations continue TD bootstrapping.
- A sparse initial 15,000-step curriculum uses spacing `5–6.5` seconds and a `.17` maximum radial cloud halfwidth, followed by the full distribution. Exploration decreases from one to `.02` by 100,000 steps.

Observations are radial position, velocity/maxSpeed, sin/cos clock phase and three sorted cloud records `[wrappedRelativeAngle/(angularSpeed×4.2), radialCenter, angularHalfWidth/.052, radialHalfWidth/.25]`. The absent sentinel is `[-2,-2,0,0]`, outside valid geometric ranges. A cloud stays observable through physical clearance.

## Integration

```ts
import { createPlaneController } from '../src/lib/watch/plane/controller';
const plane = createPlaneController({ shield: true });
await plane.loadPolicy();
const state = plane.tick(secondsIncludingMilliseconds, elapsedFrameSeconds);
// state.angle: clockwise radians from12; state.radial: normalized track coordinate.
// state.heading: actual velocity heading, clockwise radians from12.
// Map cloud geometry onto the same 162–195 annulus; ellipse dimensions are collision dimensions.
plane.sync(secondsIncludingMilliseconds); // tab resume / clock correction
plane.setPaused(true);                     // hidden / offscreen / reduced motion
plane.setLearning(true);                   // opt-in worker, never part of RAF
plane.resetLearning();
plane.dispose();
```

`tick` always takes its orbital phase from the actual shared clock. A correction larger than250ms, a suspended tab or a collision resets the interrupted episode at the **current displayed phase**. Radial rendering uses bounded fixed-step interpolation. `heading` incorporates the actual radial/tangential velocity; `bank` is a separate restrained styling signal.

If Safety assist is enabled, its deterministic look-ahead replacement is counted in `diagnostics.shieldInterventions` and must be labeled in the interface. Unshielded evaluation is authoritative for the learned policy. Shielded performance must not be attributed entirely to learning.

The optional worker performs genuine gradient updates in accelerated simulation with a nominal two milliseconds per100ms. Before accepting a changed policy it compares20 fixed seeded one-minute validation episodes to the current accepted policy. This small promotion check is not a universal safety guarantee. The worker pauses with visibility and contains only simulation geometry. Replay holds4,096 transitions with one additional expert-label byte each: **552,960 bytes** of typed storage; other arrays/runtime memory are additional. Only one compatible local checkpoint is retained, and reset returns to the published checkpoint.

## Limitations

The frozen release evaluation uses1,000 one-minute episodes for each controller, with seeds700000–700999, disjoint from the500000-range tuning suite. The identical documented reachable distribution produced:

| Controller | Collision-free episodes | Rate |95% Wilson interval |
|---|---:|---:|---:|
| Fixed middle |0/1,000 |0% |0–0.38% |
| Random lane requests |0/1,000 |0% |0–0.38% |
| Deterministic look-ahead |1,000/1,000 |100% |99.62–100% |
| Pure Double DQN comparison |91/1,000 |9.1% |7.47–11.04% |
| Hybrid learned policy, unshielded |922/1,000 |92.2% |90.37–93.71% |
| Hybrid policy + Safety assist |999/1,000 |99.9% |99.44–99.98% |

**The unshielded95% target was not achieved.** Safety assist intervened1,117 times across1,199,210 control decisions; its contribution is reported separately. The deterministic controller outperformed the learned policy. The deployed model is an educational hybrid learned controller with a conservative optional safety layer, not a claim that RL is necessary or superior for this task.

On an Apple M3 Pro, Darwin27.2.0, Node24.18.0, the release checkpoint took approximately52.09 seconds for500,000 environment steps and124,873 Bellman training updates. A separate warmed50,000-sample Node forward benchmark measured mean1.98μs, median1.92μs, p95 2.04μs, p99 2.96μs including timer overhead. The actual JSON checkpoint is recorded in `manifest.json` with raw/gzip bytes and SHA-256; parameter storage remains6,796 bytes and forward workspace268 bytes.

Training episode metrics include exploration and differ from frozen evaluation. Node policy timings are not browser timings. Node RSS is whole-process memory, not an isolated browser worker measurement. Exact browser worker/process memory, mobile performance and online learning resource adaptation require the parent widget's browser release review. The finite seeded distribution and geometric collision model do not prove safety for arbitrary configurations or all SVG silhouettes.
