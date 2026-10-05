---
title: Generative Realism for Simulators
tagline: Generative models that make a simulator look like the operating room.
summary: A texture-enhancement system that turns a surgical simulator's rendered frame into a far more lifelike image of the same scene.
category: surgical-ai
year: 2022 – now
sortDate: 2026-06-01
organisation: VirtaMed
role: Machine Learning Research Engineer
topics: [Generative AI, Computer Vision, Medical, Simulation]
stack: [Generative models, Image-to-image, Texture enhancement]
highlights:
  - value: Same scene
    label: the layout stays, the appearance changes
  - value: α
    label: one parameter blends smoothly between looks
cover: ../../assets/projects/generative-realism/after.png
compare:
  before: ../../assets/projects/generative-realism/before.png
  after: ../../assets/projects/generative-realism/after.png
  beforeLabel: Simulator render
  afterLabel: Enhanced
  caption: The same frame before and after enhancement. Drag to compare.
gallery:
  - src: ../../assets/projects/generative-realism/segmentation.png
    alt: Semantic map of the scene with each tissue type in a flat colour.
    caption: The semantic map of the same scene. Each colour is one structure.
  - src: ../../assets/projects/generative-realism/interpolation.png
    alt: Seven versions of one surgical scene, shifting gradually in lighting and tone as alpha goes from 0 to 1.
    caption: A single parameter, α, moves smoothly between two appearances of the same scene.
---

## The problem

A surgical simulator has to behave correctly first: tissue must deform and respond to instruments in real time. That leaves a limited budget for how it looks, and the closer the picture is to a real endoscope feed, the more convincing the training.

## What I built

A texture-enhancement system that boosts the visual fidelity and realism of surgical simulators. It takes a rendered frame and produces a more lifelike version of the same scene: fine vessels, moisture and the surface detail of real tissue appear, while the structures stay where the simulation put them.

Drag the slider above to compare a simulator frame with its enhanced counterpart.

## Controlling the look

Generated appearance can be steered. The α strip among the figures at the end of this page shows one scene rendered at seven values of a single parameter, moving smoothly from one look to another.
