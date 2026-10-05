---
title: FX Regime Radar
tagline: A weather station for currency markets.
summary: A daily pipeline that names the market regime for EUR/USD, USD/CHF and GBP/USD, forecasts the risk that it changes and flags unusual days. It never predicts price direction, by design.
category: independent
year: "2026"
sortDate: 2026-09-29
organisation: Independent project
topics: [Finance, MLOps, LLM & VLM]
stack: [Python, Rust, Hidden Markov model, XGBoost, SHAP, Autoencoder, Conformal prediction, ONNX, GitHub Actions, Fly.io]
highlights:
  - value: "0.548"
    label: PR-AUC on the frozen test, against a 0.162 base rate
  - value: 91.6%
    label: empirical coverage of the 90% conformal band
  - value: SHA-256
    label: every forecast hash-chained before its outcome exists
  - value: 391 + 87
    label: Python and Rust tests, run on every push
links:
  - label: Open the live app
    href: https://fx-regime-radar.fly.dev/
    kind: live
  - label: Source on GitHub
    href: https://github.com/daniil-777/fx-regime-radar
    kind: code
videos:
  - id: fx-regime-radar
    title: FX Regime Radar
    caption: The regime nowcast, a replay of March 2020, the scoreboard and the engineering behind it.
    source: me/projects/finance_weather/financeWeather.mp4
    posterAt: 23.6
    previewAt: 8
---

## The idea

Most FX models try to guess the price. This one names the weather instead: is the market calm, trending, choppy or in crisis, and how likely is that to change this week?

## Three models, three questions

Every weekday a pipeline downloads daily prices, computes strictly backward-looking features and runs three small models.

- **Nowcast.** A four-state hidden Markov model reports the current regime, using filtered probabilities only, never smoothed ones.
- **Forecast.** A calibrated XGBoost classifier estimates the five-day risk that the regime changes, with SHAP explanations and a conformal error band on every number.
- **Detect.** A small autoencoder raises a siren on days that look unlike any calm day it has seen.

A Bayesian changepoint detector and a simple volatility rule vote alongside the HMM, and each forecast shows how many of the three agree. A short language-model call then narrates the computed numbers in plain English. It is tested to refuse questions about price direction.

## Built so it can be checked

The interesting part is not the models but the evidence.

- **A frozen test, scored once.** On data from 2019 onward the forecaster reaches a PR-AUC of 0.548 against a base rate of 0.162.
- **A live forward record.** Each forecast is appended to a hash-chained ledger before the outcome exists and resolved five trading days later. Nothing is ever edited.
- **No look-ahead.** Every feature passes a truncation-invariance test.
- **Two implementations.** A Rust engine replays golden vectors and matches the Python pipeline to 1e-6.

It is an educational tool, not investment advice.
