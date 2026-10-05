---
title: Ultrasound Anatomy Detection
tagline: Finding anatomy in ultrasound, from 60% to 90% accuracy.
summary: Detecting anatomical structures in ultrasound images with transformer-based detection models, which raised accuracy from 60% to 90%. Shown with a pipeline that produces labelled training images from simulation.
category: surgical-ai
year: 2022 – now
sortDate: 2026-01-15
organisation: VirtaMed
role: Machine Learning Research Engineer
topics: [Computer Vision, Medical, Synthetic data]
stack: [Python, PyTorch, Transformer detection models, Segmentation, Ray tracing, Synthetic data]
highlights:
  - value: 60% → 90%
    label: anatomical structure detection accuracy
  - value: Automatic
    label: annotation, straight from the simulation
cover: ../../assets/projects/ultrasound-anatomy-detection/segmentation.png
gallery:
  - src: ../../assets/projects/ultrasound-anatomy-detection/segmentation.png
    alt: Six ultrasound images with anatomical structures highlighted in colour.
    caption: Anatomical structures segmented in ultrasound images.
  - src: ../../assets/projects/ultrasound-anatomy-detection/pipeline.png
    alt: Five-stage pipeline from 3D model to ray-traced ultrasound, automatic annotation, training on synthetic data and inference on a real scan.
    caption: "The pipeline: 3D modelling, ray tracing, automatic annotation, training on synthetic data, inference on real data."
---

## The problem

Ultrasound is hard to read and expensive to label. Every annotated image needs a clinician's time, and a detector needs a great many of them.

## The approach

Let the simulation do the labelling. A simulated ultrasound image is rendered from a 3D model, so the position of every structure in it is already known.

1. **3D modelling.** The anatomy starts as a 3D model.
2. **Ray tracing.** An ultrasound image is rendered from it.
3. **Automatic annotation.** The labels for each structure are produced together with the image.
4. **AI on synthetic data.** Detection models are trained on the generated set.
5. **Inference on real data.** The trained model is applied to real scans.

## Result

With transformer-based detection models, anatomical structure detection in ultrasound images improved from 60% to 90% accuracy.

This is one use of the scalable data-processing pipeline I designed at VirtaMed, which converts 3D simulation output into training-ready datasets for machine-learning and LLM-based models.
