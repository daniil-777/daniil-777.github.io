import { mountDial } from './dial.ts';
import { MODES, KNOWLEDGE_DOMAINS, makeSourceLink, retrieveFacts, validateFactPack, validateSentence, wellbeingNeedsHelp, type FactPack, type WatchFact } from './facts.ts';
import { mountPlane } from './plane-view.ts';
import { WatchLanguageClient } from './language/runtime.ts';
import { WATCH_THOUGHT_STYLES, type WatchSettings, type LanguageMode, type WatchThoughtStyle, type WatchKnowledgeDomain, type WatchMotion } from './types.ts';
import { renderPhrase } from './phrase.ts';
import { mountMarquee } from './marquee.ts';

export interface SmartWatchHandle {
  setSettings(settings: Partial<WatchSettings>): void;
  open(): void;
  unmount(): void;
}
export type SmartWatchOptions = Partial<WatchSettings> & { diameter?: number };

/** Mount into the original Chronos markup, or use the isolated embed demo. */
export function mountSmartWatch(root: HTMLElement, options: SmartWatchOptions = {}): SmartWatchHandle {
  const node = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
  const panel = node<HTMLElement>('[data-watch-panel]');
  const compact = root.dataset.compact === 'true';
  if (options.compact !== undefined && options.compact !== compact) throw new RangeError('Compact mode is defined by the component markup.');
  if (options.inferenceBackend && options.inferenceBackend !== 'wasm') throw new RangeError('This release supports the tested WASM backend.');
  if (options.diameter !== undefined && !Number.isFinite(options.diameter)) throw new RangeError('Watch diameter must be finite.');
  if (options.phraseIntervalMs !== undefined && !Number.isFinite(options.phraseIntervalMs)) throw new RangeError('Thought interval must be finite.');
  if (options.thoughtStyle !== undefined && !WATCH_THOUGHT_STYLES.includes(options.thoughtStyle)) throw new RangeError('Thought style must be dial, arc, card, layered or marquee.');
  if (options.knowledgeDomain !== undefined && !KNOWLEDGE_DOMAINS.includes(options.knowledgeDomain)) throw new RangeError('Unknown knowledge field.');
  if (options.diameter !== undefined) root.style.setProperty('--watch-diameter', `${Math.min(480, Math.max(320, options.diameter))}px`);
  const phrase = node<SVGTextElement>('[data-watch-phrase]');
  const caption = node<HTMLElement>('[data-watch-caption]');
  const status = node<HTMLElement>('[data-watch-status]');
  const sources = node<HTMLElement>('[data-watch-sources]');
  const answer = node<HTMLElement>('[data-watch-answer]');
  const cardOutput = node<HTMLElement>('[data-watch-card-output]');
  const initialMotion: WatchMotion = options.motion ?? (root.dataset.watchMotionValue === 'sweep' ? 'sweep' : root.dataset.watchMotionValue === 'tick' ? 'tick' : 'system');
  const marquee = mountMarquee(cardOutput, fitCardOutput, initialMotion);
  const abort = new AbortController();
  const on = (target: EventTarget, name: string, fn: EventListener) => target.addEventListener(name, fn, { signal: abort.signal });
  const language = new WatchLanguageClient();
  const configuration = { ...options };
  let pack: FactPack | undefined, initialized = false, disposed = false, active = !compact, visible = true, attempts = 0;
  let mode: LanguageMode = MODES.includes(options.languageMode!) ? options.languageMode! : root.dataset.watchModeValue as LanguageMode || 'ai';
  const urlStyle = new URLSearchParams(window.location.search).get('watchStyle') as WatchThoughtStyle;
  const configuredStyle = root.dataset.watchThoughtStyleValue as WatchThoughtStyle;
  let thoughtStyle: WatchThoughtStyle = options.thoughtStyle ?? (WATCH_THOUGHT_STYLES.includes(urlStyle) ? urlStyle : WATCH_THOUGHT_STYLES.includes(configuredStyle) ? configuredStyle : 'dial');
  root.dataset.watchThoughtStyle = thoughtStyle;
  node<HTMLSelectElement>('[data-watch-thought-layout]').value = thoughtStyle;
  const requestedDomain = new URLSearchParams(window.location.search).get('watchField') as WatchKnowledgeDomain;
  const configuredDomain = root.dataset.watchDomainValue as WatchKnowledgeDomain;
  let knowledgeDomain: WatchKnowledgeDomain = options.knowledgeDomain ?? (KNOWLEDGE_DOMAINS.includes(requestedDomain) ? requestedDomain : KNOWLEDGE_DOMAINS.includes(configuredDomain) ? configuredDomain : 'all');
  root.dataset.watchDomain = knowledgeDomain;
  node<HTMLSelectElement>('[data-watch-domain]').value = knowledgeDomain;
  node<HTMLElement>('[data-watch-knowledge]').hidden = mode !== 'ai';
  let interval = Math.min(60000, Math.max(2000, options.phraseIntervalMs ?? (Number(root.dataset.watchIntervalValue) || 20000)));
  let paused = false, offset = 0, sequence = 0, due = Date.now() + interval;
  let plane: ReturnType<typeof mountPlane> | undefined;
  let currentFacts: WatchFact[] = [];
  let answerSize = 24;
  let lastValidated = '', lastDialSentence = '', modelNote = 'The trained local model is being evaluated; reviewed sentences are available now.';

  function fitCardOutput() {
    if (thoughtStyle === 'marquee') {
      const scale = node('[data-watch-dial]').getBoundingClientRect().width / 440;
      cardOutput.style.fontSize = `${Math.max(17, 30 * scale)}px`;
      marquee.setText(lastDialSentence, true);
      return;
    }
    if (thoughtStyle !== 'card' && thoughtStyle !== 'layered') return;
    const face = node<SVGSVGElement>('[data-watch-dial]').getBoundingClientRect();
    const scale = face.width / 440;
    if (!scale) return;
    let fittedSize = thoughtStyle === 'layered' ? answerSize : 26;
    for (let font = fittedSize; font >= 14; font -= .5) {
      cardOutput.style.fontSize = `${font * scale}px`;
      fittedSize = font;
      const box = cardOutput.getBoundingClientRect();
      const corners = [box.left, box.right].flatMap(x => [box.top, box.bottom].map(y =>
        Math.hypot((x - face.left) / scale - 220, (y - face.top) / scale - 220)));
      // The layered face reserves the outer numerals and six o'clock marker.
      const clearsNumerals = thoughtStyle === 'card' || (box.bottom - face.top) / scale <= 350;
      if (corners.every(radius => radius <= 194) && clearsNumerals) break;
    }
    if (thoughtStyle === 'layered') {
      const percentage = Math.round(fittedSize / 24 * 100);
      const limited = fittedSize < answerSize;
      node('[data-watch-answer-size-label]').textContent = `${percentage}%${limited ? ' · fitted' : ''}`;
      const hint = node<HTMLElement>('[data-watch-answer-size-hint]');
      hint.textContent = limited ? `${Math.round(answerSize / 24 * 100)}% requested; adjusted to keep the complete answer below the centre.` : '';
      hint.hidden = !limited;
      node<HTMLInputElement>('[data-watch-answer-size]').setAttribute('aria-valuetext', `${percentage} percent${limited ? ', fitted to keep every word visible' : ''}`);
    }
  }
  function mirrorCard(text: string, facts: WatchFact[], generated = false) {
    marquee.setText(text, thoughtStyle === 'marquee');
    node('[data-watch-card-status]').textContent = generated ? 'Local model' : facts.length ? 'Reviewed' : 'Unavailable';
    node('[data-watch-card-source]').textContent = facts[0]?.sourceTitle ?? 'Use Next thought to retry';
    fitCardOutput();
  }

  function display(text: string, facts: WatchFact[], generated = false) {
    if (!validateSentence(text, facts)) return;
    try { renderPhrase(phrase, text, thoughtStyle); } catch { return; }
    lastValidated = text; lastDialSentence = text; currentFacts = facts;
    caption.textContent = text;
    mirrorCard(text, facts, generated);
    status.textContent = generated ? 'Local model · source validated' : 'Reviewed thought · English';
    sources.replaceChildren();
    const kind = document.createElement('p');
    kind.textContent = generated ? 'Generated on this device, then checked against reviewed answers.' : 'This is a reviewed sentence selected from cited facts.';
    sources.append(kind);
    for (const fact of facts) {
      const line = document.createElement('p');
      line.append(makeSourceLink(fact), document.createTextNode(` · reviewed ${fact.reviewedAt}`));
      sources.append(line);
    }
    const note = document.createElement('p'); note.textContent = modelNote;
    const card = document.createElement('a'); card.href = '/watch/language/model-card.json'; card.textContent = 'Model card & measured evaluation';
    sources.append(note, card);
    if (mode === 'wellbeing') {
      const wellbeing = document.createElement('p'); wellbeing.textContent = 'General wellbeing information from WHO; questions stay within the reviewed source topics.'; sources.append(wellbeing);
    }
  }
  async function next(question = '') {
    if (!pack) { if (!initialized) void initialize(true); return; }
    if (disposed || !active || !visible || document.hidden) return;
    const request = ++sequence; language.cancel();
    const facts = retrieveFacts(pack, mode, question, offset++, knowledgeDomain);
    due = Date.now() + interval;
    if (!facts.length) {
      answer.textContent = mode === 'wellbeing' && wellbeingNeedsHelp(question)
        ? 'This watch cannot assess symptoms or treatment. Contact a qualified clinician; if you are in immediate danger, contact local emergency services.'
        : 'That question is outside the reviewed facts for this mode. Try a listed source topic.';
      return;
    }
    if (question) answer.textContent = 'Looking within the reviewed sources…';
    // The reviewed fallback is visible immediately; model output can replace it only after validation.
    display(facts[0].answer, facts);
    if (question) answer.textContent = `From the reviewed source: ${facts[0].answer}`;
    if (language.status !== 'ready') return;
    try {
      const result = await language.generate({ requestId: `watch-${request}`, mode, question: question || undefined,
        factIds: facts.map(fact => fact.id), facts: facts.map(({ id, text }) => ({ id, text })), maxNewTokens: 64 });
      if (disposed || request !== sequence || !active || !visible) return;
      if (result.finishReason === 'eos' && validateSentence(result.text.trim(), facts)) {
        display(result.text.trim(), facts, true);
        if (question) answer.textContent = result.text.trim();
      } else {
        status.textContent = 'Reviewed thought · model output held back';
      }
    } catch { if (!disposed && request === sequence) status.textContent = 'Reviewed thought · local model unavailable'; }
  }
  async function initialize(manualRetry = false) {
    if (initialized || disposed || attempts >= 2 || (attempts > 0 && !manualRetry)) return;
    initialized = true; attempts++;
    // Public markup disables the entire flight experiment, including its downloads and worker.
    if (root.dataset.watchAircraft === 'true') {
      plane ??= mountPlane(root);
      plane.setPlane(configuration.showPlane ?? true); plane.setClouds(configuration.showClouds ?? true);
      plane.learn(configuration.enableOnlineLearning ?? false);
    }
    try {
      let response: Response;
      try {
        response = await fetch('/watch/facts.v1.json', { cache: 'no-cache', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error('Fact pack unavailable');
      } catch (error) {
        const cached = typeof caches !== 'undefined' ? await (await caches.open('chronos-public-facts-v1')).match('/watch/facts.v1.json') : undefined;
        if (!cached || abort.signal.aborted) throw error;
        response = cached;
      }
      const value = await response.clone().json();
      pack = validateFactPack(value);
      // This bounded cache contains public source facts only, never visitor questions.
      if (typeof caches !== 'undefined' && !abort.signal.aborted) {
        await caches.open('chronos-public-facts-v1').then(cache => cache.put('/watch/facts.v1.json', new Response(JSON.stringify(pack), { headers: { 'content-type': 'application/json' } }))).catch(() => {});
      }
      if (disposed) return;
      void next();
      const loaded = await language.init();
      if (disposed) return;
      modelNote = loaded.status === 'ready' ? 'A released transformer generates locally in browser WASM. No question is sent to a server.' : loaded.detail ?? 'The local model has not passed its release gates. Reviewed source sentences remain available.';
      display(lastValidated, currentFacts);
    } catch {
      if (disposed) return;
      if (!pack) {
        initialized = false; status.textContent = attempts < 2 ? 'Reviewed facts unavailable · use Next thought to retry' : 'Reviewed facts unavailable · reload to try again';
        const unavailable = 'Reviewed facts are unavailable offline until they have been downloaded at least once.';
        try { renderPhrase(phrase, unavailable, thoughtStyle); lastDialSentence = unavailable; } catch { phrase.textContent = ''; lastDialSentence = ''; }
        caption.textContent = unavailable;
        mirrorCard(unavailable, []);
      }
      else modelNote = 'Local generation is unavailable; the reviewed source sentence remains usable.';
    }
  }
  const dial = mountDial(root, {
    timeZone: options.timeZone ?? root.dataset.watchZoneValue ?? '',
    motion: initialMotion,
    onFrame: (clock, elapsed) => { if (active && visible) plane?.frame(clock, elapsed); },
    onResume: () => { plane?.pause(paused || !active || !visible); },
  });
  function setMotion(value: WatchMotion) { dial.setMotion(value); marquee.setMotion(value); }
  function syncActivity() {
    language.cancel(); ++sequence;
    plane?.pause(paused || !active || !visible || document.hidden);
    marquee.pause(paused || !active || !visible || document.hidden);
    if (visible && !document.hidden) dial.resume(); else dial.suspend();
    if (active && visible && !document.hidden) void initialize();
    due = Date.now() + interval;
  }
  function setMode(value: LanguageMode) {
    if (!MODES.includes(value)) return;
    mode = value; offset = 0; language.cancel(); ++sequence; answer.textContent = '';
    node<HTMLElement>('[data-watch-knowledge]').hidden = mode !== 'ai';
    root.querySelectorAll<HTMLElement>('[data-watch-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.watchMode === mode)));
    void next();
  }
  function setThoughtStyle(value: WatchThoughtStyle) {
    if (lastDialSentence) {
      try { renderPhrase(phrase, lastDialSentence, value); } catch {
        node<HTMLSelectElement>('[data-watch-thought-layout]').value = thoughtStyle; return;
      }
    }
    thoughtStyle = value;
    root.dataset.watchThoughtStyle = value;
    node<HTMLSelectElement>('[data-watch-thought-layout]').value = value;
    marquee.setText(lastDialSentence, value === 'marquee');
    marquee.pause(paused || !active || !visible || document.hidden);
    fitCardOutput();
  }
  function setKnowledgeDomain(value: WatchKnowledgeDomain) {
    knowledgeDomain = value; offset = 0; language.cancel(); ++sequence; answer.textContent = '';
    root.dataset.watchDomain = value;
    node<HTMLSelectElement>('[data-watch-domain]').value = value;
    if (mode === 'ai') void next();
  }
  function pause(value: boolean) {
    paused = value; node('[data-watch-pause]').setAttribute('aria-pressed', String(value));
    node('[data-watch-pause-label]').textContent = value ? 'Resume' : 'Pause';
    language.cancel(); ++sequence; plane?.pause(value); marquee.pause(value || !active || !visible || document.hidden); due = Date.now() + interval;
  }
  function open() {
    if (disposed) return;
    if (compact && panel instanceof HTMLDialogElement && !panel.open) panel.showModal();
    active = true; syncActivity();
  }
  on(root, 'click', event => {
    if (thoughtStyle === 'marquee' && (event.target as Element).closest('[data-watch-card-output]')) pause(!paused);
    const target = (event.target as Element).closest<HTMLElement>('button');
    if (!target) return;
    if (target.hasAttribute('data-watch-open')) open();
    if (target.hasAttribute('data-watch-close') && panel instanceof HTMLDialogElement) panel.close();
    if (target.hasAttribute('data-watch-mode')) setMode(target.dataset.watchMode as LanguageMode);
    if (target.hasAttribute('data-watch-next')) void next();
    if (target.hasAttribute('data-watch-pause')) pause(!paused);
    if (target.hasAttribute('data-watch-reset-learn')) plane?.resetLearning();
  });
  if (panel instanceof HTMLDialogElement) {
    on(panel, 'close', () => { active = false; syncActivity(); });
    on(panel, 'keydown', event => { const key = event as KeyboardEvent; if (key.key === 'Escape') { key.preventDefault(); panel.close(); } });
  }
  on(root, 'input', event => {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-watch-answer-size]')) {
      const requested = Number(target.value);
      if (Number.isFinite(requested)) answerSize = Math.min(28, Math.max(16, requested));
      fitCardOutput();
    }
  });
  on(root, 'change', event => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.matches('[data-watch-zone]')) dial.setTimeZone(target.value);
    if (target.matches('[data-watch-motion]')) setMotion(target.value === 'tick' ? 'tick' : target.value === 'sweep' ? 'sweep' : 'system');
    if (target.matches('[data-watch-thought-layout]') && WATCH_THOUGHT_STYLES.includes(target.value as WatchThoughtStyle)) setThoughtStyle(target.value as WatchThoughtStyle);
    if (target.matches('[data-watch-domain]') && KNOWLEDGE_DOMAINS.includes(target.value as WatchKnowledgeDomain)) setKnowledgeDomain(target.value as WatchKnowledgeDomain);
    if (target.matches('[data-watch-interval]')) {
      interval = Math.min(60000, Math.max(2000, Number(target.value) * 1000));
      node('[data-watch-interval-label]').textContent = `${interval / 1000} seconds`; due = Date.now() + interval;
    }
    if (target instanceof HTMLInputElement) {
      if (target.matches('[data-watch-plane-toggle]')) plane?.setPlane(target.checked);
      if (target.matches('[data-watch-clouds-toggle]')) plane?.setClouds(target.checked);
      if (target.matches('[data-watch-learn]')) plane?.learn(target.checked);
    }
  });
  on(node('[data-watch-question]'), 'submit', event => { event.preventDefault(); const input = node<HTMLInputElement>('[data-watch-input]'); void next(input.value.trim()); });
  on(document, 'visibilitychange', syncActivity);
  const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); syncActivity(); });
  observer.observe(root);
  const sizeObserver = new ResizeObserver(fitCardOutput);
  sizeObserver.observe(node('[data-watch-dial]'));
  const timer = setInterval(() => { if (!paused && active && visible && !document.hidden && Date.now() >= due && marquee.readyForNext) void next(); }, 100);
  if (active) void initialize();
  void document.fonts?.ready.then(() => { if (!disposed && lastDialSentence) { try { renderPhrase(phrase, lastDialSentence, thoughtStyle); fitCardOutput(); } catch { /* Retain the previous complete thought. */ } } });
  return {
    open,
    setSettings(settings) {
      if (settings.compact !== undefined && settings.compact !== compact) throw new RangeError('Remount the compact component to change its presentation.');
      if (settings.inferenceBackend && settings.inferenceBackend !== 'wasm') throw new RangeError('This release supports the tested WASM backend.');
      if (settings.phraseIntervalMs !== undefined && !Number.isFinite(settings.phraseIntervalMs)) throw new RangeError('Thought interval must be finite.');
      if (settings.thoughtStyle !== undefined && !WATCH_THOUGHT_STYLES.includes(settings.thoughtStyle)) throw new RangeError('Thought style must be dial, arc, card, layered or marquee.');
      if (settings.knowledgeDomain !== undefined && !KNOWLEDGE_DOMAINS.includes(settings.knowledgeDomain)) throw new RangeError('Unknown knowledge field.');
      Object.assign(configuration, settings);
      if (settings.languageMode) setMode(settings.languageMode);
      if (settings.timeZone !== undefined) dial.setTimeZone(settings.timeZone);
      if (settings.motion) setMotion(settings.motion);
      if (settings.thoughtStyle !== undefined) setThoughtStyle(settings.thoughtStyle);
      if (settings.knowledgeDomain !== undefined) setKnowledgeDomain(settings.knowledgeDomain);
      if (settings.phraseIntervalMs !== undefined) { interval = Math.min(60000, Math.max(2000, settings.phraseIntervalMs)); due = Date.now() + interval; }
      if (settings.showPlane !== undefined) plane?.setPlane(settings.showPlane);
      if (settings.showClouds !== undefined) plane?.setClouds(settings.showClouds);
      if (settings.enableOnlineLearning !== undefined) plane?.learn(settings.enableOnlineLearning);
    },
    unmount() { if (disposed) return; disposed = true; ++sequence; abort.abort(); clearInterval(timer); observer.disconnect(); sizeObserver.disconnect(); marquee.dispose(); dial.dispose(); plane?.dispose(); void language.dispose(); if (panel instanceof HTMLDialogElement && panel.open) panel.close(); },
  };
}
