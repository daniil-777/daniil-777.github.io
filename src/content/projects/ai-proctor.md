---
title: AI Proctor
tagline: A real-time AI coach that watches surgery training and talks you through it.
summary: Real-time AI guidance for surgical training. It follows the procedure step by step, flags safety concerns as they happen, answers questions by voice or text and writes the report afterwards.
category: surgical-ai
year: 2022 – now
sortDate: 2026-10-02
organisation: VirtaMed
role: Machine Learning Research Engineer
featured: true
order: 1
topics: [LLM & VLM, Computer Vision, Real-time, Medical]
stack: [Python, LLM, Voice interface, Web app]
highlights:
  - value: Live
    label: step-by-step guidance during the exercise
  - value: Voice + text
    label: ask the coach anything, mid-procedure
  - value: Automatic
    label: report generated after each session
videos:
  - id: ai-proctor-analyser
    title: Surgical Video AI Analyser
    caption: Stage tracking, safety alerts and an "ask the AI" box on a simulated laparoscopic cholecystectomy.
    source: VirtaMed/ai-proctor/ultimate-ai-proctor.mov
    posterAt: 94
    previewAt: 88
    audio: false
  - id: ai-proctor-davos
    title: Suturing coach on an iPad · Davos 2025 demo
    caption: The camera watches a suturing pad; the checklist advances by itself and the coach explains each step.
    source: VirtaMed/ai-proctor/demo_ai_proctor_davos_25_3E890C50-A960-4DFA-A355-F9BCAEC27251.mp4
    posterAt: 44
    previewAt: 40
    audio: true
    # Cuts the browser's address bar and the tablet's status bar out of the recording.
    crop: { top: 120 }
---

## The problem

Surgical trainees learn fastest with an expert beside them, and experts are scarce. A score at the end of an exercise is useful, but it comes too late to warn you, in the moment, that you are about to dissect in the wrong place.

## What I built

An AI proctor for surgical simulators and plain camera setups. It follows the procedure as it unfolds, knows which step the trainee is in, and gives guidance at the moment it is useful.

- **Stage tracking.** The procedure is broken into its clinical steps (exposure, dissection, critical view of safety, clipping, detachment, retrieval) and the proctor marks each one as it is reached.
- **Safety monitoring.** A passive monitor watches the procedure continuously and speaks a warning the moment it detects a mistake, for example smoke thickening near a dissection. It runs independently of the trainee's questions.
- **Conversation.** Trainees ask questions by voice or text at any point, and the explanations adapt to who is operating: beginner, intermediate or expert.
- **Reports.** After the session the system generates the written assessment automatically.

## How it works

Language-model-based components are integrated into the surgical simulators in Python, providing real-time procedural guidance and automated report generation.

The analyser takes three kinds of input: a recorded surgical video, a simulator session bundle, or a live connection to a running simulator, where it combines the video with the simulator's own telemetry. An expert can upload the protocol for a procedure (its steps, objectives, instruments and criteria), which then grounds every answer the AI gives.

The second video shows the same idea on an iPad: point the camera at a suturing pad and the coach runs in the browser, advancing the checklist as each step is completed.
