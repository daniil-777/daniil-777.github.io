---
title: Cuevertis
tagline: Local multimodal AI for reports and process guidance.
summary: Cuevertis combines process guidance with local multimodal report analysis. Search reports and documents with Google EmbeddingGemma, ask questions, and trace answers to source evidence.
category: independent
year: "2026"
sortDate: 2026-10-05
organisation: Independent product
featured: true
order: 5
topics: [LLM & VLM, Computer Vision, Real-time]
stack: [React, TypeScript, Fastify, FFmpeg, Qwen, Google EmbeddingGemma, WebGPU, Ollama, Voice interface]
cover: ../../assets/projects/universal-ai-proctor/cover.png
highlights:
  - value: Local AI
    label: multimodal analysis of reports, documents and frames
  - value: Google embeddings
    label: semantic retrieval combined with keyword search
  - value: Evidence
    label: observations, video clips and shareable reports
links:
  - label: Open the app
    href: https://cueveris.demtsev.com/
    kind: live
  - label: Source on GitHub
    href: https://github.com/daniil-777/universal-ai-proctor
    kind: code
---

## The idea

Cuevertis is a product for understanding real processes: observe a video or camera session, follow the workflow, and review the evidence afterwards. Upload a TXT process guide when one is available, or start from the video alone and review editable provisional steps.

## Guidance that follows the process

The interface keeps the process video beside its guidance, principles and Guardian observations. Questions work by voice or text, and a personal request lets the user explain what help they want.

Stage identification is separate from completion. The observer compares actual visible evidence with the reference and leaves obscured actions uncertain instead of advancing a checklist from elapsed time.

## Evidence after the session

Shareable reports bring together the analysis, observed stages and video clips around Guardian concerns. Saved reports and training activity help users review their sessions afterwards.

## Local multimodal report analysis

The report assistant uses local Qwen vision-language models to analyse session records, uploaded PDFs, charts, tables and retained video frames. Models run through Ollama on a local server or through WebGPU in a compatible browser. The assistant can read selected report pages and images as well as their extracted text.

Answers link to the relevant source passages, report pages and recorded observations. Text answers preserve the original evidence; visual interpretations remain distinct from extracted text. Performance questions use checked calculations from session records.

## Smart information retrieval

Google EmbeddingGemma models power semantic search across report evidence and uploaded documents. Combined with BM25 keyword search, this retrieves relevant passages and pages for natural-language questions while preserving exact references, numbers and source links.

I built the report intelligence engine around these pretrained models: document extraction, hybrid retrieval, local multimodal analysis and source-linked answers. If a local model is unavailable, visitors can still search the recorded evidence directly.

## From examples to your own workflow

Five licensed video examples cover house construction, manufacturing, a surgical demonstration, dance and fitness. Each comes with a process guide; users can replace both with their own video and instructions.

The layout adapts to phones and tablets, with adjustable guidance and Guardian panels. A narrated introduction explains the controls before the first session.

## How it is built

A React and TypeScript interface connects to a Fastify backend for process guidance, frame sampling, local report analysis, retrieval, voice and reports. FFmpeg supplies timestamped video frames. The full app runs on an Oracle server with HTTPS and persistent storage for accounts and saved reports.
