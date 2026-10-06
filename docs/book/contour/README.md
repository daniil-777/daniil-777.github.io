# Book contour decoder v2

The book generates original vector ink from a locally trained causal transformer. This version expands the four original contour families into 16: leaf, wave, mountain, flower, lotus, shell, butterfly, moon, cloud, koi, swan, fern, ginkgo, feather, acorn and pebble. Figures are narrow, recognizable silhouettes and contour studies; this is a learned vector prior rather than an arbitrary text-to-image system.

The original synthetic dataset has 64,000 training drawings, 3,200 validation drawings and 3,200 independent test drawings. Every split is balanced across all 16 families: 4,000 training and 200 test examples per family. Each drawing has 96 xy tokens and four independent style conditions controlling geometry. The training row count is 20 times v1, and each vector has twice as many points. The saved `contour-dataset.npz` is 49,776,939 bytes. This full corpus remains in the local training workspace and is excluded from the website and GitHub release; published seeded source reconstructs every split. All 70,400 exemplars are original procedural artwork authored in `shapes.py`, using hand-authored landmarks and elementary curve formulas. No external images, image datasets, pretrained weights or remote training service were used. Browser assets contain only the learned checkpoint and metadata; they do not contain the drawing corpus or shape formulas.

The decoder has two pre-RMSNorm attention blocks, width 48, four heads of width 12, learned positions and SwiGLU feedforward layers of width 96. A token consists of the preceding xy point, a one-hot family condition and four style values. Output coordinates use tanh and stay within [-1, 1]. The model has 52,130 trainable parameters and a 208,520-byte float32 checkpoint. Browser generation uses actual autoregressive next-point inference and an incremental key/value cache.

Training completed 8,000 AdamW steps with batch size 64 on CPU in 420.74 seconds, using PyTorch 2.8.0 and NumPy 2.3.3. The sampler made 512,000 example presentations and visited 63,979 of the 64,000 available training examples. `training-consumption.json` records the exact deterministic sampler reconstruction; attention, evaluation and optimizer operations consume no RNG. Checkpoint 7,750 was selected using only 256 balanced validation styles, with the objective mean rollout MSE plus 0.35 times worst-family MSE. Test data never selected a checkpoint.

The independent 3,200-drawing test split has autoregressive coordinate MSE 0.0000100983 and teacher-forced next-point MSE 0.00000883533. Naive previous-point persistence has teacher-forced MSE 0.00414094. The worst family rollout MSE is 0.0000254157. Every test drawing is finite and bounded; all 200 drawings within each family are distinct and retain style variation. No generated test drawing exactly matches a training drawing. Every family passes the recorded jump, diversity and closure gates; maximum uncorrected closed-outline seam is 0.01779 normalized units. These are geometry measurements over the narrow synthetic task, not proof of general visual understanding or a guaranteed effect on wellbeing.

Both the source target silhouettes and actual generated held-out and test galleries were inspected. `generated-test.svg` shows one untouched test generation from every family; `generated-heldout.svg` shows two validation styles per family. Galleries deliberately expose the raw predicted polylines. The book applies mild Catmull-Rom interpolation, then closes closed-outline endpoints. The open families are wave, mountain and shell; the metadata `closed` array declares the remaining outlines closed.

The original four families were compared against the previously shipped v1 model using the same 200 independent test styles per family. V1's 48-point traces were linearly interpolated to 96 points for comparison. V2 improves leaf and flower coordinate MSE. Wave and mountain MSE increase slightly; in the book's 85-unit SVG mapping their coordinate RMSE rises by about 0.049 and 0.025 pixels respectively. All four remain below 0.43 SVG pixels RMSE. `original-four-comparison.json` reports the complete values instead of assuming every metric improved.

## Reproduce

Run from the website repository root with Python dependencies matching `requirements.txt`:

```sh
python scripts/book/contour/train.py --steps 8000 --batch 64 --threads 2 --output /tmp/book-contour-v2-reproduction
node scripts/book/contour/verify.mjs --artifacts /tmp/book-contour-v2-reproduction
python scripts/book/contour/consumption.py --artifacts /tmp/book-contour-v2-reproduction
python scripts/book/contour/check_source_dataset.py --artifacts /tmp/book-contour-v2-reproduction
```

Keep `train.py`, `model.py` and `shapes.py` together. The first command writes the deterministic dataset, selected checkpoint, little-endian browser weights, architecture metadata, 32 Python inference fixtures, training report and galleries. An incompatible existing dataset cache fails explicitly; select a fresh output directory. The second command compares browser inference with Python traces and checks checkpoint identity and cancellation. The release integration should additionally run the independent runtime verifier and browser smoke checks. A new training run may select a different checkpoint on another numeric backend; re-run its gates rather than reusing the old receipt.

The sampler and source verification helpers operate on the fresh output directory. The source verification re-generates all 70,400 examples and requires bit-exact agreement. To reproduce the original four-family comparison, provide the prior exported v1 metadata and weights together in a baseline directory, then run `python scripts/book/contour/compare_v1.py --artifacts /tmp/book-contour-v2-reproduction --baseline path/to/baseline-v1`. Its `v1_baseline.py` helper reads the actual previous float32 checkpoint, rather than rebuilding an untrained reference model.

The metadata version is 2. Its architecture is `{width:48,layers:2,heads:4,ffn:96,points:96,input:22,epsilon:0.000001}`. Weights use the same named row-major tensor descriptors as v1, with offsets counted in float32 elements. The ordered `shapes` and `closed` arrays define the generation vocabulary and contour closure. A drawing seed produces four continuous values in [-1,1]; those values condition the learned decoder rather than selecting a saved example. Map normalized coordinates into a 200-unit SVG with `100 + 85 * coordinate`.

`training-report.json`, `training-consumption.json`, `source-dataset-verification.json`, `original-four-comparison.json`, the independent runtime evidence and `artifact-manifest.json` bind the measurements to source and exported bytes. Source, receipts and galleries can be published for review. The full corpus stays local and can be regenerated; only the 208 KB learned weights and small metadata file need be delivered to book visitors.

## Architectural references

- Causal decoder masking and scaled dot-product attention: [Attention Is All You Need](https://arxiv.org/abs/1706.03762).
- Training attention API and 1/sqrt(head width) scaling: [PyTorch 2.8 scaled_dot_product_attention](https://docs.pytorch.org/docs/2.8/generated/torch.nn.functional.scaled_dot_product_attention.html). Training uses a square causal mask; incremental inference attends to the current point and cached earlier points only.
- Feedforward gating: [GLU Variants Improve Transformer](https://arxiv.org/abs/2002.05202).
- Normalization: [Root Mean Square Layer Normalization](https://arxiv.org/abs/1910.07467).
