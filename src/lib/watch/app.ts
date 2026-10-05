import { mountDial } from './dial.ts';
import { MODES, makeSourceLink, retrieveFacts, validateFactPack, validateSentence, wellbeingNeedsHelp, type FactPack, type WatchFact } from './facts.ts';
import { mountPlane } from './plane-view.ts';
import { WatchLanguageClient } from './language/runtime.ts';
import type { WatchSettings, LanguageMode } from './types.ts';
import { renderPhrase } from './phrase.ts';

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
  if (options.diameter !== undefined) root.style.setProperty('--watch-diameter', `${Math.min(480, Math.max(320, options.diameter))}px`);
  const phrase = node<SVGTextElement>('[data-watch-phrase]');
  const caption = node<HTMLElement>('[data-watch-caption]');
  const status = node<HTMLElement>('[data-watch-status]');
  const sources = node<HTMLElement>('[data-watch-sources]');
  const answer = node<HTMLElement>('[data-watch-answer]');
  const abort = new AbortController();
  const on = (target: EventTarget, name: string, fn: EventListener) => target.addEventListener(name, fn, { signal: abort.signal });
  const language = new WatchLanguageClient();
  const configuration = { ...options };
  let pack: FactPack | undefined, initialized = false, disposed = false, active = !compact, visible = true, attempts = 0;
  let mode: LanguageMode = MODES.includes(options.languageMode!) ? options.languageMode! : root.dataset.watchModeValue as LanguageMode || 'ai';
  let interval = Math.min(60000, Math.max(15000, options.phraseIntervalMs ?? (Number(root.dataset.watchIntervalValue) || 20000)));
  let paused = false, offset = 0, sequence = 0, due = Date.now() + interval;
  let plane: ReturnType<typeof mountPlane> | undefined;
  let currentFacts: WatchFact[] = [];
  let lastValidated = '', lastDialSentence = '', modelNote = 'The trained local model is being evaluated; reviewed sentences are available now.';

  function display(text: string, facts: WatchFact[], generated = false) {
    if (!validateSentence(text, facts)) return;
    try { renderPhrase(phrase, text); } catch { return; }
    lastValidated = text; lastDialSentence = text; currentFacts = facts;
    caption.textContent = text;
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
    const facts = retrieveFacts(pack, mode, question, offset++);
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
    plane ??= mountPlane(root);
    plane.setPlane(configuration.showPlane ?? true); plane.setClouds(configuration.showClouds ?? true);
    plane.learn(configuration.enableOnlineLearning ?? false);
    try {
      let response: Response;
      try {
        response = await fetch('/watch/facts.v1.json', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
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
        try { renderPhrase(phrase, unavailable); lastDialSentence = unavailable; } catch { phrase.textContent = ''; lastDialSentence = ''; }
        caption.textContent = unavailable;
      }
      else modelNote = 'Local generation is unavailable; the reviewed source sentence remains usable.';
    }
  }
  const dial = mountDial(root, {
    timeZone: options.timeZone ?? root.dataset.watchZoneValue ?? '', motion: options.motion ?? 'sweep',
    onFrame: (clock, elapsed) => { if (active && visible) plane?.frame(clock, elapsed); },
    onResume: () => { plane?.pause(paused || !active || !visible); },
  });
  function syncActivity() {
    language.cancel(); ++sequence;
    plane?.pause(paused || !active || !visible || document.hidden);
    if (visible && !document.hidden) dial.resume(); else dial.suspend();
    if (active && visible && !document.hidden) void initialize();
    due = Date.now() + interval;
  }
  function setMode(value: LanguageMode) {
    if (!MODES.includes(value)) return;
    mode = value; offset = 0; language.cancel(); ++sequence; answer.textContent = '';
    root.querySelectorAll<HTMLElement>('[data-watch-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.watchMode === mode)));
    void next();
  }
  function pause(value: boolean) {
    paused = value; node('[data-watch-pause]').setAttribute('aria-pressed', String(value));
    node('[data-watch-pause-label]').textContent = value ? 'Resume' : 'Pause';
    language.cancel(); ++sequence; plane?.pause(value); due = Date.now() + interval;
  }
  function open() {
    if (disposed) return;
    if (compact && panel instanceof HTMLDialogElement && !panel.open) panel.showModal();
    active = true; syncActivity();
  }
  on(root, 'click', event => {
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
  on(root, 'change', event => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.matches('[data-watch-zone]')) dial.setTimeZone(target.value);
    if (target.matches('[data-watch-motion]')) dial.setMotion(target.value === 'tick' ? 'tick' : 'sweep');
    if (target.matches('[data-watch-interval]')) {
      interval = Math.min(60000, Math.max(15000, Number(target.value) * 1000));
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
  const timer = setInterval(() => { if (!paused && active && visible && !document.hidden && Date.now() >= due) void next(); }, 500);
  if (active) void initialize();
  void document.fonts?.ready.then(() => { if (!disposed && lastDialSentence) { try { renderPhrase(phrase, lastDialSentence); } catch { /* Retain the previous complete thought. */ } } });
  return {
    open,
    setSettings(settings) {
      if (settings.compact !== undefined && settings.compact !== compact) throw new RangeError('Remount the compact component to change its presentation.');
      if (settings.inferenceBackend && settings.inferenceBackend !== 'wasm') throw new RangeError('This release supports the tested WASM backend.');
      if (settings.phraseIntervalMs !== undefined && !Number.isFinite(settings.phraseIntervalMs)) throw new RangeError('Thought interval must be finite.');
      Object.assign(configuration, settings);
      if (settings.languageMode) setMode(settings.languageMode);
      if (settings.timeZone !== undefined) dial.setTimeZone(settings.timeZone);
      if (settings.motion) dial.setMotion(settings.motion);
      if (settings.phraseIntervalMs !== undefined) interval = Math.min(60000, Math.max(15000, settings.phraseIntervalMs));
      if (settings.showPlane !== undefined) plane?.setPlane(settings.showPlane);
      if (settings.showClouds !== undefined) plane?.setClouds(settings.showClouds);
      if (settings.enableOnlineLearning !== undefined) plane?.learn(settings.enableOnlineLearning);
    },
    unmount() { if (disposed) return; disposed = true; ++sequence; abort.abort(); clearInterval(timer); observer.disconnect(); dial.dispose(); plane?.dispose(); void language.dispose(); if (panel instanceof HTMLDialogElement && panel.open) panel.close(); },
  };
}
