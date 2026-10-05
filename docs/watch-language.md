# Tiny local language pipeline

The watch now has **364 original, source-reviewed sentences**, up from 34. It includes mathematics and AI in finance, robotics, vision, healthcare, science and security. The original 12 public profile and 10 WHO wellbeing facts remain unchanged. New answers contain 10–20 words and at most 125 characters; the interface measures their complete text before display. Finance content describes research and methods without personalized investment recommendations. Healthcare AI content describes research and governance without personal clinical advice.

The expanded neural model was **genuinely retrained and exported**, but its public release gate failed. The browser displays clearly labelled sentences selected from the reviewed pack. The experimental manifest is rejected before downloading its weights, tokenizer or ONNX inference runtime. No sentence selector is presented as neural generation, and there is no cloud substitute.

## Data and provenance

[Fact pack](../public/watch/facts.v1.json): `chronos-facts-2026-10-05.2-expanded-citation1`. [Authoring catalog](../scripts/watch/fact-catalog.json) adds 330 distinct sentences across 33 source-group buckets, now citing 34 primary reference URLs. [Source audit](../public/watch/language/source-audit.json) retains their titles, links, domains and access dates. References include MIT mathematics, NIST statistics and AI risk publications, official scikit-learn/SciPy/PyTorch/OpenCV documentation, central-bank/FSB research and original robotics, vision and scientific-learning papers.

| Domain | Facts |
| --- | ---: |
| General AI | 92 |
| Mathematics | 70 |
| AI in finance | 40 |
| Robotics | 40 |
| Computer vision | 30 |
| AI in healthcare | 20 |
| AI in science | 30 |
| Security and AI governance | 20 |
| Public profile | 12 |
| General wellbeing | 10 |

The new sentences are original factual summaries checked against primary references by the authoring agent. They are **not independently reviewed human or clinical guidance**. Source passages, figures and full source corpora were not copied or ingested. Each new fact records `independentHumanReview: false`; its `sourceDateKind: accessed` makes clear that its date is an access date. Profile facts were explicitly supplied by the owner for public publication. The catalog builder preserves their wording and qualifications, including the distinction between a patent application and a granted patent. Initial OpenStax candidates were replaced after checking its stated AI-ingestion restrictions.

[Dataset statistics](../public/watch/language/dataset-statistics.json) record **2,720 accepted examples**, zero schema rejects, 364 distinct facts and **43 source-document groups**. There are seven deterministic prompt forms per fact and four missing-evidence forms per source. Prompt variants do not multiply independent facts. No paid teacher requests were made: spend **$0**. This is an expanded canonical corpus, not a claimed 5,000-example teacher pilot or broad English pretraining corpus.

Connected source, fact, scenario and source-version groups are assigned to splits **before augmentation**, stratified by domain. Counts are **1,475 training / 536 validation / 709 test**. Every domain has training and held-out test source groups; domains with only two groups have no validation group. The validator checks source/fact/scenario separation. Documents from the same documentation family can appear in different splits; the unit of separation is a cited document or an explicitly linked source family, rather than an entire institution or library. The two PyTorch differentiation references share one bucket. [Fingerprints](../public/watch/language/dataset-fingerprint.json) bind the exact original training corpus and registry, current display registry, tokenizer and validation receipt separately.

A later independent **agent** review found no substantive factual blocker in the 330 additions, but identified one citation mismatch: the JVP sentence linked to a beginner tutorial demonstrating VJPs. Its current citation is the specific [PyTorch `torch.func.jvp` API](https://docs.pytorch.org/docs/2.14/generated/torch.func.jvp.html). The answer, topic, mode, source-group bucket and every training prompt/target token ID are unchanged. This is a post-training citation clarification, not a new training run. Training used 43 reference URLs; the corrected display registry has 44, still within the same 43 source groups. The review is not an independent human or clinical review.

The original training corpus hash remains `f6b8fd7a276f7874238dea8c2f8f0666758abe2f03d762523a7a6b36e979287d`, and its original registry hash remains `22fdbfa0a1a733d3ec6dcd3c080cebd5ee6f8a0d3f3396524cae3f0672d63198`. The provenance artifact records the corrected display hash separately and verifies equal hashes for all actual conditioning and answer token IDs. Rebuilding the corpus after this citation clarification changes reference metadata and its JSON hash; the neural inputs remain identical.

## Actual training and candidate selection

The architecture remains candidate A: four decoder layers, width 192, SwiGLU feed-forward width 512, six query heads, two KV heads of dimension 32, RoPE, RMSNorm and tied embeddings/output projection. It has **2,361,024 parameters**, a configured 4,096-ID byte-BPE vocabulary and a 256-token total context. Prompt/source/padding tokens are masked from answer loss; targets include EOS. The tokenizer only learns from training examples.

Two fresh random-initialized CPU runs each completed **5,000 optimizer updates**, accumulating two examples per update. Both used seed 20261005, learning rate 0.0005, 100 warmup updates, AdamW, gradient clipping and a cosine schedule. No pretrained third-party model, paid teacher data or broad pretraining was used. The measured environment was Python 3.12.4, PyTorch 2.8.0, ONNX 1.19.0 and ONNX Runtime 1.23.0 on the local Apple M3 Pro Mac.

| Run | Used byte-BPE IDs | Wall time | Learned answer tokens including EOS | Answer tokens/s | Peak training-process RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Comparison | 3,341 | 166.61 s | 242,768 | 1,457.12 | 365,084,672 bytes |
| Selected tokenizer | 1,024 | 196.82 s | 360,962 | 1,834.01 | 359,235,584 bytes |

Curves and configuration are public in [comparison training](../public/watch/language/training-comparison.json) and [candidate training](../public/watch/language/training-candidate.json). All 1,475 training rows fit both tokenizers. Seven validation variants exceed the selected tokenizer's complete-target 64-token limit and are excluded from its training-loop validation loss; the remaining count is 529. The normalized comparison below evaluates all 536 complete validation targets, and all 709 test rows fit.

Each run's checkpoint was selected by minimum validation loss within its own tokenization. Per-token losses across different tokenizers are not directly comparable. [Validation-only comparison](../public/watch/language/validation-comparison.json) therefore uses identical answer targets, answer-plus-EOS negative log likelihood divided by UTF-8 answer bytes, and a frozen hash-selected 32-unique-fact greedy suite. The pre-test selection rule prioritizes exact canonical matches, then lower normalized loss on ties.

| Candidate checkpoint | Validation bits per UTF-8 answer byte | Exact matches / 32 | Complete within twenty words / 32 |
| --- | ---: | ---: | ---: |
| 3,341-ID tokenizer, update 250 | 3.7561 | 0 | 0 |
| 1,024-ID tokenizer, update 1,000 | 2.5369 | 0 | 17 |

The exported version is **`chronos-a-expanded-bpe1024-20261005-step1000`**. The selected checkpoint contains 1,000 updates, while both complete training runs contain 5,000. The remaining updates overfit validation data; they are reported rather than substituted into the release. Test generations were not used to select a candidate.

## Frozen raw evaluation and failed release

[Raw generations](../public/watch/language/evaluation-raw.json) and [summary](../public/watch/language/evaluation-candidate.json) contain **709 unseen-source examples plus 30 missing-context/adversarial cases**, including numerical invention, source instructions, conflicting evidence, profile embellishment, personalized finance and clinical questions. Evaluation uses actual cached greedy generation, not the reviewed fallback.

| Subset | Samples | Complete and at most twenty words | Exact canonical matches |
| --- | ---: | ---: | ---: |
| Held-out factual answers | 665 | 257 | **0** |
| Source-bound missing evidence | 44 | 44 | 44 |
| Adversarial/missing-context cases | 30 | 27 | 6 |
| Entire finite suite | 739 | 328 | 50 |

Overall syntax compliance is **44.38%**, with a descriptive Wilson interval of **40.84–47.99%**. Overall exact match is 6.77%, entirely accounted for by abstentions; **factual exact match is 0/665**. Repetition screening flags 87.82% of raw outputs. Numerical screening found no unsupported numerical output in this particular suite. Independent supported-claim rate, serious health failures and unsupported-achievement rates remain **unmeasured**, not zero.

Per-domain results are in the public summary. Variants share facts and source groups, so counts and confidence intervals describe a correlated finite suite rather than independent population samples. Exact wording checks are not independent entailment review. The old 34-fact test used different data and cannot establish a direct quality improvement comparison. These results do not justify publishing open-ended neural answers, regardless of the larger dataset. The reviewed source sentences remain the public output path.

## Export, browser parity and resources

The actual FP32 ONNX artifact is **9,546,398 bytes**, gzip **8,766,018 bytes**, SHA-256 `bf721e58e5c4f5f230aa6113807a671d0eb1436b2a5acde1685ebf324df4d365`. Its tokenizer is 7,724 bytes, gzip 2,848. [Asset sizes](../public/watch/language/asset-sizes.json) bind all public files. The corrected display fact pack is 387,261 bytes, gzip 25,166. Bulky training corpora and optimizer checkpoints stay outside website assets.

The export preserves one tied embedding initializer; it checks a genuinely empty grouped cache, padding masks and cached-versus-complete decoding. Fifteen Python/ONNX parity cases passed, maximum absolute logit error **7.63e-6**. [Isolated Chromium/WASM benchmark](../public/watch/language/benchmark-browser.json) passed all fifteen cached greedy cases with error **8.58e-6** on Chrome 154.0.8037.98, macOS/ARM64, single-threaded CPU/WASM. Runtime 1.23.0 hashes were checked.

Reference cold load was **370.9 ms**, prefill **25.5 ms**, and cached numerical runs **0.8–2.5 ms**. These fixture timings do not establish useful-sentence quality or a successful full-answer latency. JavaScript heap was 27,392,389 bytes; it excludes WASM memory and total process resident memory. A full 256-token FP32 grouped KV cache is 524,288 bytes. ORT graph optimization may materialize a tied output transpose in memory. The 96 MiB incremental resident-memory target, physical mobile behavior, WebGPU and quantized-quality comparisons remain unverified. No ML GPU buffers are allocated by the CPU/WASM path.

## Reproduction

Use a Python environment with `scripts/watch-language/requirements.txt` and Node 24. Training requires only local CPU compute. The fact pack builder and canonical dataset generator are deterministic and make no teacher calls.

```sh
PY=/tmp/chronos-lm-venv/bin/python
python3 scripts/watch/create-fact-pack.py
mkdir -p /tmp/chronos-expanded-language-data
$PY scripts/watch-language/dataset.py pilot --facts public/watch/facts.v1.json --output /tmp/chronos-expanded-language-data/dataset.jsonl
$PY scripts/watch-language/dataset.py validate --dataset /tmp/chronos-expanded-language-data/dataset.jsonl > /tmp/chronos-expanded-language-data/validation.json
$PY scripts/watch-language/tokenizer.py --dataset /tmp/chronos-expanded-language-data/dataset.jsonl --output /tmp/chronos-expanded-language-data/tokenizer.json
$PY scripts/watch-language/tokenizer.py --dataset /tmp/chronos-expanded-language-data/dataset.jsonl --output /tmp/chronos-expanded-language-data/tokenizer-1024.json --used-vocabulary-target 1024
$PY scripts/watch-language/train.py finetune --config scripts/watch-language/config.comparison.json
$PY scripts/watch-language/train.py finetune --config scripts/watch-language/config.example.json
$PY scripts/watch-language/compare_validation.py --dataset /tmp/chronos-expanded-language-data/dataset.jsonl --candidate bpe3341 /tmp/chronos-expanded-language-trained/best.pt /tmp/chronos-expanded-language-data/tokenizer.json --candidate bpe1024 /tmp/chronos-expanded-language-trained-1024/best.pt /tmp/chronos-expanded-language-data/tokenizer-1024.json --output /tmp/chronos-expanded-language-data/validation-comparison.json
$PY scripts/watch-language/evaluate.py --checkpoint /tmp/chronos-expanded-language-trained-1024/best.pt --tokenizer /tmp/chronos-expanded-language-data/tokenizer-1024.json --dataset /tmp/chronos-expanded-language-data/dataset.jsonl --output /tmp/chronos-expanded-language-data/evaluation-test-raw.json
$PY scripts/watch-language/export.py --checkpoint /tmp/chronos-expanded-language-trained-1024/best.pt --tokenizer /tmp/chronos-expanded-language-data/tokenizer-1024.json --output /tmp/chronos-expanded-language-export --dtype fp32
node scripts/watch-language/benchmark-browser.mjs --model /tmp/chronos-expanded-language-export --runtime node_modules/onnxruntime-web/dist --output /tmp/chronos-expanded-browser-benchmark.json
$PY scripts/watch-language/test_pipeline.py
node --test tests/watch-facts.test.ts tests/watch-language*.test.ts
```

The publication checkpoint adds the descriptive expanded version string after selection without changing weights. `package_artifacts.py` collects the measured training, evaluation, export and browser reports, derives hashes/bytes, and preserves experimental status. `train.py --resume` restores optimizer and random state; `--base` supports an explicitly chosen pretrained checkpoint. Optional licensed narrow pretraining remains available but was not run.

Paid teacher generation stays disabled unless a positive explicit USD cap, reviewed endpoint/model/prices and an offline credential are supplied. A zero budget stops before credential access or a network request. Requests reserve pessimistic costs before submission; generated examples remain pending until independent structured verification. No secret is embedded in website assets. See the implemented `generate` and `verify` subcommands in [dataset.py](../scripts/watch-language/dataset.py).
