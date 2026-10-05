# Public hosting

This publication copy serves https://demtsev.com/ from GitHub Pages, with DNS managed by Cloudflare. Push to `main` runs the tested Pages workflow. Provider keys are never part of this repository. The optional chat Worker is configured separately; without a public endpoint the portfolio assistant uses its on-device/site search modes.

# demtsev.com

Portfolio of Daniil Emtsev. A static site built with [Astro](https://astro.build); videos play through
[Mux Player](https://www.mux.com/player).

```bash
npm install
npm run dev        # http://localhost:4321
npm test           # filter logic + content checks
npm run build      # static site in build/
npm run preview    # serve build/ locally
```

Needs Node 22.18 or newer. `npm run media` also needs `ffmpeg` on your PATH, and `npm run docs` needs poppler
(`pdftoppm`, `pdfinfo`).

## Add a project

1. Copy any file in `src/content/projects/` and rename it. The file name becomes the URL: `my-project.md` is served at
   `/work/my-project/`.
2. Edit the frontmatter. Every field is described in `src/content.config.ts`, and a mistake fails the build with a
   message naming the field.
3. Write the story below the frontmatter in Markdown. `## Headings`, lists and **bold** are styled.

Useful fields:

| Field | What it does |
|---|---|
| `category` | `surgical-ai`, `independent` or `research`. The first row of the catalog filter. |
| `topics` | The filter chips. Pick from the list in `src/data/taxonomy.ts`; add a new topic there first. |
| `stack` | Free-form technology keywords. Shown on the project page and matched by search. |
| `featured` + `order` | Puts the project in the large tiles at the top of the home page. Needs a video. |
| `cover` | Card image for a project without video. `coverFit: contain` keeps a diagram uncropped. |
| `gallery` | Figures with `alt` text and an optional `caption`. Put the images in `src/assets/projects/<name>/`. |
| `compare` | A before/after slider (`before`, `after`, and a label for each). |
| `links` | Each link has a `kind`. On the project's card and tile, `live` becomes a **Demo** button and `code` a **GitHub** button. All links, including `site`, appear under the title on the project page. |
| `documents` | Papers, patents and posters, previewed page by page on the site. See *Add a document*. |

## Add a video

1. Put the recording anywhere in this folder. Raw recordings are not committed; see `.gitignore`.
2. List it in the project's frontmatter:

   ```yaml
   videos:
     - id: my-demo              # unique across the site
       title: My demo
       caption: One line about what it shows.
       source: me/projects/myProject/demo.mp4
       posterAt: 4              # second used as the poster frame
       previewAt: 10            # where the silent hover preview starts
       startAt: 10              # optional: start Play at this moment; visitors can seek back
       audio: false             # optional: strip the sound
   ```

3. Run `npm run media`. It writes a 1080p MP4, a 960px copy for phones and a short preview into `public/media/`,
   a poster into `src/assets/posters/`, and records the dimensions in `src/data/media.json`. Commit all of them.

   Only what changed is redone: editing `posterAt` regenerates just the poster, a new recording redoes everything.
   `npm run media -- --force` redoes everything.

The first video of a project is the one shown on its card and at the top of its page, and the one its **Video**
button plays. The showreel in the hero is cut from the clips listed in `src/data/showreel.json`.

### Stream from Mux

Until a video has a Mux playback id, Mux Player plays the MP4 from `public/media/`. To stream from Mux instead:

```bash
MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... npm run mux
```

This uploads every video that is not on Mux yet and writes the playback ids to `src/data/mux.json`. Commit that file
and rebuild. Create the token in the Mux dashboard under Settings → Access Tokens with Mux Video read and write.

## Add a document

A paper, patent or poster opens in a preview on the site itself: its pages are rendered to images once, so the browser
never loads a PDF viewer. Only add documents that are already public.

1. Put the PDF anywhere in this folder. Like the recordings, the source is not committed.
2. List it in the project's frontmatter:

   ```yaml
   documents:
     - id: my-paper             # unique across the site
       kind: paper              # paper, patent or poster
       title: The Title of the Paper
       source: ETH/my-paper.pdf
       original:                # optional: where it was first published
         label: arXiv:2011.05813
         href: https://arxiv.org/abs/2011.05813
   ```

3. Run `npm run docs`. It writes the PDF to `public/papers/` (with the title in its metadata, if `python3` has
   `pypdf`), one image per page and a thumbnail to `public/docs/<id>/`, and records them in `src/data/documents.json`.
   Commit all of them. Only what changed is redone; `npm run docs -- --force` redoes everything.

4. Add the document's id to `APPROVED` in `tests/documents.test.ts`, with the `sha256.source` value that step 3
   recorded in `documents.json`. The tests fail until you do: they pin every published document to its content, so
   that nothing is published, or swapped for another file, without a deliberate edit.

The project's card, tile and page then get a **Paper**, **Patent** or **Poster** button that opens the preview, and
the page gets a *Documents* block. To list the document in the Research section, add its citation to `publications`
in `src/data/site.ts`. `npm test` fails if `public/` holds a PDF that is not declared this way.

## Edit everything else

Name, bio, timeline, publications, awards, skills and links are plain data in `src/data/site.ts`. A publication there
is a citation (authors, venue, year) of a document id; the document itself is declared in its project.

The globe in the navigation switches instantly between English, German, French, Italian, Spanish, Simplified Chinese
and Russian. The choice persists on this device and travels in internal links as `?lang=de` (or another locale code).
Page copy, accessible labels, filters, dialogs, assistant controls and the standalone 3D preview share the translations
in `src/i18n/locales/`. The exact English copy is the key. Add new copy to every catalog; `npm test` checks key and
placeholder coverage, and `npm run check:i18n` checks all rendered HTML after a build. `src/i18n/shared.json` lists
the shared navigation and dynamic control strings that each page needs. Page translations are inline; the full
catalog is fetched only for the assistant and the standalone 3D view. PDF documents, original publication titles,
figures embedded in images and recorded video audio retain their source language. Deploy the updated Worker
alongside the site to make hosted AI replies follow the explicitly selected language.

## The assistant

The **Ask AI** button opens a chat that answers questions about the site's content and links the pages it used.
Nothing of it is downloaded until the button is pressed.

Its knowledge is built during the normal `npm run build` from `src/data/site.ts`, the project files and the fact
files in `src/content/facts/`, and written to `build/chat/kb.json`. Nothing else is read: no CV, no PDF, no private
folder. `npm test` and `npm run check:build` fail if a phone number, a foreign email address or a private path gets in.

### Microphone input

The microphone beside Send uses **Cactus Whistle**, released October 2, 2026,
for on-device dictation. Press it to load the voice model and allow microphone access;
press it again to finish. Recording automatically stops at 30 seconds. The transcript
is inserted at the current selection, remains editable, and is never sent automatically.
Cancel, Escape, New chat, closing the dialog or hiding the page discards the recording.
Audio is never uploaded. It works independently of the selected answer mode.

The Apache 2.0 model and CPU WebAssembly runtime are served from
`public/vendor/whistle/2026-10-02/` (17.9 MB total). Downloads happen only after a
microphone click, are verified against SHA-256 hashes, and use a dedicated browser
cache when storage is available. HTTPS or localhost, MediaRecorder, Web Audio and
WebAssembly SIMD are required; no API key, WebGPU or cross-origin isolation is needed.
English, German, French, Spanish, Italian, Dutch and Polish are detected automatically.
The classic worker is `public/chat/whistle.worker.js`; UI and lifecycle handling are
in `src/scripts/chat/voice.ts`. The release pins and asset provenance are recorded
in the vendor folder's `manifest.json`. Re-fetch the exact assets with `npm run voice:assets`.

Sources: [Cactus release and browser demo](https://www.cactuscompute.com/whistle),
[Whistle model](https://huggingface.co/Cactus-Compute/whistle),
[Needle engine](https://huggingface.co/Cactus-Compute/needle3).

### Add a fact

Create `src/content/facts/<name>.md`, for things visitors ask that no page states:

```yaml
---
question: Is Daniil open to new roles?       # shown on /ask/
asks: [available, hiring, job offer]         # other words visitors may use
---
One short paragraph in the third person.
```

A fact is shown as *the* answer only when every word of the visitor's question is one its `question` or `asks`
use; otherwise it is at most quoted as a passage. So list in `asks` the words people really use, including names the
site does not have ("Google" in `employers.md` makes "When did he work at Google?" answer with the real list).

A fact with `sensitive: true` and `triggers: [phrase, ...]` is a fixed reply for a private topic: a question
containing one of the phrases gets that reply, and no model is asked. Triggers match other forms of a word
("earns") and one typo in a long word ("adress"), and fire only when the question is about Daniil ("his
references") or about nothing else: "Which references does the paper cite?" is left alone. The fields are described
in `src/content.config.ts`. Every fact is published on `/ask/`, so write only what may be public.

Quotes are never worded as an answer when the site does not answer: a question with a word the site never uses,
a yes-or-no question, or a single word found somewhere in a text gets "closest passages" or "I don't know that".
`tests/chat/golden.ts` lists the questions that must stay that way (`HEDGED`, `PRIVATE`, `UNANSWERABLE`); add to
them when you find a new one.

### Conversational AI and portfolio grounding

Ask AI supports a hosted OpenAI conversation and a browser-only portfolio search fallback.
The hosted assistant receives the entire public knowledge base (roughly 17,000 tokens),
rebuilt from site data, project write-ups and FAQ content. This portfolio does not need a
separate vector database or uploaded training dataset. Add or update published content and
rebuild the site; the Worker refreshes the knowledge base every five minutes.

The default model is `gpt-6-luna` with no reasoning step, Standard processing and streamed output. Complete
paragraphs are displayed after citation, figure and private-claim checks; raw unfinished
model text is not displayed. These checks reduce common mistakes but do not establish
semantic entailment: review real model answers before release. Change
`worker/wrangler.jsonc` to choose another model supported by the Responses API. The shared
instructions and portfolio precede conversation-specific content. For GPT-5.6 and newer,
an explicit cache breakpoint after the portfolio reuses this shared prefix and avoids
cache-write charges for dynamic visitor messages. Cache read/write token counts are logged.
Cache hits and response latency depend on provider conditions. Visible output is capped at
1,200 tokens, with concise answers requested by default.

The assistant can compare documented skills with a proposed role, explain projects, answer
follow-ups and general professional/technical questions, and share resources. It distinguishes
transferable skills from qualifications that are not documented. It never confirms availability,
accepts a role, or negotiates on Daniil's behalf. Sources are displayed with personal claims.
The check is a useful filter, not a proof that every model sentence is true.

Resource cards come from `/chat/resources.json`, built from public project/media/document
manifests. They can play videos in the dialog, open demos/code, or download PDFs. Links from
model text are never converted to HTML or resource URLs. The public CV is
`public/docs/daniil-emtsev-cv.pdf`, compiled only from public portfolio information. Regenerate it
with `npm run cv` after installing `scripts/requirements-cv.txt` in a Python environment (set
`CV_PYTHON` to that environment's executable).

### Connect OpenAI through the Cloudflare Worker

A real hosted LLM requires an OpenAI API key and a deployed backend. ChatGPT subscriptions and
browser logins do not configure this application. Never put a provider key in a `PUBLIC_*`
variable, frontend JavaScript, or a committed file.

1. In the OpenAI API platform, create a project API key and configure acceptable billing/usage
   limits. Official setup: https://developers.openai.com/api/docs/quickstart
2. Deploy the static site and verify `/chat/kb.json` and `/chat/resources.json` are public.
3. From `worker/`, run `npm install`, `npx wrangler login`, then
   `npx wrangler secret put OPENAI_API_KEY`. Enter the key at the CLI prompt. Run
   `npx wrangler deploy`. `CHAT_PROVIDER=openai` and `CHAT_MODEL=gpt-6-luna` are already configured.
4. Set the GitHub repository Actions variable `PUBLIC_CHAT_ENDPOINT` to the Worker base address,
   without `/v1/chat`, and rebuild/deploy the site. With another host, set the same build variable
   there. AI conversation becomes the default; portfolio search remains available.
5. Run `npm run chat:smoke -- https://YOUR-WORKER.workers.dev` to check the deployed endpoint.
   This makes real billable API requests. Review role-fit answers and citations with your real key
   before a public release. `503 kb` means the published knowledge base is unreachable;
   `503 upstream` can mean a missing/invalid key or provider issue.

The key stays inside the Worker. No provider credentials are requested from visitors.
`DAILY_LIMIT` caps requests across all visitors (100/day by default), with additional per-IP and
global rate limits. The Worker logs status, model, token counts and duration, never message text.
Cloudflare invocation logs are disabled in the supplied configuration. OpenAI requests use
`store:false`; provider processing/retention policies still apply.

For an economical start, create a dedicated portfolio project in the API platform, buy the
minimum $5 prepaid credit, and turn off automatic reload during billing setup. API billing
is separate from a ChatGPT subscription. Project monthly budgets are alerts, not enforced
spending caps; the Worker's request limit is enforced. Review actual token usage and cache
hit rates before raising the daily limit.

As checked on 4 October 2026, Standard GPT-6 Luna costs $0.10 per million input tokens,
$0.01 per million cached input tokens, $0.125 per million cache-write tokens and $0.50 per
million output tokens. An illustrative 20,000-token shared portfolio prefix, 1,000 uncached
question/history tokens and 350 output tokens costs about $0.002775 on a cache write or
$0.000475 on a complete prefix-cache hit. That's roughly $2.78 or $0.48 per 1,000 replies,
respectively, excluding hosting/taxes. Actual tokens and cache hits vary. GPT-5 Nano has
lower raw prices, but requires different reasoning settings and should be evaluated before
using it for versatile role-fit conversation.

Sources: https://developers.openai.com/api/docs/pricing,
https://developers.openai.com/api/docs/models/gpt-6-luna,
https://developers.openai.com/api/docs/guides/prompt-caching,
https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing,
https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform.

The browser keeps the displayed transcript in session storage. Only up to six earlier successful
AI conversation turns are sent as context; search-mode messages and locally answered private
questions stay local. New chat clears the transcript. Prior replies are never treated as factual
portfolio evidence. Inputs support up to 2,000 characters, including a short role description.

### Local development and verification

Copy `worker/.dev.vars.example` to `worker/.dev.vars` and replace the placeholder with your key.
Start the site with `npm run dev` and the Worker with `npm run dev --prefix worker`.
In a second site terminal, set `PUBLIC_CHAT_ENDPOINT=http://127.0.0.1:8787` when running
`npm run dev`; restart the development server after changing build variables. For a static preview,
set that variable for `npm run build` and then run `npm run preview`.

Without credentials, `npm run chat:smoke` exercises the real Worker against an API stand-in.
It proves routing, streaming, context and cancellation plumbing; it cannot measure a real model's
answer quality or latency. `npm test`, `npm run check`, `npx tsc -p worker/tsconfig.json --noEmit`,
`npm run build` and `npm run check:build` cover the implementation and public artifacts.

Existing Anthropic installations remain supported: select `CHAT_PROVIDER=anthropic`, set a
compatible Claude `CHAT_MODEL`, and provision `ANTHROPIC_API_KEY`. Their native document citations
are converted to the same source links. On-device answer generation remains off until evaluated.

Official API references: https://developers.openai.com/api/docs/guides/streaming-responses,
https://developers.openai.com/api/docs/guides/prompt-caching,
https://developers.openai.com/api/docs/models/gpt-6-luna.

## Deploy to demtsev.com

The repository ships a GitHub Actions workflow that tests, builds and publishes to GitHub Pages on every push to `main`.

1. Create a repository on GitHub and push this folder to its `main` branch. Run `git init` here, inside this folder,
   not in a parent folder: the `.gitignore` allowlist that keeps the raw documents and recordings out of the repository
   only works from this root.
2. In the repository: Settings → Pages → Source: **GitHub Actions**.
3. Still under Pages, set the custom domain to `demtsev.com` (already declared in `public/CNAME`) and tick
   *Enforce HTTPS* once the certificate is issued.
4. At your domain registrar, point the domain at GitHub Pages:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `<your-github-username>.github.io` |

The output is plain static files, so any other static host works as well. Point it at `npm run build` and the `build/`
directory. The output directory is `build/` rather than Astro's default `dist/`, because `dist/` in this folder holds
unrelated files and Astro empties its output directory on each build.

## Layout

```
src/content/projects/   one Markdown file per project
src/data/               site.ts (profile), taxonomy.ts (filters), media.json, documents.json, mux.json, showreel.json
src/components/         page sections and building blocks
src/content/facts/      one Markdown file per fact the assistant knows beyond the pages
src/pages/              index.astro, work/[slug].astro, ask.astro, chat/ (knowledge base), 404.astro, sitemap.xml.ts
src/lib/                filter.ts (catalog filtering), projects.ts, documents.ts, qr.ts, chat/ (search, prompt, checks)
src/scripts/chat/       the assistant's interface, loaded when it is opened
worker/                 the endpoint for "AI answer" (Cloudflare Worker), deployed separately
src/assets/             images optimised at build time
public/media/           transcoded videos, served as they are
public/papers/          the PDFs of the documents
public/docs/            their pages as images, for the preview
scripts/                media.mjs (ffmpeg pipeline), documents.mjs (PDF pages), mux-upload.mjs, chat-*.mjs and check-build.mjs (assistant checks)
tests/                  node --test
```
