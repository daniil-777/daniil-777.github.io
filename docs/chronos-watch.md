# Chronos smart watch — completion and release review

Chronos adds a Smart watch chapter beneath Contact, a full demo at [/smart-watch/](https://demtsev.com/smart-watch/) and a 96px launcher at [/smart-watch/embed/](https://demtsev.com/smart-watch/embed/). The existing About → Work → Journey → Research → Contact order is preserved. The new chapter and navigation are localized into the site's seven languages; the watch's reviewed source content is explicitly English.

## Shipped experience

The original SVG face has a black dial, steel bezel and crown, sixty minute indices, white 12/3/6/9 numerals, faceted hour/minute hands and a thin second hand. One clock service supplies current device time and the aircraft's shared sixty-second orbital phase. Device/Zurich time, sweeping/ticking hands, 15–60-second thought intervals, aircraft/cloud toggles, pause, source details, questions, local Learn and Reset are available. The compact launcher opens a keyboard-accessible native dialog.

AI, About me and Wellbeing select among 34 original, reviewed, cited 10–20-word sentences: 12 AI, 12 public profile and 10 general WHO wellbeing facts. Questions retrieve only within the current mode. Clinical/crisis questions are declined with an appropriate help message. Output must match a reviewed answer before display; finite lexical guards are supplementary, not a claim of universal safety. Public-profile achievements retain their qualifications, including a patent **application** rather than a granted patent.

All complete thoughts fit the curved lower aperture. A readable 18px caption repeats the full sentence. The small dial type measures 8–9.5 SVG units and scales with the face; the brief's 12–14px dial-type target is not achieved. Geometry was checked for all 34 sentences at three viewport widths, and screenshots at 6:30 and 7:25 were visually reviewed. Hour/minute tips remain above the aperture at those fixtures. The moving second hand can cross the lower dial; the external caption remains unobstructed.

The clock and simulation suspend offscreen or when hidden. Reduced motion uses ticking hands and hides the aircraft/clouds. A closed compact watch fetches no facts or model/policy assets; the homepage does not activate the watch above the fold. Questions remain on the device and are not stored. Public facts and verified assets have bounded caches. Missing/corrupt downloads fail closed; cached public facts work after a simulated network failure, and first-use failures show a complete error sentence with a bounded manual retry.

## Language model: trained, evaluated, gated

The actual candidate is a 2,361,024-parameter decoder: four layers, width 192, SwiGLU width 512, six query/two KV heads, head dimension 32, RMSNorm, RoPE, tied 4,096-entry vocabulary and 256-token context. The byte/BPE tokenizer is trained on training text only. Python trains offline; browser TypeScript loads a single cached ONNX session in a dedicated worker using pinned ONNX Runtime Web 1.23.0 CPU/WASM.

The small corpus contains 78 canonical examples from ten source groups, split before variations into 45 train, 15 validation and 18 test examples. Two local CPU configurations were run. The chosen 1,500-update checkpoint memorized 45/45 familiar canonical rows but produced only **2/24** complete, exact outputs on the frozen unseen/adversarial suite (8.33%; Wilson 95% interval 2.32–25.85%). It did not pass release gates. Independent supported-claim and serious-health-failure metrics remain unknown.

The public loader stops at the experimental manifest before model, tokenizer, ONNX Runtime or WASM downloads. The UI labels its current content **Reviewed thought**. Training assets are real and inspectable, but reviewed sentences are not presented as neural generation. No broad English pretraining, large teacher pilot or diverse generic-profile corpus was completed. Teacher spending was **$0**. The capped offline generation/review pipeline is implemented for a future independently reviewed training corpus; it cannot call a teacher without an explicit positive spending cap and configuration.

PyTorch → ONNX → browser WASM parity passed fifteen reference cases, including empty cache, padding and cached continuation. Maximum browser absolute logit error was 0.000011444, within the 0.0002 tolerance. These numerical checks establish export correctness, not language quality.

| Reference artifact | Raw bytes | Recorded gzip bytes |
|---|---:|---:|
| FP32 ONNX model | 9,546,398 | 8,744,733 |
| Tokenizer | 7,124 | 2,664 |
| WASM binary | 11,815,498 | 3,045,563 |
| WASM module JS | 20,321 | 8,208 |
| Aircraft checkpoint JSON | 34,652 | 16,298 |

Gzip numbers are reference artifact measurements, not actual CDN transfer sizes; compression level/runtime can alter them. Model and runtime hashes, sizes, license and third-party notices are included. Quantization and WebGPU are not enabled without backend/quality comparisons.

See [language pipeline details](watch-language.md) and the [public model card](https://demtsev.com/watch/language/model-card.json).

## Aircraft: real training, separate assistance

The aircraft is a 16→32→32→3 network with 1,699 FP32 parameters (6,796 raw parameter bytes). The shipped hybrid Double DQN checkpoint received 500,000 environment steps and 124,873 genuine Bellman updates, with a 20,000-step expert warm-start and strong expert regularization. This is not unaided pure DQN. A separate pure-DQN run is retained for comparison.

Twenty-hertz physics uses acceleration/speed bounds, a fixed observation format, at most three observable clouds, swept collision checks and executable time-indexed reachability certificates. Existing clouds are never deleted to rescue the policy. Only radial control is learned; orbital phase comes from the same millisecond clock as the hands. The actual scaled silhouette fits its conservative physical envelope.

Each controller was evaluated on the same 1,000 held-out one-minute seeds (700000–700999):

| Controller | Collision-free episodes | Rate |
|---|---:|---:|
| Fixed middle | 0/1,000 | 0% |
| Random lane requests | 0/1,000 | 0% |
| Deterministic look-ahead | 1,000/1,000 | 100% |
| Pure Double DQN | 91/1,000 | 9.1% |
| Hybrid learned policy, unassisted | 922/1,000 | 92.2% |
| Hybrid learned policy + Safety assist | 999/1,000 | 99.9% |

The unassisted 95% target failed (Wilson 95% interval 90.37–93.71%). Assisted results have interval 99.44–99.98%, with 1,117 deterministic interventions across 1,199,210 decisions. The interface names Safety assist and its intervention count. The deterministic baseline outperformed learning; no superiority claim is made. The documented finite reachable distribution is not a universal collision-free guarantee.

Learn performs genuine worker gradient updates in local simulation, with bounded 4,096-transition replay (552,960 typed bytes), small scheduled work slices and a twenty-episode policy-promotion check. It does not train inside the animation loop. Pause, disable, hide and reset cancel/suspend the appropriate work; one compatible learned checkpoint can be retained locally. The browser review observed real training progress, then verified that disabling Learn returned to the frozen-policy state.

See [aircraft reproduction and physics](watch-plane.md) and [public evaluation](https://demtsev.com/watch/plane/evaluation.json).

## Validation and measured limits

The production checkout passed 526 TypeScript tests in 83 suites, six Python pipeline tests, Astro checks for 143 files with zero errors/warnings, build/vector/privacy budgets, localization coverage (23 HTML files / 1,127 source strings), the chat retrieval gate, worker type checking and the no-cost provider smoke suite. The existing chat evaluation hedged or declined all 88 unanswerable cases. No private documents, raw recordings, teacher credentials or visitor data are part of the release.

Seventeen isolated Chrome browser checks cover lazy activation, all modes, in-scope retrieval, medical abstention, experimental-model gating, 102 actual text-bound measurements, reduced motion, three responsive layouts, compact opening/Escape, cache recovery, first-use failure/retry, two clock fixtures and offscreen suspension. Repeated mount/unmount was exercised five times.

On an Apple M3 Pro, macOS 27.2, Chrome 154.0.8037.98, an eight-second foreground sample recorded 481 frames: median 16.7ms, p95 16.7ms and p99 16.8ms. Maximum displayed clock/aircraft phase difference was 0.000003514 radians. JavaScript heap was approximately 2.7MB at that sample; it excludes WASM, native allocations, GPU and total process RSS. Online learning reached 512 real simulation steps during its verification window. These measurements are bound to the app asset hash in the machine review.

The gated language candidate's separate local numerical benchmark measured 336ms cold initialization, 23.1ms reference prefill and 0.8–1.9ms short cached steps. Those fifteen reference runs are **not** useful accepted-sentence latency. The incremental 96-MiB resident-memory target and warm sentence-generation latency remain unverified. ML GPU allocation is zero for the chosen CPU/WASM path. Node training/policy memory is reported separately and is not browser memory.

Physical mobile devices, Safari/Firefox, WebGPU, quantized backends and long-duration browser/worker memory are untested. Desktop viewport emulation is identified explicitly. Production still needs subsequent real-device sampling rather than extrapolated claims.

The budget checker preserves its existing baselines and grants only an explicit scoped watch allowance (HTML 5,200 / CSS 4,000 / eager JS 1,500 additional gzip bytes). Watch model and runtime remain deferred, individually capped and subject to a 50MB total public-asset ceiling. Browser startup adds a 1,431-byte lazy bootstrap (723 bytes reference gzip); activated app JS is 28,594 bytes (10,909 gzip). Worker and conditional ONNX JS artifact sizes are listed in the machine review. No canvas/vector inspector or neural layer inspector is exposed to visitors.

[Machine-readable review and source hashes](chronos-watch-review.json) bind these claims to exact component, runtime, training, test and asset inputs. The Git commit and CI deployment provide the final release identity. A clean source state, explicit user deployment authorization and green required checks are prerequisites to publication; the failed language candidate is not promoted by that authorization.

## Reuse and reproduce

Use `SmartWatch.astro` in an Astro page, or mount its generated markup with `mountSmartWatch(root, options)`. The handle exposes `setSettings`, `open` and `unmount`. Settings include time zone, sweep/tick motion, thought interval, mode, aircraft/cloud visibility and online learning. Presentation is chosen by the component markup; the supported inference backend is WASM.

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
# In another terminal, use an isolated installed Chrome browser:
WATCH_QA_URL=http://127.0.0.1:4347 node scripts/watch/browser-qa.mjs
WATCH_QA_URL=http://127.0.0.1:4347 node scripts/watch/benchmark-ui.mjs
```

Training/export commands, exact architecture, pinned Python dependencies, corpus schema, checkpoint/optimizer resumption, capped teacher ledger, validation commands and seeded aircraft reproductions are in the two linked pipeline documents. The frontend is published through the existing GitHub Pages workflow and served at demtsev.com by its fixed-origin Cloudflare gateway; the GitHub Pages custom domain remains unset to preserve that routing.
