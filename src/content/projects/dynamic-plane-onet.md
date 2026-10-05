---
title: Dynamic Plane Convolutional Occupancy Networks
tagline: Letting the network choose the planes that describe a 3D shape best.
summary: A WACV 2021 paper. An implicit 3D representation that learns where to project point-cloud features instead of using three fixed planes, improving surface reconstruction for objects and indoor scenes.
category: research
year: "2020"
sortDate: 2020-11-11
organisation: ETH Zurich · 3D Vision
role: Co-first author
topics: [Computer Vision, 3D, Publication]
stack: [PyTorch, Implicit neural representations, Point clouds, PointNet, U-Net, Positional encoding]
highlights:
  - value: WACV 2021
    label: published, equal first-author contribution
  - value: Up to 7
    label: learned planes, with steady gains as planes are added
documents:
  - id: dynamic-plane-onet-paper
    kind: paper
    title: Dynamic Plane Convolutional Occupancy Networks
    source: ETH/semester-project/Dynamic Plane Convolutional Occupancy Networks.pdf
    original:
      label: arXiv:2011.05813
      href: https://arxiv.org/abs/2011.05813
links:
  - label: Code
    href: https://github.com/dsvilarkovic/dynamic_plane_convolutional_onet
    kind: code
cover: ../../assets/projects/dynamic-plane-onet/objects.png
coverFit: contain
gallery:
  - src: ../../assets/projects/dynamic-plane-onet/objects.png
    alt: Reconstructed lamps, chairs and phones compared across methods.
    caption: Object-level reconstruction on ShapeNet, compared with ONet and ConvONet.
  - src: ../../assets/projects/dynamic-plane-onet/pipeline.png
    alt: Pipeline. Point clouds are encoded, a plane predictor learns dynamic planes, features are projected onto them, processed by a U-Net, and queried to predict occupancy.
    caption: The pipeline. A small network predicts the planes; features are projected onto them and processed by a shared U-Net.
  - src: ../../assets/projects/dynamic-plane-onet/scenes.png
    alt: Reconstructed synthetic rooms compared across methods.
    caption: Scene-level reconstruction of synthetic indoor rooms from point clouds.
---

## The problem

Convolutional Occupancy Networks reconstruct large 3D scenes by projecting point features onto three axis-aligned planes and running a CNN on them. Three fixed planes are a strong assumption: real objects are not always aligned with the axes, and their most informative views rarely are.

## The idea

Learn the planes. A shallow network looks at the input point cloud and predicts the planes that best describe it, along with plane-specific features. Per-point features are projected onto these dynamic planes, processed by a U-Net with shared weights, and queried to predict whether any point in space is inside the surface.

Positional encoding of the point coordinates adds fine detail, and a similarity loss encourages the planes to spread over diverse directions.

## Result

The method outperformed the state of the art for surface reconstruction from unoriented point clouds on ShapeNet and on an indoor scene dataset. Reconstruction quality improved progressively as planes were added, up to seven, and the model generalised better to inputs in unseen orientations.

Written with Stefan Lionar, Dusan Svilarkovic and Songyou Peng as a 3D Vision course project at ETH Zurich, and published at the Winter Conference on Applications of Computer Vision 2021.
