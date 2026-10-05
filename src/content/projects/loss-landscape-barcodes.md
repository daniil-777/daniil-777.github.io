---
title: Barcodes of Loss Landscapes
tagline: Measuring how hard a neural network's loss surface is to descend.
summary: Topological data analysis of neural-network loss surfaces. An algorithm computes the barcodes of local minima, and experiments show that deeper and wider networks have friendlier landscapes.
category: research
year: "2019"
sortDate: 2019-08-01
organisation: Data Analytics Group, Moscow
role: R&D intern, co-author
topics: [Deep learning theory, Publication]
stack: [Python, Topological data analysis, Persistence barcodes, Morse theory, Optimisation]
highlights:
  - value: O(N log N)
    label: for the principal part of the algorithm
  - value: 10⁹ points
    label: tested, in up to 15 dimensions
  - value: Doklady 2023
    label: journal publication
documents:
  - id: loss-landscape-barcodes-paper
    kind: paper
    title: Barcodes as Summary of Loss Function Topology
    source: MIPT/barcodes/1912.00043v3.pdf
    original:
      label: arXiv:1912.00043
      href: https://arxiv.org/abs/1912.00043
links:
  - label: Code on GitHub
    href: https://github.com/daniil-777/BarCode
    kind: code
cover: ../../assets/projects/loss-landscape-barcodes/cover.png
coverFit: contain
gallery:
  - src: ../../assets/projects/loss-landscape-barcodes/cover.png
    alt: Surface plots of two test functions, the correspondence between their minima and saddles, and the resulting barcodes.
    caption: Test functions, the pairing of each minimum with its saddle, and the barcodes the algorithm computes.
  - src: ../../assets/projects/loss-landscape-barcodes/sublevel.png
    alt: Three diagrams of a one-dimensional function showing connected components of sublevel sets merging at saddle points.
    caption: How a barcode is born. As the level rises, each local minimum starts a component that later merges into a lower one at a saddle.
---

## The problem

Gradient descent finds good solutions on loss surfaces that are wildly non-convex, and nobody fully understands why. To study the question you first need a way to measure how bad a landscape's local minima really are.

## The idea

Borrow from topology. Each local minimum is paired with the saddle point at which its basin merges into a deeper one. The height difference between the two is a topological invariant: the penalty an optimiser must pay to escape that minimum. The collection of these segments is the *barcode* of the loss function.

Existing software computed barcodes on grids with cubic worst-case cost and stalled beyond six dimensions. We described an algorithm that works on arbitrarily sampled point clouds, whose principal part runs in O(N log N), and tested it in up to 15 dimensions on as many as 10⁹ points.

## What it showed

- The barcodes of local minima sit in a small lower part of the range of the loss.
- Increasing a network's depth and width lowers those barcodes.

Both observations point the same way: larger networks have landscapes that are easier to optimise, with implications for learning and generalisation.

With Serguei Barannikov, Alexander Korotin, Dmitry Oganesyan and Evgeny Burnaev. Published in *Doklady Rossiiskoi Akademii Nauk. Matematika, Informatika, Protsessy Upravleniya*, vol. 514 (2023).
