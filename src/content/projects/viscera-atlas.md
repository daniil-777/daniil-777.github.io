---
title: VISCERA Atlas
tagline: Generative shape modelling and text-to-shape editing for interactive 3D anatomy.
summary: A browser-based anatomy studio combining a generative shape model with text-to-shape editing. Create reproducible 3D organ variations with natural-language instructions or interactive controls, then explore tissue appearance, synthetic disease morphology and liver mechanics.
category: independent
year: "2026"
sortDate: 2026-10-16
organisation: Independent project
featured: true
order: 6
topics: [Generative AI, 3D, In-browser AI, Medical, Simulation, Synthetic data]
stack: [React, TypeScript, Three.js, Vite, Python, FastAPI, PyTorch, NumPy, Normalizing flows, Finite elements, meshoptimizer, Playwright]
highlights:
  - value: "24"
    label: open reference organs across 12 organ families
  - value: "7"
    label: bounded, invertible shape controls on every organ
  - value: 438 k
    label: parameters in the shape and colour flow that runs in the browser
  - value: 9,216
    label: paired text edits in the open language dataset
links:
  - label: Try it live
    href: https://daniil-777.github.io/real-time-web-2D3D-generation/anatomy/?mode=atlas
    kind: live
  - label: Source on GitHub
    href: https://github.com/daniil-777/surgery-anatomical-variations
    kind: code
videos:
  - id: viscera-atlas
    title: VISCERA Atlas
    caption: The reference library, a liver reshaped with words, photo-derived tissue detail, disease morphology and the liver physics lab.
    source: me/projects/visceraAtlas/visceraAtlas.mp4
    posterAt: 5.8
    previewAt: 4
---

## The idea

Anatomy in simulators and games is usually one fixed mesh per organ. VISCERA Atlas starts from 24 open reference organs across 12 organ families, from liver and gallbladder to heart, lungs, brain and bladder, and asks how far they can be varied while every change stays bounded, reproducible and traceable to its source. The public studio is static files: the atlas is compressed from 19 MB to 5 MB and decoded by three.js in the tab.

## Shape

Seven explicit controls deform each reference: width, height, depth, bend, twist, taper and asymmetry. The deformation is analytically invertible with a positive Jacobian, so zero is the exact original and no edit can fold the surface. All 3,840 high-resolution test meshes passed identity, corner and random-control checks. A compact conditional flow over the controls proposes new variations, and a seed reproduces any of them exactly.

## Anatomy with words

Type "liver 3% wider", "width 200 mm" or "make the liver slightly wider and wetter". A deterministic compiler turns the sentence into a typed patch, solves the dimensions against the actual mesh and shows the interpreted change before applying it. Unsupported, ambiguous or conflicting requests are refused rather than half-executed. A paired dataset of 9,216 edit requests, 7,680 accepted and 1,536 refused, is the training set for an optional language adapter.

## Surface and disease

- The texture lab lays real tissue detail over the procedural material. One small seamless tile per organ is cut from licensed surgical photographs and their reviewed organ masks, with glare and shadows excluded, then projected onto the organ and tiled with histogram-preserving blending, so nothing repeats and the frame rate stays at 60 fps.
- The disease panel offers 25 synthetic surface profiles across the 12 organs, from cirrhosis to polycystic kidney, each with bounded design controls and a cited reference. They are design controls for assets, not clinical diagnosis.

## Liver physics lab

Drop the committed liver onto the floor, grasp it with a fenestrated grasper, push it and watch it recover. The hands-on room simulates a volumetric cage bound to the detailed surface, with material parameters proposed by a small network trained on 12,000 synthetic force and displacement tests and refined by a bounded physical fit. Recorded indentation, grasp and incision experiments run on a separate viscoelastic finite-element solver.

## Built so it can be checked

Every specimen, mesh and recipe carries a seed, a source citation and a licence snapshot. The shape cohort of 1,536 recipes passed its surface checks in full, and the browser's copy of the shape and colour flow matches the Python original to within a float32 rounding error. The shape controls, the flow, the texture layer and the physics lab run in the browser; text commands, disease morphology and photo-based colours call the studio's Python API. The release notes list what is not established: no clinical validation, heuristic appearance and no measured tissue mechanics.
