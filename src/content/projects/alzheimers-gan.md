---
title: Alzheimer's Brain Changes with GANs
tagline: Showing what Alzheimer's disease does to one specific brain.
summary: Amgen Scholars research at ETH Zurich's Computer Vision Lab. A Wasserstein GAN learns a deformation that maps a brain MRI between disease stages, making subject-specific tissue loss visible.
category: research
year: "2018"
sortDate: 2018-09-01
organisation: Amgen Scholars · ETH Zurich
role: R&D Software Engineer, Internship
topics: [Generative AI, Medical, Computer Vision, Publication]
stack: [Wasserstein GAN, MRI, Deformation fields, Image registration, Jacobian maps]
highlights:
  - value: Cambridge
    label: presented at the Amgen Scholars Symposium, 2018
  - value: Deformation
    label: model instead of an additive one
documents:
  - id: alzheimers-poster
    kind: poster
    title: Studying Alzheimer’s Disease Related Brain Deformations Using Generative Adversarial Networks
    source: Amgen/Amgen_Poster.pdf
    file: amgen-scholars-poster-2018.pdf
cover: ../../assets/projects/alzheimers-gan/poster.png
gallery:
  - src: ../../assets/projects/alzheimers-gan/poster.png
    alt: Research poster titled Studying Alzheimer's Disease related brain deformations using Generative Adversarial Networks.
    caption: The poster presented at the Cambridge Amgen Scholars Symposium.
---

## The problem

Alzheimer's disease shows up in MRI as enlarged ventricles and a shrinking hippocampus. Group statistics describe the average patient. The goal here was to visualise the effect for one individual: what separates this brain at the mild-cognitive-impairment stage from the same brain with Alzheimer's?

## The idea

An earlier method learned an additive map: a generator produced a difference image that, added to a scan of one class, yields a scan of the other. That does not reflect physiology, because disease does not add intensity, it moves tissue.

I replaced the additive model with a **deformation model**. The generator predicts a motion field, a spatial transformer warps the input image with it, and a Wasserstein critic judges whether the result is indistinguishable from real scans of the target class. An L1 penalty limits the extent of the change and a total-variation term keeps the field smooth.

## What it gives

- Better results than the additive baseline.
- A **Jacobian map** computed from the motion field, which estimates local tissue gain or loss at each voxel.
- A framework for population-wide effects, by registering individual maps to a common template and averaging.

With Christian F. Baumgartner and Prof. Ender Konukoglu at ETH Zurich's Computer Vision Laboratory. Presented at the Cambridge Amgen Scholars Symposium in 2018.
