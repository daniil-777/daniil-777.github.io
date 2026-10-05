# Chronos local language pipeline

The widget currently displays **reviewed source-backed sentences**, labelled as such. A genuine locally trained transformer exists, but its held-out generation failed the release gates. Its manifest is `experimental`; the browser loader reads that status and stops before downloading model weights, tokenizer, ONNX Runtime or WASM. No cloud model or random-weight substitute is used.

## Measured candidate

`chronos-a-finetune-20261005-lr0003-step1500` is a single mode-conditioned, decoder-only transformer trained from random initialization. It uses four layers, width 192, SwiGLU width 512, six query heads, two KV heads, head dimension 32, RMSNorm, RoPE, bias-free projections, a 4,096-entry tied embedding/output matrix, and a 256-token context. Its exact parameter count is **2,361,024**. There was no broad English pretraining.

The source-reviewed pack `chronos-facts-2026-10-05.1` contains 34 facts. The canonical pilot produced 78 accepted rows and no schema rejections, spanning ten source groups. Source groups were split **before** ambient/question variations: 45 training rows, 15 validation rows, and 18 test rows. The tokenizer was trained exclusively on training text. Its small corpus produced 970 usable byte/BPE entries; the remaining entries in the configured 4,096-entry vocabulary are unused. Arbitrary names and Unicode remain encodable as bytes. This is a small feasibility corpus, **not** a 5,000-example teacher pilot or a diverse generic-profile corpus.

Two measured configurations used seed `20261005`, CPU, two threads, microbatch one, gradient accumulation two, answer-only loss, AdamW, clipped gradients, warmup and cosine decay:

| Experiment | Result |
| --- | --- |
| Learning rate 0.0008, 500-step ceiling | Early stopping at 250 updates; 6.14 seconds; best validation loss 8.023 at step 50 |
| Learning rate 0.0003, 1,500 updates | 37.66 seconds; 76,798 answer tokens; 2,039 answer tokens/second; training loss 0.000734; validation loss 13.470 |
| Second experiment process peak RSS | 338,362,368 bytes, including Python, PyTorch, optimizer and training buffers |
| Familiar canonical training rows | 45/45 exact matches; six additional adversarial cases failed |
| Frozen unseen/adversarial suite | 2/24 complete outputs within twenty words; 2/24 canonical exact matches; release **failed** |

The familiar/unseen gap demonstrates memorization and insufficient contextual generalization. Scaling the architecture would not resolve the missing dataset coverage by itself. The deployed artifact is the second experiment's last checkpoint to retain this measured comparison; it is an experimental artifact rather than the first experiment's lower-loss but largely blank early checkpoint.

Reported supported-claim rate, serious-health failure count and unsupported-personal-achievement count are `null`: no independent entailment/safety review has established those metrics. Automated punctuation, word count, numerical and repetition checks cannot establish factual support. No 99%/98% release target, clinical review, broad language competence or crisis-counselling capability is claimed. Raw generation is measured without a hidden fallback. Reviewed UI output should be measured separately from these raw results.

## Export and inference evidence

PyTorch 2.8.0 → ONNX 1.19.0 / opset 17 → ONNX Runtime 1.23.0 CPU → ONNX Runtime Web 1.23.0 single-threaded CPU/WASM was verified. The graph handles both prefill and cached one-token decoding in **one session**. The persistent cache stores grouped KV heads with dimensions `[4, 2, 1, 2, pastLength, 32]`; the maximum FP32 cache is 524,288 bytes, excluding activations and scratch buffers.

Fifteen numerical cases include truly empty cache, cached versus uncached generation, padding masks and exact greedy continuation parity. Python/ONNX maximum absolute logit difference for the trained candidate was `0.000017166`; browser/ONNX difference was `0.000011444`, within the browser FP32 tolerance `0.0002`. The serialized graph has one tied embedding initializer. Runtime optimization may materialize a transposed output matrix; file size is not a resident-memory measurement.

On an ARM64 Mac running macOS 27.2 and isolated headless **Chrome 154.0.8037.98**, the trained candidate's reference benchmark measured:

| Measurement | Result |
| --- | --- |
| Cold runtime/model load and session initialization | 336 ms, local test server |
| Initial reference prefill | 23.1 ms |
| Subsequent short cached steps | 0.8–1.9 ms |
| FP32 model artifact | 9,546,398 bytes |
| Tokenizer | 7,124 bytes |
| WASM binary | 11,815,498 bytes |
| WASM module JS | 20,321 bytes |
| ML GPU allocations | Zero: WASM execution provider only |

The browser report separately records JavaScript heap bytes. These exclude WASM memory, native buffers, shared pages and total process resident memory. The under-96-MiB incremental resident-memory target is **unverified**. The fifteen short numerical prompts are not a benchmark of useful, quality-accepted sentence generation. Physical mobile hardware remains **untested**. No WebGPU, FP16, INT8 or INT4 deployment path is adopted without quality and backend comparisons; this release keeps only the tested FP32 reference.

ORT's JS and WASM are pinned, self-hosted, SHA-256 listed, and accompanied by the upstream MIT license and third-party notices. Hash-checked model/tokenizer/runtime downloads use byte ceilings, timeouts and bounded CacheStorage. ORT 1.23.0's Emscripten module cannot load from a Blob module URL because it constructs a URL relative to `import.meta.url`; the loader verifies its versioned same-origin JS file then imports that URL, and supplies verified WASM bytes through `wasmBinary`. No cross-origin isolation or SharedArrayBuffer is required.

## Browser API

```ts
import { WatchLanguageClient } from '../src/lib/watch/language/runtime.ts';

const language = new WatchLanguageClient(event => {
  // Tokens are internal diagnostics/cancellation events; display only a validated complete result.
});
const state = await language.init('/watch/language/manifest.json');
// Current state.status === 'unavailable': reviewed UI content remains visible.
// With a independently reviewed, released future checkpoint:
if (state.status === 'ready') {
  const result = await language.generate({
    requestId: 'phrase-1', mode: 'ai', question: undefined,
    factIds: ['reviewed-id'], facts: [{ id: 'reviewed-id', text: 'Reviewed fact context.' }],
    maxNewTokens: 64,
  });
  // Run application factual/scope/sentence validators before displaying result.text.
}
language.cancel();
await language.dispose();
```

Construction is lazy. Initialization creates a dedicated worker and checks metadata. Mode changes cancel the previous request; stale events cannot update the caller. Worker operations are serialized, pending superseded generations are skipped, cache resets between sentences, questions have a strict token budget, and only complete fitting facts enter the prompt. Dispose cancels pending work and terminates the worker, releasing the ORT backend as well as its session.

## Reproduce

Node 24 or later is used for TypeScript tests and browser tooling. Python 3.12 is used for offline training. All paths below are local; no credentials are needed for these commands.

```sh
python3 -m venv /tmp/chronos-lm-venv
/tmp/chronos-lm-venv/bin/pip install -r scripts/watch-language/requirements.txt
PY=/tmp/chronos-lm-venv/bin/python
$PY scripts/watch-language/test_pipeline.py
$PY scripts/watch-language/dataset.py pilot --facts public/watch/facts.v1.json --output /tmp/chronos-language-data/dataset.jsonl
$PY scripts/watch-language/dataset.py validate --dataset /tmp/chronos-language-data/dataset.jsonl
$PY scripts/watch-language/tokenizer.py --dataset /tmp/chronos-language-data/dataset.jsonl --output /tmp/chronos-language-data/tokenizer.json
$PY scripts/watch-language/train.py finetune --config scripts/watch-language/config.example.json
$PY scripts/watch-language/evaluate.py --checkpoint /tmp/chronos-language-trained/last.pt --tokenizer /tmp/chronos-language-data/tokenizer.json --dataset /tmp/chronos-language-data/dataset.jsonl --output /tmp/chronos-language-trained/evaluation.json
$PY scripts/watch-language/export.py --checkpoint /tmp/chronos-language-trained/last.pt --tokenizer /tmp/chronos-language-data/tokenizer.json --output /tmp/chronos-language-trained/export --dtype fp32
node scripts/watch-language/benchmark-browser.mjs --model /tmp/chronos-language-trained/export --runtime node_modules/onnxruntime-web/dist --output /tmp/chronos-language-trained/browser.json
node --test tests/watch-language*.test.ts
```

`train.py pretrain --config ...` consumes licensed/public-allowed JSONL rows with `text`, `rights`, `publicAllowed`, `sourceGroup` and `split`; it trains all eligible sequence tokens. This optional 50–150-million-token experiment was **not run**. `finetune` masks prompt/source/padding tokens and includes EOS in the target. `--base <checkpoint>` supports fine-tuning from a pretrained checkpoint; a `specialistMode` configuration can restrict training to one mode. Specialist comparisons were not needed for the demonstrated data limitation. `--resume <checkpoint>` restores optimizer, shuffle order, random states, step and measurements. Checkpoints and bulky datasets remain outside browser assets.

The two example configurations form the measured small sweep. To reproduce the second, set `learningRate` to `0.0003`, `steps` to `1500`, `warmupSteps` to `50`, `evaluateEvery` to `100`, and `earlyStoppingPatience` to `20`. Do not update `releaseStatus` merely because training completed.

## Optional capped teacher generation

`dataset.py generate --config <JSON> --output <JSONL> --budget 0` stops without reading a teacher credential or making a request. A positive explicit USD budget, endpoint, model, configured token prices, fact-pack path, accepted target, maximum attempts, seed and optional `batchSize` (one to eight) are required. Only then is `CHRONOS_TEACHER_KEY` read offline. It never appears in site assets.

Each batch reserves a pessimistic UTF-8-based input-token bound and maximum output-token cost **before** the request. An append-only ledger survives resumption and includes reported usage/cost. The process stops if the provider exceeds a reserved bound. The cap relies on the configured provider prices and its advertised token limit; it does not replace a provider's billing meter. Retry attempts, pending data and rejection logs are bounded by configuration. Generated examples stay in `.pending.jsonl` until a separate entailment/safety verification pass.

```sh
$PY scripts/watch-language/dataset.py generate --config /path/to/reviewed-teacher-config.json --output /tmp/teacher.jsonl --budget 0
$PY scripts/watch-language/dataset.py verify --dataset /tmp/teacher.pending.jsonl --verdicts /path/to/independent-verdicts.jsonl --output /tmp/verified.jsonl
```

Each verifier verdict names a reviewer/method and returns booleans for entailment, preserved qualifications, supported entities/numbers, safe scope, completeness, usefulness and word-count compliance. Missing or failing verdicts are rejected. Independent human sampling, all serious failures and the complete final wellbeing release set still require review; no automated judge proves those properties. Diverse permitted or explicitly fictional generic profiles belong in a separate, provenance-marked training corpus and must never be added to Daniil's public fact pack.

Official technical references: [ORT Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html), [ORT 1.23.0 runtime flags](https://github.com/microsoft/onnxruntime/blob/v1.23.0/js/common/lib/env.ts), [PyTorch ONNX export](https://docs.pytorch.org/docs/stable/onnx.html).
