# Smart watch release review

Reviewed 2026-10-05. The user authorized development, testing, Git publication and deployment. The release adds three selectable circular watch faces, 364 cited thoughts and a larger visibly flying aircraft. The retrained language candidate remains experimental: the public watch serves source-reviewed sentences and blocks neural weights/runtime downloads.

## Presentation

Every style has the same circular steel case and crown, including the new Companion face. The visible **Thought layout** control selects Inside dial, Around rim or Companion face. Links may set `?watchStyle=arc` or `?watchStyle=card`; the public component/API accepts `thoughtStyle: 'dial' | 'arc' | 'card'`.

Inside dial paints the complete thought in the upper half behind the hands, without a text rectangle. Hour/minute hands are shortened 22% with 45% opacity; the second hand has 65% opacity. Around rim follows a top semicircle above the minute indices and below the outer shell, retaining every word and natural spacing. Companion face places a traditional circular clock at the upper right, working mode controls at the left, and a complete styled answer below with its source footer. The readable external 18 px caption remains available in every style.

The answer interval supports 2–60 seconds; 20 seconds remains the default. Aircraft flight defaults to Sweeping even when the device requests reduced motion, following the user's explicit preference. Respect device and Ticking remain selectable. The white 2× aircraft travels around the full outer ring with a subtle glow and a collision footprint matching its rounded painted silhouette. No Chronos branding is visible.

## Facts, data and actual training

The display registry contains 364 facts: the 34 original AI/profile/WHO entries are preserved, plus 330 new original paraphrases across mathematics 70, AI 80, finance 40, robotics 40, vision 30, healthcare 20, science 30 and security 20. The AI field includes the 12 original core AI facts as well as the 80 new entries. A visible Knowledge field selector filters those subjects; `watchField` and the `knowledgeDomain` API option provide equivalent initialization.

Primary-source references were checked by agents, with an independent agent audit; independent human or clinical review is not claimed. Educational finance and health/governance facts make no personalized investment or treatment recommendations. The current registry has 43 source groups and 44 distinct reference URLs. One JVP citation was corrected after training to the precise official API page. The original frozen training registry and corpus hashes remain recorded; every conditioning prompt and target token ID is unchanged. That metadata correction is not represented as new training.

The deterministic expanded corpus contains 2,720 examples, split by connected source/fact/scenario groups before augmentation: 1,475 training, 536 validation and 709 test. Prompt variants are not additional independent facts. Two fresh CPU training runs each completed 5,000 optimizer updates without pretrained weights or paid teachers. The four-layer 192-wide GQA transformer has 2,361,024 parameters, tied 4096-token vocabulary capacity and context 256. Validation-only comparison selected the 1024-used-token checkpoint at step 1000; normalized answer-byte validation NLL was 2.5369 bits versus 3.7561 for the comparison tokenizer. No test generation selected a checkpoint.

The raw test suite had 709 held-out examples plus 30 adversarial prompts. It produced **0/665 exact factual answers**. All 50/739 exact outputs were abstentions, including 44 missing-evidence cases. Only 328/739 outputs were complete within the 20-word limit, with substantial repetition. Independent support/safety metrics remain unknown. Consequently the neural release gate remains closed; public model artifacts document the experiment, while the watch labels and displays reviewed source sentences. No substituted fallback is counted as model accuracy.

Fifteen Python/ONNX parity cases passed. Fifteen isolated browser CPU/WASM cases also passed, maximum logit error 8.58e-6. The benchmark measured 370.9 ms cold initialization, 25.5 ms reference prefill and 0.8–2.5 ms short cached steps. Those numerical fixtures do not measure useful accepted-sentence latency. [Language training and provenance](watch-language.md) includes the split, resumption/export commands, source audit, selection evidence and raw outputs.

## Aircraft learning and conditional results

The 1,699-parameter aircraft policy uses real Double DQN with 20,000 expert warmstart steps and 500,000 simulation steps. A pure Double DQN comparison also completed 500,000 steps. Learn performs genuine bounded worker updates; a 4096-transition replay buffer is 552,960 bytes, with pause/reset/cleanup and checkpoint compatibility checks. Safety assist is labelled and checks reachable paths.

Fresh seeds 1,000,000–1,000,999 evaluated 1,000 one-minute episodes per controller in the v4 environment:

| Controller | Collision-free episodes |
|---|---:|
| Fixed middle |0/1,000|
| Random |0/1,000|
| Deterministic look-ahead |1,000/1,000|
| Hybrid learned policy, unassisted |1,000/1,000|
| Hybrid + Safety assist |1,000/1,000|
| Pure Double DQN |480/1,000|

The hybrid passes its 95% finite-suite target (Wilson interval 99.62–100%). Safety assist intervened 0 times across 1,200,000 decisions. Deterministic look-ahead matched the hybrid; these results do not show learning superiority. The larger v4 silhouette and changed lane centers alter the feasibility-conditioned layout distribution: impossible proposed central clouds are rejected before spawning, with unchanged cloud-size proposals and no deletion of existing clouds. Rates are not directly comparable to v3's 70.3% unassisted result. They establish neither universal safety nor real aircraft capability. [Aircraft pipeline](watch-plane.md) and the hashed public evaluation preserve the evidence.

## Validation and practical limits

The final checkout passed 538 TypeScript tests in 83 suites,7 Python pipeline checks, Astro checks for 145 files with zero errors/warnings, unchanged build/vector/privacy budget gates, localization coverage (23 HTML pages /1,127 source strings), worker type checks and the no-cost provider smoke suite. Existing chat retrieval hedged or declined all 88 unanswerable cases.

Twenty-one isolated Chrome browser checks cover lazy activation, all modes, retrieval/medical abstention, blocked experimental downloads, branding removal,2-second rotation, responsive/compact behavior, cache recovery, two clock fixtures, offscreen suspension, shortened transparent hands, unboxed upper text and continuous default flight. All 364 sentences were measured at three widths in each style:1,092 default-dial cases plus 2,184 rim/companion cases. The rim remains inside the case above the indices; companion text remains within the circular face. Rim font can reach 8.25 SVG units. Companion font is 20 SVG units, about 11.55 physical pixels at a 320 px viewport; the full external caption remains 18 px. Desktop/mobile viewport screenshots were inspected. These are desktop browser emulations, not physical-device tests.

On Apple M 3 Pro, macOS 27.2, Chrome/154.0.8037.98, an eight-second foreground sample recorded 481 frames: median 16.7 ms, p 9516.7 ms and p 9916.8 ms. Maximum displayed clock/aircraft phase difference was 0.000003230 radians. Sample JavaScript heap was 3.1 MB, excluding native/WASM/GPU memory and process RSS. Real online learning progressed and stopped, and five mount/unmount cycles passed. The machine review binds the benchmark to the exact app asset hash.

Physical devices, Safari/Firefox, WebGPU, quantization, long-running memory and the 96 MiB resident-memory target remain unverified. The watch has no accounts or cloud chat and keeps local questions/settings on the device. No private documents, raw recordings or credentials are published. Public deferred watch assets remain below the 50 MB cap. [Machine review](chronos-watch-review.json) binds the release to exact source and asset hashes.

## Reproduce and deploy

```sh
npm ci
npm ci --prefix worker
npm run check
npm run build
npm test
npm run check:build -- --vectors
npm run check:i18n
npm run eval:chat
npx tsc -p worker/tsconfig.json --noEmit
npm run chat:smoke
node scripts/watch/serve-preview.mjs build 4347
# Separate terminal, isolated installed Chrome:
WATCH_QA_URL=http://127.0.0.1:4347 node scripts/watch/browser-qa.mjs
WATCH_QA_URL=http://127.0.0.1:4347/smart-watch/ node scripts/watch/layout-qa.mjs
WATCH_QA_URL=http://127.0.0.1:4347 node scripts/watch/benchmark-ui.mjs
```

The GitHub Actions incident delayed runner assignment, so the same tested build is deployed directly on the existing Cloudflare `demtsev-portfolio` gateway. Two unchanged videos above 25 MiB remain on the existing GitHub range origin; other assets and pages are served directly until the exact `/watch/release.json` marker reaches GitHub. A positive marker match persists in ORIGIN_STATE KV, allowing subsequent ordinary GitHub updates to continue automatically. GitHub Pages' custom domain remains unset to avoid proxy loops. The Worker forwards only read/range/cache headers, strips cookies and response cookies, and preserves canonical redirects and HSTS. Its public config contains no OAuth credentials.

Direct deployment uses `node worker/node_modules/wrangler/bin/wrangler.js deploy --config worker/site/wrangler.jsonc` after the build/check gates. Git commit/tree, source snapshot and deploy verification form the local release receipt. Automatic approval review rejected an optional external Ruflo memory upload because the destination was unauthorized; receipts remain local and Git-bound.
