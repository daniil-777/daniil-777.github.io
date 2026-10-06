---
title: Universal AI Proctor
tagline: Video and camera guidance for real processes.
summary: Turn process videos and optional TXT instructions into an interactive guide. Follow visible stages, ask questions by voice or text, and share reports with video evidence.
category: independent
year: "2026"
sortDate: 2026-10-05
organisation: Independent project
topics: [LLM & VLM, Computer Vision, Real-time]
stack: [React, TypeScript, Fastify, FFmpeg, Vision-language models, Voice interface]
cover: ../../assets/projects/universal-ai-proctor/cover.png
highlights:
  - value: Video + camera
    label: recorded or live process guidance
  - value: TXT optional
    label: reference workflows or editable provisional steps
  - value: Evidence
    label: observations, video clips and shareable reports
links:
  - label: Open the app
    href: https://guide.demtsev.com/
    kind: live
  - label: Source on GitHub
    href: https://github.com/daniil-777/universal-ai-proctor
    kind: code
---

## The idea

A reusable AI observer for recorded videos and live camera feeds. Upload a TXT process guide when one is available, or start from the video alone and review editable provisional steps.

## Guidance that follows the process

The interface keeps the process video beside its guidance, principles and Guardian observations. Questions work by voice or text, and a personal request lets the user explain what help they want.

Stage identification is separate from completion. The observer compares actual visible evidence with the reference and leaves obscured actions uncertain instead of advancing a checklist from elapsed time.

## Evidence after the session

Shareable reports bring together the analysis, observed stages and video clips around Guardian concerns. Saved reports and training activity help users review their sessions afterwards.

## From examples to your own workflow

Five licensed video examples cover house construction, manufacturing, a surgical demonstration, dance and fitness. Each comes with a process guide; users can replace both with their own video and instructions.

The layout adapts to phones and tablets, with adjustable guidance and Guardian panels. A narrated introduction explains the controls before the first session.

## How it is built

A React and TypeScript interface connects to a Fastify backend for vision models, frame sampling, voice and reports. The full app runs on an Oracle server with HTTPS and persistent storage for accounts and saved reports. Its branded address redirects directly to the hosted app. The GitHub Pages version remains an interface preview, with a link to the full app.
