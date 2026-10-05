---
title: Pixel Morph
tagline: Real-time 2D and 3D generation, on your device.
summary: Two neural networks that generate drawings and 3D objects live in the browser on WebGPU. No server, no upload. Describe an object in words and a new one is sampled in under half a second.
category: independent
year: "2026"
sortDate: 2026-10-01
organisation: Independent project
featured: true
order: 3
topics: [Generative AI, 3D, In-browser AI, Real-time]
stack: [TensorFlow.js, WebGPU, WebGL, PyTorch, Triplane VAE, Signed distance fields, Rectified flow, CLIP, ONNX Runtime Web, transformers.js]
highlights:
  - value: "782"
    label: buildings in the architecture model, decoded live
  - value: 1.14 M
    label: weights in the 3D decoder
  - value: ≈ 0.4 s
    label: to sample a new object from text, on WebGPU
  - value: 0.74 MB
    label: to the first frame of the drawing app
links:
  - label: Try it live
    href: https://daniil-777.github.io/real-time-web-2D3D-generation/
    kind: live
  - label: Source on GitHub
    href: https://github.com/daniil-777/real-time-web-2D3D-generation
    kind: code
videos:
  - id: pixel-morph
    title: Pixel Morph
    caption: 3D objects, text search, live drawings and how a building is generated.
    source: me/projects/fastBrowserGeneration/2D3Dgeneration.mp4
    posterAt: 23.6
    previewAt: 0.5
---

## The idea

Generative models usually live in a data centre. Pixel Morph asks how far a model can be shrunk and still generate something worth looking at, every frame, on the device in your hand. Everything is static files: any web host serves it, and nothing is uploaded.

## Drawings

A convolutional decoder with 252 K parameters turns a 48 × 48 grid of codes into a 384-pixel drawing. It wanders endlessly between the codes of 88 real photographs, drawing every step in dots, lines or cartoon. A small transformer can accompany it on piano.

## 3D objects

A triplane variational autoencoder packs a 3D model into three small feature planes. The decoder turns any code into a coloured signed-distance field, evaluated on a dense grid with WebGPU compute (or WebGL shaders) and sphere-traced every frame. Walking between codes morphs one object into the next: every shape in between is generated, not stored.

The architecture model holds 782 buildings in 12 classes and reaches an IoU of 0.91. In HD mode the network is evaluated only in a narrow band near the surface, so a 256³ grid costs about as much as the earlier 160³.

## Describe it, or create it

- **Find.** A CLIP text encoder running in the tab picks the object that best matches a description such as "a gothic cathedral".
- **Create.** A rectified-flow model over the latent planes, conditioned on the same text embedding, samples an object that was never in the training set. Every press is a new variation.

Models are trained in PyTorch and shipped as 8-bit weights; the browser output matches PyTorch to 3 × 10⁻⁷.
