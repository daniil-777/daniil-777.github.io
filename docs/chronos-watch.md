# Smart watch release review

Reviewed 2026-10-06. The user authorized development, testing, Git publication and deployment. The current release has five selectable circular watch faces and 364 cited thoughts. The aircraft is removed from every public view; its renderer, controller, trainer and evaluated checkpoints remain in the codebase. The retrained language candidate remains experimental: the public watch serves source-reviewed sentences and blocks neural weights/runtime downloads.

## Presentation

Every style has the same circular steel case and crown, including the new Companion face. The visible **Thought layout** control selects Inside dial, Around rim, Companion face, Layered face or Scrolling face. Links may set `?watchStyle=arc`, `?watchStyle=card` `?watchStyle=layered` or `?watchStyle=marquee`; the public component/API accepts `thoughtStyle: 'dial' | 'arc' | 'card' | 'layered' | 'marquee'`.

Inside dial paints the complete thought in the upper half behind the hands, without a text rectangle. Hour/minute hands are shortened 22% with 45% opacity; the second hand has 65% opacity. Around rim follows a top semicircle above the minute indices and below the outer shell, retaining every word and natural spacing. Companion face places a traditional circular clock at the upper right, working mode controls at the left, and a complete styled answer below with its source footer. Layered face puts the complete white answer strictly below the center, above full-size translucent hands. All twelve upright hour numbers and sixty minute markers sit around the outer face. Its Answer size slider supports mouse, touch and keyboard, with automatic fitting that preserves the entire sentence below the center. Scrolling face places a slender horizontal glass bar strictly below the center, above the faint hands. The bar occupies 46% of the dial width and 7.5% of its height (at least 22px): about 175 × 29px on the standard 380px watch, showing two or three words at a time. The complete sentence moves continuously right to left at 2.6 font ems per second, with a matching trailing copy for a seamless advertising-style loop, soft edge fades and safe glyph insets. Hover holds its position; tapping the bar or using Pause stops motion and automatic rotation. Respect device follows reduced-motion preferences with the same single-line, manually scrollable bar; Sweeping and Ticking explicitly animate the ticker. Every new message or return to animation resets manual scrolling to the start. The readable external 18px caption remains available in every style.

The answer interval supports 2–60 seconds; 20 seconds remains the default. Scrolling face waits for a complete reading pass before automatic replacement even at two seconds; manual Next remains immediate. Hidden/offscreen views and a closed compact dialog suspend reading. Style switches and unmount cancel their animation; resize and font-metric changes recompute travel. Clock motion defaults to Sweeping; Respect device and Ticking remain available. The retained aircraft implementation is disabled in public markup. No Chronos branding is visible. Public flight controls, clouds and aircraft diagnostics are hidden, and the watch never mounts the aircraft controller or downloads its policy/worker. A future developer can explicitly opt in through the component’s `aircraft` property; visitor settings cannot re-enable it.

## Facts, data and actual training

The display registry contains 364 facts: the 34 original AI/profile/WHO entries are preserved, plus 330 new original paraphrases across mathematics 70, AI 80, finance 40, robotics 40, vision 30, healthcare 20, science 30 and security 20. The AI field includes the 12 original core AI facts as well as the 80 new entries. A visible Knowledge field selector filters those subjects; `watchField` and the `knowledgeDomain` API option provide equivalent initialization.

Primary-source references were checked by agents, with an independent agent audit; independent human or clinical review is not claimed. Educational finance and health/governance facts make no personalized investment or treatment recommendations. The current registry has 43 source groups and 44 distinct reference URLs. One JVP citation was corrected after training to the precise official API page. The original frozen training registry and corpus hashes remain recorded; every conditioning prompt and target token ID is unchanged. That metadata correction is not represented as new training.

The deterministic expanded corpus contains 2,720 examples, split by connected source/fact/scenario groups before augmentation: 1,475 training, 536 validation and 709 test. Prompt variants are not additional independent facts. Two fresh CPU training runs each completed 5,000 optimizer updates without pretrained weights or paid teachers. The four-layer 192-wide GQA transformer has 2,361,024 parameters, tied 4096-token vocabulary capacity and context 256. Validation-only comparison selected the 1024-used-token checkpoint at step 1000; normalized answer-byte validation NLL was 2.5369 bits versus 3.7561 for the comparison tokenizer. No test generation selected a checkpoint.

The raw test suite had 709 held-out examples plus 30 adversarial prompts. It produced **0/665 exact factual answers**. All 50/739 exact outputs were abstentions, including 44 missing-evidence cases. Only 328/739 outputs were complete within the 20-word limit, with substantial repetition. Independent support/safety metrics remain unknown. Consequently the neural release gate remains closed; public model artifacts document the experiment, while the watch labels and displays reviewed source sentences. No substituted fallback is counted as model accuracy.

Fifteen Python/ONNX parity cases passed. Fifteen isolated browser CPU/WASM cases also passed, maximum logit error 8.58e-6. The benchmark measured 370.9 ms cold initialization, 25.5 ms reference prefill and 0.8–2.5 ms short cached steps. Those numerical fixtures do not measure useful accepted-sentence latency. [Language training and provenance](watch-language.md) includes the split, resumption/export commands, source audit, selection evidence and raw outputs.

## Retained aircraft experiment and conditional results

The disabled aircraft implementation retains a 1,699-parameter policy using real Double DQN with 20,000 expert warmstart steps and 500,000 simulation steps. A pure Double DQN comparison also completed 500,000 steps. Learn performs genuine bounded worker updates; a 4096-transition replay buffer is 552,960 bytes, with pause/reset/cleanup and checkpoint compatibility checks. Safety assist is labelled and checks reachable paths.

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

The final checkout passed 547 TypeScript tests in 83 suites, 7 Python pipeline checks, Astro checks for 150 files with zero errors/warnings, unchanged build/vector/privacy budget gates, localization coverage (23 HTML pages / 1,127 source strings), worker type checks and the no-cost provider smoke suite. Existing chat retrieval hedged or declined all 88 unanswerable cases.

Twenty-one isolated Chrome browser checks cover lazy activation, all modes, retrieval/medical abstention, experimental model gating, branding removal, two-second rotation, responsive/compact behavior, cache recovery, two clock fixtures, offscreen suspension and public aircraft isolation. Each of 364 sentences was measured at three widths in each style: 1,092 default dial cases plus 3,276 rim/companion/layered cases. Layered text remains strictly below the 220-unit center and below 350 SVG units, without overlapping outer hour numbers. Real mouse dragging and simulated mobile touch dragging resize its Answer size slider from 16 to 28; entire answers and captions remain. Fifteen additional scrolling-bar checks measure 2,184 animated/static sentence cases across the same widths, verify glyph visibility and the continuous duplicate-copy seam, real right-to-left speed, pause/hover/tap, complete reading before automatic rotation, offscreen/document-visibility suspension, compact modal reopening, validated API and animation disposal. Document visibility is simulated with a visibility event/property override. These are desktop browser emulations, not physical-device tests.

On Apple M3 Pro, macOS 27.2, Chrome/154.0.8037.98, an eight-second foreground sample with Scrolling face active recorded 481 frames: median 16.7ms, p95 16.7ms and p99 16.8ms, with 480 hand changes and 480 text-position changes. Sample JavaScript heap was 4.0MB, excluding native/WASM/GPU memory and process RSS. No aircraft policy or trainer worker was downloaded; five mount/unmount cycles preserved this isolation. The machine review binds the benchmark to the exact app asset hash.

Scrolling type stays at least 15px in both animated and manually scrollable reduced-motion bars, with the full 18px external caption available. Physical devices, Safari/Firefox, WebGPU, quantization, long-running memory and the 96 MiB resident-memory target remain unverified. The watch has no accounts or cloud chat and keeps local questions/settings on the device. No private documents, raw recordings or credentials are published. Public deferred watch assets remain below the 50 MB cap. [Machine review](chronos-watch-review.json) binds the release to exact source and asset hashes.

## Reproduce and deploy

```sh
npm ci
npm ci --prefix worker
npm run check
npm run build
npm test
npm run check:build -- --vectors
node scripts/security/csp-hashes.mjs
npm run check:i18n
npm run eval:chat
npx tsc -p worker/tsconfig.json --noEmit
npm run chat:smoke
node scripts/watch/serve-preview.mjs build 4347
# Separate terminal, isolated installed Chrome:
WATCH_QA_URL=http://127.0.0.1:4347 node scripts/watch/browser-qa.mjs
WATCH_QA_URL=http://127.0.0.1:4347/smart-watch/ node scripts/watch/layout-qa.mjs
WATCH_QA_URL=http://127.0.0.1:4347/smart-watch/ node scripts/watch/marquee-qa.mjs
WATCH_QA_URL=http://127.0.0.1:4347 WATCH_QA_STYLE=marquee node scripts/watch/benchmark-ui.mjs
```

An earlier GitHub Actions incident required a direct-assets bridge on the existing Cloudflare `demtsev-portfolio` gateway. GitHub recovered and its full build/deployment succeeded; permanent origin handoff was verified. Current changes publish normally through GitHub, preserving that gateway. Two unchanged videos above 25 MiB remain on the existing GitHub range origin; other assets and pages are served directly until the exact `/watch/release.json` marker reaches GitHub. A positive marker match persists in ORIGIN_STATE KV, allowing subsequent ordinary GitHub updates to continue automatically. GitHub Pages' custom domain remains unset to avoid proxy loops. The Worker forwards only read/range/cache headers, strips cookies and response cookies, and preserves canonical redirects and HSTS. Its public config contains no OAuth credentials.

For a future emergency asset bridge, first set the same fresh release marker in the public registry and Worker fallback config. Direct deployment uses `node worker/node_modules/wrangler/bin/wrangler.js deploy --config worker/site/wrangler.jsonc` after the build/check gates. Git commit/tree, source snapshot and deploy verification form the local release receipt. Automatic approval review rejected an optional external Ruflo memory upload because the destination was unauthorized; receipts remain local and Git-bound.
