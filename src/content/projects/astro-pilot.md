---
title: Astro Pilot
tagline: A spacecraft that learns to fly, live in your browser.
summary: A spacecraft in Earth orbit learns to fly through asteroids, comets and city skylines with reinforcement learning. It trains and renders in the browser, and two small on-device models watch the flight and explain it.
category: independent
year: "2026"
sortDate: 2026-09-30
organisation: Independent project
featured: true
order: 2
topics: [Reinforcement Learning, In-browser AI, 3D, LLM & VLM, Real-time, Simulation]
stack: [TensorFlow.js, three.js, PPO, WebGPU, SmolVLM, LoRA, MobileNetV4, ONNX Runtime Web, JavaScript]
highlights:
  - value: 115 → 4
    label: sensor numbers in, flight commands out
  - value: "128"
    label: ships learning in parallel in a web worker
  - value: 13×
    label: fewer collisions within 150k training steps
  - value: ≈ 6 ms
    label: per frame for the on-device safety monitor
links:
  - label: Fly it live
    href: https://daniil-777.github.io/Universal-Spaceship/
    kind: live
  - label: Source on GitHub
    href: https://github.com/daniil-777/Universal-Spaceship
    kind: code
videos:
  - id: astro-pilot
    title: Astro Pilot
    caption: Recorded in the browser. Policy, training, skyline flight, and the on-device narrator.
    source: me/projects/autonomousDriver/astroPilot.mp4
    posterAt: 5.5
    previewAt: 37
---

## The idea

Most reinforcement-learning demos are a video of something that was trained elsewhere. Astro Pilot trains in front of you. Press *Train* and 128 ships start learning in a background worker while the page keeps rendering, with live charts of returns, collisions and losses as the policy improves.

## The pilot

A small actor-critic network (two hidden layers of 128 units) trained with proximal policy optimisation in TensorFlow.js. It sees 115 numbers: 55 forward sensor beams, the six most urgent threats and its own state. It outputs four commands: roll, yaw, pitch rate and thrust. A curriculum makes the belt denser and faster as the policy improves. The trained policy file is 360 KB.

You can take the stick yourself and compare your flying with the autopilot's.

## The world

The scene is three.js, and most of it is computed rather than downloaded.

- **A real orbit.** ISS-like, 420 km up, 7.66 km/s, over an Earth that turns at the true rate for the current date and time, so the terminator and the city lights are where they are right now. The Moon hangs at its true direction and phase.
- **Low passes and atmospheric flight.** The ship descends over real satellite imagery and flies routes through the Alps, Zhangjiajie, New York, London, Moscow and Dubai, with airliners as the hazards.
- **A ship that flies with its surfaces.** Elevons, split rudders and thrust vectoring follow the pilot's commands through rate-limited actuators.

## Two models that watch

Both run on the device.

- **Pilot Eye** is a MobileNetV4 safety monitor with five heads (verdict, reasons, action, time to collision, clearance) that reads each frame in about 6 ms.
- **The Narrator** is SmolVLM-256M fine-tuned with LoRA. Ask it to describe the view, whether it is safe, or what to do next, and it answers from the picture, on WebGPU, with no cloud.
