import { BOOK_TOPICS, bookEvidence, bookPrompt, cleanBookSentence, prepareBookModel, type BookModel, type BookModelChoice, type BookModelMode, type BookTopic } from './model.ts';
import { LANGUAGE_EVENT, t } from '../../i18n/client.ts';
import { loadBookFacts, reviewedThought, type BookSource, type BookThought } from './content.ts';
import { createBookPages } from './pages.ts';
import { mountBookInteraction } from './interaction.ts';
import type { FactPack } from '../watch/facts.ts';

export interface AiBookHandle { unmount(): void }
export interface AiBookOptions {
  /** Allows a local inference adapter to be supplied without changing the book presentation. */
  prepareModel?: (signal: AbortSignal, mode?: BookModelMode) => Promise<BookModelChoice>;
  cycleDelayMs?: number;
  letterDelayMs?: number;
}

/** A quiet, resumable ink animation. Inference begins only after a visitor asks for it. */
export function mountAiBook(root: HTMLElement, options: AiBookOptions = {}): AiBookHandle {
  const node = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const output = node('[data-book-output]');
  const quill = node('[data-book-quill]');
  const status = node('[data-book-status]');
  const origin = node('[data-book-origin]');
  const generate = node<HTMLButtonElement>('[data-book-generate]');
  const generateLabel = node('[data-book-generate-label]');
  const replay = node<HTMLButtonElement>('[data-book-replay]');
  const pause = node<HTMLButtonElement>('[data-book-pause]');
  const pauseLabel = node('[data-book-pause-label]');
  const topic = node<HTMLSelectElement>('[data-book-topic]');
  const consent = node('[data-book-consent]');
  const download = node<HTMLButtonElement>('[data-book-download]');
  const cancel = node<HTMLButtonElement>('[data-book-cancel]');
  const accessible = node('[data-book-accessible]');
  const animate = node<HTMLInputElement>('[data-book-animate]');
  const modelNote = node('[data-book-model-note]');
  const privacy = node('[data-book-privacy]');
  const sources = node('[data-book-sources]');
  if (!output || !quill || !status || !origin || !generate) throw new Error('AI book markup is incomplete.');
  const ink = document.createTextNode('');
  const cursor = node('[data-book-cursor]') ?? document.createElement('span');
  cursor.dataset.bookCursor = '';
  cursor.setAttribute('aria-hidden', 'true');
  const sample = output.textContent?.trim() ?? '';
  const writingArea = output.parentElement!;
  const volume = root.querySelector<HTMLElement>('.ai-book__volume');
  output.replaceChildren(ink, cursor);
  output.setAttribute('data-no-translate', '');
  output.setAttribute('lang', 'en');
  if (accessible) { output.setAttribute('aria-hidden', 'true'); accessible.setAttribute('lang', 'en'); accessible.setAttribute('data-no-translate', ''); }
  const events = new AbortController();
  const on = (target: EventTarget, name: string, handler: EventListener) => target.addEventListener(name, handler, { signal: events.signal });
  let disposed = false, paused = false, intersecting = typeof IntersectionObserver === 'undefined', writing = false;
  let animationEnabled = animate?.checked ?? !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, lastFrame = 0, elapsed = 0, index = 0, run = 0, variation = 0;
  let cycle = 0, previewIndex = 0;
  let characters: string[] = [], inscription = sample;
  let controller: AbortController | undefined;
  let model: BookModel | undefined;
  let candidate: Extract<BookModelChoice, { kind: 'download' }> | undefined;
  let busy = false;
  let statusSource = 'Ready to write', progressPercent: number | undefined;
  let noteSource = '';
  let originSource = root.dataset.bookReviewed === 'true' ? 'Reviewed thought' : 'Sample inscription';
  let pack: FactPack | undefined;
  const initial = { text: sample, sources: reviewedThought(selectedTopic()).sources, reviewed: root.dataset.bookReviewed === 'true' };
  const pages = createBookPages(root, { thought: initial, mode: selectedTopic(), origin: originSource, seed: 20261006 }, {
    motion: () => animationEnabled, visible: canAnimate,
    start() { clearCycle(); stopFrame(); setStatus('Turning the page…'); },
    commit(page) { originSource = page.origin; root.dataset.bookGenerated = String(!page.thought.reviewed); setSources(page.thought.sources); syncLabels(); write(page.thought.text); },
    settled: syncAnimation,
  });
  if (root.dataset.bookReviewed === 'true') void loadBookFacts(events.signal).then(value => { if (!disposed) pack = value; }).catch(() => {});

  function setStatus(source: string, progress?: number) {
    statusSource = source; progressPercent = progress;
    status!.textContent = `${t(source)}${progress === undefined ? '' : ` ${progress}%`}`;
  }
  function syncLabels() {
    if (generateLabel) generateLabel.textContent = t(busy ? 'Stop writing' : 'New thought');
    if (pauseLabel) pauseLabel.textContent = t(paused ? 'Resume writing' : 'Pause writing');
    origin!.textContent = t(originSource);
    setStatus(statusSource, progressPercent);
    if (modelNote) modelNote.textContent = t(noteSource);
    if (privacy) privacy.textContent = t('Local AI stays on this device.');
  }

  function setModelNote(source = '') {
    noteSource = source;
    if (modelNote) { modelNote.textContent = t(source); modelNote.hidden = !source; }
  }
  function clearCycle() { if (cycle) window.clearTimeout(cycle); cycle = 0; }
  function setSources(items: BookSource[]) {
    if (!sources) return;
    sources.replaceChildren(...items.slice(0, 3).filter(item => /^https:\/\/|^\/(?!\/)/.test(item.url)).map(item => {
      const link = document.createElement('a'); link.href = item.url; link.textContent = item.title;
      if (item.url.startsWith('https:')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      return link;
    }));
  }
  function scheduleCycle() {
    clearCycle();
    if (!canAnimate() || !animationEnabled || writing || consent?.hidden === false) return;
    cycle = window.setTimeout(() => {
      cycle = 0;
      if (!canAnimate() || !animationEnabled) return;
      if (busy || root.dataset.bookGenerated === 'true') write(inscription);
      else nextPreview();
    }, options.cycleDelayMs ?? 4000);
  }
  function nextPreview(reset = false, generateAfter = false) {
    previewIndex = reset ? 0 : previewIndex + 1;
    clearCycle();
    void pages.show(reviewedThought(selectedTopic(), previewIndex, pack), selectedTopic(), 'Reviewed thought', reset).then(moved => {
      if (moved && generateAfter && canAnimate()) void generateText(false, true);
    });
  }
  function resumeWriting(forceMotion = false) {
    paused = false;
    pause?.setAttribute('aria-pressed', 'false');
    if (forceMotion) { animationEnabled = true; if (animate) animate.checked = true; }
    root.dataset.bookMotion = animationEnabled ? 'animate' : 'still';
    pages.resume();
    syncLabels();
  }

  function canAnimate() { return !disposed && !paused && intersecting && !document.hidden && !root.closest('[hidden]'); }
  function fitInscription() {
    if (root.closest('[hidden]') || root.dataset.bookTurning === 'true') return;
    if (volume) volume.style.minHeight = '';
    let available = writingArea.clientHeight;
    if (!available) return;
    const shown = ink.data;
    output!.style.fontSize = ''; output!.style.minHeight = '';
    ink.data = inscription;
    const base = Number.parseFloat(getComputedStyle(output!).fontSize);
    for (let size = base; size >= 17; size -= .5) {
      output!.style.fontSize = `${size}px`;
      if (output!.scrollHeight <= available) break;
    }
    // A long thought on a narrow phone gets taller pages instead of smaller ink.
    if (volume && output!.scrollHeight > available) {
      const needed = volume.getBoundingClientRect().height * (output!.scrollHeight + 4) / available;
      volume.style.minHeight = `${Math.ceil(needed)}px`;
      available = writingArea.clientHeight;
    }
    // Reserve the full inscription height so the quill does not jump as lines unfold.
    output!.style.minHeight = `${Math.min(available, output!.getBoundingClientRect().height)}px`;
    ink.data = shown;
  }
  function positionQuill() {
    if (disposed || !root.isConnected || root.closest('[hidden]')) return;
    let tip = cursor.getBoundingClientRect();
    if (ink.length && typeof document.createRange === 'function') {
      const range = document.createRange();
      range.setStart(ink, Math.max(0, ink.length - 1));
      range.setEnd(ink, ink.length);
      const rects = range.getClientRects();
      if (rects.length) tip = rects[rects.length - 1];
    }
    const parent = (quill!.offsetParent as HTMLElement | null) ?? root;
    const box = parent.getBoundingClientRect();
    quill!.style.setProperty('--book-quill-x', `${(ink.length ? tip.right : tip.left) - box.left + parent.scrollLeft}px`);
    quill!.style.setProperty('--book-quill-y', `${tip.top - box.top + tip.height * .8 + parent.scrollTop}px`);
  }
  function setWriting(value: boolean) { root.dataset.bookWriting = String(value); }
  function stopFrame() { if (raf) cancelAnimationFrame(raf); raf = 0; lastFrame = 0; setWriting(false); }
  function finishInk() {
    ink.data = inscription;
    index = characters.length; writing = false; stopFrame(); positionQuill();
    if (!busy && !paused && statusSource === 'Writing in ink…') setStatus('Ready to write');
    scheduleCycle();
  }
  function frame(now: number) {
    raf = 0;
    if (!writing || !canAnimate()) { stopFrame(); return; }
    if (!animationEnabled) { finishInk(); return; }
    elapsed += lastFrame ? Math.min(80, now - lastFrame) : 0;
    lastFrame = now;
    const previous = characters[Math.max(0, index - 1)];
    const letterDelay = options.letterDelayMs ?? 45;
    const delay = /[.!?,;:]/.test(previous) ? letterDelay * 4 : previous === ' ' ? letterDelay * 1.4 : letterDelay;
    if (elapsed >= delay) {
      ink.data += characters[index++]; elapsed = 0; positionQuill();
    }
    if (index >= characters.length) { finishInk(); return; }
    setWriting(true); raf = requestAnimationFrame(frame);
  }
  function syncAnimation() {
    if (root.dataset.bookTurning === 'true') { clearCycle(); stopFrame(); pages.syncArt(false); return; }
    pages.syncArt(canAnimate());
    if (!canAnimate()) { clearCycle(); stopFrame(); return; }
    fitInscription(); positionQuill();
    if (!busy && statusSource === 'Turning the page…') setStatus(writing ? 'Writing in ink…' : 'Ready to write');
    if (!writing) { stopFrame(); scheduleCycle(); return; }
    if (!animationEnabled) { finishInk(); return; }
    setWriting(true);
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function write(text: string) {
    clearCycle(); stopFrame(); inscription = text; characters = Array.from(text); index = 0; elapsed = 0;
    ink.data = ''; writing = characters.length > 0;
    if (accessible) accessible.textContent = text;
    if (!busy) setStatus('Writing in ink…');
    fitInscription();
    if (paused || !animationEnabled) { finishInk(); return; }
    syncAnimation();
  }
  function setBusy(value: boolean) {
    busy = value; root.dataset.bookBusy = String(value);
    generate!.disabled = false;
    if (replay) replay.disabled = value;
    if (topic) topic.disabled = value;
    if (download) download.disabled = value;
    if (cancel) cancel.hidden = !value && consent?.hidden !== false;
    syncLabels();
  }
  function selectedTopic(): BookTopic { return BOOK_TOPICS.includes(topic?.value as BookTopic) ? topic!.value as BookTopic : 'ai'; }
  function stopRequest(message = 'Writing cancelled. The current page is kept.') {
    ++run; controller?.abort(); controller = undefined;
    if (busy) { setBusy(false); setStatus(message); }
  }
  async function generateText(downloadAgreed = false, inPlace = false) {
    if (busy || disposed || root.closest('[hidden]')) return;
    const revision = ++run;
    const request = new AbortController(); controller = request;
    pages.cancel();
    resumeWriting(); setBusy(true); clearCycle();
    setModelNote();
    setStatus('Thinking…');
    if (!writing) write(inscription);
    syncAnimation();
    try {
      if (!model) {
        if (downloadAgreed && candidate) {
          const loadedModel = await candidate.load((loaded, total) => {
            if (disposed || revision !== run || !total) return;
            setStatus('Loading local AI…', Math.min(100, Math.round(loaded / total * 100)));
          }, request.signal);
          if (disposed || revision !== run) { loadedModel.dispose(); return; }
          model = loadedModel; candidate = undefined;
        } else {
          const choice = await (options.prepareModel ?? prepareBookModel)(request.signal, 'device');
          if (disposed || revision !== run) { if (choice.kind === 'ready') choice.model.dispose(); else if (choice.kind === 'download') choice.dispose(); return; }
          if (choice.kind === 'download') {
            candidate?.dispose(); candidate = choice;
            if (consent) consent.hidden = false;
            setModelNote('A local model is available for this device. Choose Download & write to continue.');
            return;
          }
          if (choice.kind === 'unavailable') {
            setModelNote('This model is unavailable here. Showing a reviewed thought.');
            if (inPlace) pages.replace(reviewedThought(selectedTopic(), ++previewIndex, pack), 'Reviewed thought'); else nextPreview();
            return;
          }
          model = choice.model;
        }
      }
      if (disposed || revision !== run) return;
      if (consent) consent.hidden = true;
      setStatus('Thinking…');
      const subject = reviewedThought(selectedTopic(), variation, pack);
      const question = bookPrompt(selectedTopic(), variation++, subject.fact?.topic);
      const evidence = selectedTopic() === 'profile' ? await bookEvidence(question, request.signal, subject.fact?.topic) : { chunks: [], byId: new Map() };
      const { generateBookAnswer } = await import('./cited-answer.ts');
      if (disposed || revision !== run) return;
      const result = await generateBookAnswer({
        generator: model.generator, question,
        prev: [], ...evidence, locale: 'en', stop: request.signal, firstMs: 90_000, doneMs: 90_000,
      });
      if (disposed || revision !== run) return;
      const text = result.kind === 'answer' && !result.stopped && !result.cutShort ? cleanBookSentence(result.blocks.join(' ')) : undefined;
      if (!text) {
        setModelNote('The model could not finish this thought. Showing a reviewed thought.');
        if (inPlace) pages.replace(reviewedThought(selectedTopic(), ++previewIndex, pack), 'Reviewed thought'); else nextPreview();
        return;
      }
      const cited = result.kind === 'answer' ? result.cites.flatMap(id => { const chunk = evidence.byId.get(id); return chunk ? [{ title: chunk.title, url: chunk.url }] : []; }) : [];
      const thought: BookThought = { text, sources: cited, reviewed: false };
      if (inPlace) pages.replace(thought, 'Written by local AI'); else void pages.show(thought, selectedTopic(), 'Written by local AI');
    } catch {
      if (!disposed && revision === run) { setModelNote('The model could not finish this thought. Showing a reviewed thought.'); if (inPlace) pages.replace(reviewedThought(selectedTopic(), ++previewIndex, pack), 'Reviewed thought'); else nextPreview(); }
    } finally {
      if (!disposed && revision === run) { controller = undefined; setBusy(false); if (writing) setStatus('Writing in ink…'); else setStatus('Ready to write'); syncAnimation(); }
    }
  }
  on(generate, 'click', () => { if (busy) { stopRequest(); syncAnimation(); } else void generateText(); });
  if (download) on(download, 'click', () => { void generateText(true); });
  if (cancel) on(cancel, 'click', () => { stopRequest(); candidate?.dispose(); candidate = undefined; if (consent) consent.hidden = true; syncAnimation(); });
  if (replay) on(replay, 'click', () => { pages.cancel(); resumeWriting(true); pages.replayArt(); write(inscription); });
  if (topic) on(topic, 'change', () => { stopRequest(); candidate?.dispose(); candidate = undefined; if (consent) consent.hidden = true; setModelNote(); resumeWriting(); nextPreview(true); });
  if (animate) on(animate, 'change', () => {
    animationEnabled = animate.checked;
    root.dataset.bookMotion = animationEnabled ? 'animate' : 'still';
    clearCycle();
    if (animationEnabled) { resumeWriting(); write(inscription); }
    else { pages.cancel(); pages.syncArt(false); finishInk(); }
  });
  if (pause) on(pause, 'click', () => {
    paused = !paused; pause.setAttribute('aria-pressed', String(paused));
    if (paused) pages.pause(); else pages.resume();
    syncLabels();
    if (!paused && !writing && root.dataset.bookTurning !== 'true') write(inscription);
    syncAnimation();
    if (paused) setStatus('Writing paused');
    else if (writing && !busy) setStatus('Writing in ink…');
  });
  const navigate = (back = false) => { if (busy || root.dataset.bookTurning === 'true') return; resumeWriting(); clearCycle(); if (back) pages.previous(); else if (!pages.next()) nextPreview(false, true); };
  const stage = node('.ai-book__stage');
  const previous = node('[data-book-previous]'), next = node('[data-book-next]');
  if (previous) on(previous, 'click', () => navigate(true));
  if (next) on(next, 'click', () => navigate());
  if (stage) {
    on(stage, 'keydown', event => { const e = event as KeyboardEvent; if (e.target !== stage || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); navigate(e.key === 'ArrowLeft'); });
  }
  const interaction = volume ? mountBookInteraction(volume, {
    allowed: () => !disposed && !busy && root.dataset.bookTurning !== 'true',
    start() { resumeWriting(); clearCycle(); stopFrame(); },
    begin(back) { return pages.gesture(back, reviewedThought(selectedTopic(), previewIndex + 1, pack), selectedTopic(), 'Reviewed thought'); },
    navigate,
    settled(result) { syncAnimation(); if (result.moved && result.newPage) { previewIndex++; if (canAnimate()) void generateText(false, true); } },
    cancel() { pages.cancel(); syncAnimation(); },
  }) : undefined;
  on(root, 'ai-widget-hide', () => { stopRequest(); interaction?.cancel(); pages.cancel(); clearCycle(); stopFrame(); });
  on(root, 'ai-widget-show', () => { if (!busy && !paused) setStatus(writing ? 'Writing in ink…' : 'Ready to write'); if (!paused && !writing) write(inscription); else syncAnimation(); });
  on(document, 'visibilitychange', () => { if (document.hidden) { stopRequest(); interaction?.cancel(); pages.cancel(); } syncAnimation(); });
  on(document, LANGUAGE_EVENT, () => { syncLabels(); pages.refreshLabels(); });
  const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .15);
    syncAnimation();
  }, { threshold: .15 }) : undefined;
  intersection?.observe(writingArea);
  const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { fitInscription(); positionQuill(); }) : undefined;
  resize?.observe(writingArea);
  // Switching tabs toggles an ancestor panel; this also resumes a half-written line.
  const visibility = new MutationObserver(() => syncAnimation());
  for (let ancestor: HTMLElement | null = root; ancestor; ancestor = ancestor.parentElement) visibility.observe(ancestor, { attributes: true, attributeFilter: ['hidden'] });
  void document.fonts?.ready.then(() => { if (!disposed) { fitInscription(); positionQuill(); } });
  origin.textContent = t(originSource);
  setSources(initial.sources);
  root.dataset.bookGenerated = 'false';
  root.dataset.bookMotion = animationEnabled ? 'animate' : 'still';
  setBusy(false); write(sample);
  return {
    unmount() {
      if (disposed) return;
      disposed = true; stopRequest(); interaction?.unmount(); pages.unmount(); clearCycle(); stopFrame(); events.abort();
      intersection?.disconnect(); resize?.disconnect(); visibility.disconnect();
      candidate?.dispose(); model?.dispose(); candidate = undefined; model = undefined;
    },
  };
}
