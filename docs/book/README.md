# AI book release validation

The contour decoder is genuinely trained on original procedural vector drawings. Language-model streams in browser QA are mocked; the actual drawing checkpoint and browser inference are real. The paid assistant remains paused. A compatible browser can use its installed local language model, or explicitly consent to the pinned q4 download.

The final release receipt records the exact trained checkpoint, source and build digests, local gates, and public deployment checks. The 49.8 MB corpus stays in local documentation and can be regenerated from the published training scripts. It is excluded from website delivery.

The matching 26.9 MB language runtime exceeds the [Cloudflare static asset file limit](https://developers.cloudflare.com/workers/platform/limits/), so `.assetsignore` omits it from bundled fallback assets. The gateway streams it from the published GitHub origin, as it already does for two large videos. GitHub Pages retains the complete runtime file.
