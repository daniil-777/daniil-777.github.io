---
title: Laparoscopic Skills Trainer
tagline: Computer vision that referees keyhole-surgery drills, running entirely in the browser.
summary: A browser app that watches a laparoscopic box trainer through its camera, recognises the kit and the progress of the task in real time, and scores the exercise. All inference runs on the device.
category: surgical-ai
year: 2022 – now
sortDate: 2026-09-29
organisation: VirtaMed
role: Machine Learning Research Engineer
featured: true
order: 4
topics: [Computer Vision, Real-time, In-browser AI, Medical]
stack: [PyTorch, TypeScript, Edge inference, Real-time computer vision]
highlights:
  - value: "5"
    label: exercises shown, from peg transfer to incision closure
  - value: On-device
    label: inference runs fully client-side
  - value: Real time
    label: on a live camera feed
videos:
  - id: lap-peg-transfer
    title: Peg transfer
    caption: Objects are counted as they cross mid-air from one side to the other and back.
    source: VirtaMed/ethicon/peg_transfer.mov
    posterAt: 29
    previewAt: 26
    audio: false
  - id: lap-precision-cutting
    title: Precision cutting
    caption: The cut is tracked against the printed circle, half by half.
    source: VirtaMed/ethicon/precision_cutting.mov
    posterAt: 48
    previewAt: 30
    audio: false
  - id: lap-ligating-loop
    title: Ligating loop
    caption: Loop placement is checked against the mark on the foam organ.
    source: VirtaMed/ethicon/ligating_loop.mov
    posterAt: 20.6
    previewAt: 9
    audio: false
  - id: lap-extracorporeal-knot
    title: Extracorporeal knot
    caption: A simple suture through a penrose drain, timed and checked step by step.
    source: VirtaMed/ethicon/extracorporeal_knot.mov
    posterAt: 31
    previewAt: 16
    audio: false
  - id: lap-stratafix
    title: Stratafix guidance · incision closure
    caption: A continuous closure followed from first pass to final cut.
    source: VirtaMed/ethicon/stratafix.mov
    posterAt: 111
    previewAt: 111
    startAt: 111
    audio: false
---

## The problem

Laparoscopic skills are built on box trainers: a camera, two instruments and a set of standard drills. Someone has to watch each attempt and judge it, and that someone is usually a surgeon.

## What I built

A web application that turns the box trainer's own camera into the examiner. Open a page, place the kit, and the app recognises it, walks the trainee through the task and scores the result.

- **It sees the task.** Real-time vision models analyse the live camera feed: the kit, the instruments and the objects being manipulated.
- **It follows the steps.** Each drill is a sequence of steps such as *insert the instruments*, *cut the first half of the circle* or *tighten the loop on the black mark*, and the checklist advances as they are completed.
- **It gives feedback as you go.** Overlays show where the instruments should be, instruction banners and reference clips explain each step, and a timer and counters keep score.

## How it works

The vision models are developed in PyTorch and deployed to the browser, where inference runs fully client-side on the trainee's own device. The interactive gameplay is written in TypeScript, and I built custom evaluation metrics to track how the models and the system as a whole perform.
