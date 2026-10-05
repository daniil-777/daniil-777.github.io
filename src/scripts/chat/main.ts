/**
 * The "Ask AI" assistant: loaded by the opener in Base.astro on the first
 * click, never before. Loads the knowledge base, answers each question from
 * the site's own sentences, and, where a model is offered, lets it write the
 * answer and falls back to the quotes whenever that cannot be trusted.
 */
import styles from '../../styles/chat.css?inline';
import { COPY, DEVICE_MODE, INPUT_MAX, LOCAL_LLM, SUGGESTED } from '../../data/chat.ts';
import { composeExtractive, type Answer } from '../../lib/chat/answer.ts';
import { buildIndex } from '../../lib/chat/bm25.ts';
import { EMBED } from '../../lib/chat/embed.ts';
import type { Chunk, Kb } from '../../lib/chat/kb.ts';
import { offerModes, type Capabilities } from '../../lib/chat/modes.ts';
import { denseScores, matchTrigger, ranking, subjectTerms } from '../../lib/chat/retrieve.ts';
import { conversationalFallback, requestsResources, safeResource, selectResources } from '../../lib/chat/resources.ts';
import { displayTitle } from '../../lib/chat/text.ts';
import type { Generator } from '../../lib/chat/types.ts';
import { closeOnBackdrop } from '../player.ts';
import { createCloud } from './cloud.ts';
import { conversationHistory, earlier, generateAnswer, searchInContext, type FallbackReason } from './pipeline.ts';
import type { Progress, Semantic } from './semantic.ts';
import { restoreTurns, type Turn } from './transcript.ts';
import { createView, type AnswerRecord, type Mode, type Source } from './view.ts';
import { currentLocale, englishSource, LANGUAGE_EVENT, loadFullCatalog, prose, refreshTranslations, t } from '../../i18n/client';

// As text, not as a stylesheet of the page: Astro would add that to every page, opened or not.
document.head.append(Object.assign(document.createElement('style'), { textContent: styles }));

const ENDPOINT = (import.meta.env.PUBLIC_CHAT_ENDPOINT ?? '').trim();
/** How many turns survive a page change (sessionStorage). */
const TURNS_MAX = 10;
const FOLLOW_UP_MAX = 80;

/** Storage can be blocked (private mode, a strict policy): every choice then lasts for this page only. */
function read(area: 'local' | 'session', key: string): string | null {
  try {
    return window[`${area}Storage`].getItem(key);
  } catch {
    return null;
  }
}

function write(area: 'local' | 'session', key: string, value: string) {
  try {
    window[`${area}Storage`].setItem(key, value);
  } catch {
    /* not saved */
  }
}

function capabilities(): Capabilities {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean }; connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
  return {
    deviceMode: DEVICE_MODE,
    hasEndpoint: ENDPOINT !== '',
    builtinAvailable: false,
    gpuAdapter: false,
    shaderF16: false,
    userAgent: nav.userAgent,
    platform: nav.platform,
    uaMobile: nav.userAgentData?.mobile,
    maxTouchPoints: nav.maxTouchPoints,
    pointerFine: window.matchMedia('(pointer: fine)').matches,
    saveData: nav.connection?.saveData,
    effectiveType: nav.connection?.effectiveType,
    deviceMemory: nav.deviceMemory,
    modelBytes: LOCAL_LLM.bytes,
  };
}

const NOTICE: Record<FallbackReason, string> = {
  failed: COPY.notice.cloudFailed,
  busy: COPY.notice.cloudBusy,
  budget: COPY.notice.cloudBusy,
  unverified: COPY.notice.unverified,
  device: COPY.notice.deviceFailed,
};

async function start(dialog: HTMLDialogElement) {
  await loadFullCatalog().catch(() => {});
  // Before the content arrives, so that a slow connection can still be dismissed.
  closeOnBackdrop(dialog, '[data-chat-close]');
  const signal = AbortSignal.timeout(10_000);
  const [response, resourceResponse] = await Promise.all([
    fetch('/chat/kb.json', { signal }),
    fetch('/chat/resources.json', { signal }).catch(() => undefined),
  ]);
  if (!response.ok) throw new Error(`kb.json: HTTP ${response.status}`);
  const kb = (await response.json()) as Kb;
  if (kb.v !== 1 || !Array.isArray(kb.chunks) || kb.chunks.length === 0) throw new Error('kb.json: not a knowledge base');
  const rawResources: unknown = await resourceResponse?.json().catch(() => undefined);
  const resources = Array.isArray(rawResources) ? rawResources.filter(safeResource) : [];

  let localKb = kb;
  let index = buildIndex(kb.chunks);
  function localizeKnowledge() {
    localKb = { ...kb, chunks: kb.chunks.map((chunk) => ({ ...chunk, title: t(chunk.title), heading: t(chunk.heading), text: chunk.text.split('\n').map(prose).join('\n'), asks: [...chunk.asks, ...chunk.asks.map((ask) => t(ask))], tags: [...chunk.tags, ...chunk.tags.map((tag) => t(tag))] })) };
    index = buildIndex(localKb.chunks.map((chunk, i) => ({ ...chunk, text: `${chunk.text}\n${kb.chunks[i].text}` })));
  }
  localizeKnowledge();
  document.addEventListener(LANGUAGE_EVENT, () => {
    // UI switches immediately; knowledge for other pages is fetched only if chat has been opened.
    void loadFullCatalog().then(() => { localizeKnowledge(); refreshTranslations(dialog); }).catch(() => {});
  });
  const byId = new Map(kb.chunks.map((chunk) => [chunk.id, chunk]));
  const subjects = subjectTerms(kb.chunks);
  const sourceOf = (chunk: Chunk): Source => ({ label: displayTitle(chunk), url: chunk.url });

  let offer = offerModes(capabilities());
  let turns: Turn[] = restoreTurns(read('session', 'chat:turns'), resources, TURNS_MAX);
  let trigger: HTMLElement | undefined;
  /** Set while an answer is being written; aborting it is "Stop". */
  let stopper: AbortController | undefined;
  /** True from a question being asked until its answer is drawn: one question at a time. */
  let asking = false;
  /** Counts the chats of this page view; an answer that arrives after "New chat" belongs to none. */
  let chatNo = 0;
  let semantic: Semantic | undefined;
  let device: { generator: Generator } | undefined;
  /** Modes that failed in a way that will not get better during this page view, and why. */
  const disabled: Partial<Record<Mode, string>> = {};
  const cloud = ENDPOINT ? createCloud(ENDPOINT) : undefined;

  const view = createView(dialog, kb.built, { ask, stop: () => stopper?.abort(), mode: setMode, reset, semantic: offerSemantic });
  dialog.addEventListener('close', () => {
    stopper?.abort();
    dialog.querySelectorAll('video').forEach((video) => video.pause());
    // The menu link that opened the chat is hidden again by now; the pill in the bar is not.
    const back = trigger?.offsetParent ? trigger : document.querySelector<HTMLElement>('.nav__ask');
    back?.focus({ preventScroll: true });
  });

  const offered = (): Mode[] => ['quotes' as const, ...(offer.cloud ? ['cloud' as const] : []), ...(offer.builtin || offer.webgpu ? ['device' as const] : [])];
  const usable = (candidate: string | null): candidate is Mode => offered().includes(candidate as Mode) && disabled[candidate as Mode] === undefined;
  // A new default opts upgraded visitors into conversation when it is connected.
  const saved = read('local', 'chat:mode:v2');
  // A model on the device is never switched on by itself: only a stored choice selects it.
  let mode: Mode = usable(saved) ? saved : usable('cloud') ? 'cloud' : 'quotes';

  const canSearchSmarter = () => offer.semantic && kb.embedding !== null && 'Worker' in window && !semantic;
  function draw() {
    view.modes(offered().map((option) => ({ mode: option, disabled: disabled[option] })), mode);
    view.semanticOffer(mode === 'quotes' && canSearchSmarter());
  }

  function setMode(next: Mode, remember = true) {
    mode = usable(next) ? next : 'quotes';
    if (remember) write('local', 'chat:mode:v2', mode);
    draw();
    if (mode === 'device' && !device) void prepareDevice();
  }

  function save() {
    turns = turns.slice(-TURNS_MAX);
    write('session', 'chat:turns', JSON.stringify(turns));
  }

  function reset() {
    chatNo += 1;
    stopper?.abort();
    turns = [];
    save();
    view.clear();
    view.status(COPY.status.fresh);
    view.focus();
  }

  /* --------------------------------------------------------- optional models */

  async function loadSemantic(progress: Progress, signal: AbortSignal) {
    try {
      semantic = await (await import('./semantic.ts')).loadSemantic(kb, progress, signal);
      write('local', 'chat:semantic', '1');
      view.hint('Smarter search is on.');
      view.status('Smarter search is on');
    } catch {
      if (!signal.aborted) view.hint(COPY.notice.semanticFailed);
    }
    draw();
  }

  function offerSemantic() {
    if (canSearchSmarter()) view.consent(COPY.semantic, loadSemantic);
  }

  function deviceFailed() {
    disabled.device = '';
    view.hint(COPY.notice.deviceFailed);
    setMode('quotes', false);
  }

  /** The browser's own model needs nothing; the downloadable one asks first, once. */
  async function prepareDevice() {
    const { createBuiltin, createWebgpu, removeModel } = await import('./device.ts');
    if (offer.builtin) {
      device = { generator: createBuiltin() };
      return;
    }
    if (!offer.webgpu) return;
    const model = createWebgpu(offer.webgpu, dialog);
    const load = (progress: Progress, signal: AbortSignal) =>
      model.load(progress, signal).then(
        () => {
          device = model;
          write('local', 'chat:device', '1');
          view.hint('', {
            label: COPY.device.remove,
            run: () => {
              model.dispose();
              device = undefined;
              write('local', 'chat:device', '');
              void removeModel().catch(() => {});
              setMode('quotes');
            },
          });
        },
        () => (signal.aborted ? setMode('quotes') : deviceFailed()),
      );
    if (read('local', 'chat:device')) void load(() => {}, new AbortController().signal);
    else view.consent(COPY.device, load, () => setMode('quotes'));
  }

  /* ----------------------------------------------------------- one question */

  /** The quotes answer in the form the view draws and the session keeps. */
  function toRecord(answer: Answer, asked: string[], meta: string): AnswerRecord {
    const quoted = answer.kind === 'quote' || answer.kind === 'closest';
    const sources = answer.passages.map(({ label, url }) => ({ label, url }));
    const otherLanguage = answer.lead === COPY.lead.englishOnly && usable('cloud') ? ` ${COPY.lead.englishOnlyCloud}` : '';
    // A roll-up is one line per entry; a first line ending in a colon ("Projects tagged 3D:") introduces the rest.
    const items = answer.kind === 'list' ? answer.passages[0].text.split('\n').filter(Boolean) : undefined;
    const heading = items?.[0].endsWith(':') ? items.shift() : undefined;
    return {
      mode: 'quotes',
      text: [],
      lead: heading ?? answer.lead + otherLanguage,
      items,
      passages: quoted ? answer.passages.map(({ text, label, url }) => ({ text, label, url })) : [],
      chips: quoted ? [] : sources,
      email: answer.kind === 'declined' || answer.kind === 'none' ? 'line' : answer.kind === 'closest' ? 'closest' : undefined,
      // A follow-up built from a long title (a patent's) is no longer something to press.
      followUps: answer.kind === 'none' ? SUGGESTED.filter((q) => !asked.includes(q)) : answer.followUps.filter((q) => q.length <= FOLLOW_UP_MAX),
      meta,
      offerSemantic: answer.confidence !== 'ok',
    };
  }

  /** The model that writes this answer, if one does. A fixed reply and a FAQ entry never go to a model. */
  function writer(question: string, answer: Answer): Generator | undefined {
    if (answer.kind === 'declined') return undefined;
    if (mode === 'cloud') return cloud;
    if (matchTrigger(question, kb.chunks)) return undefined;
    if (mode === 'device' && answer.confidence === 'ok' && answer.kind !== 'faq') return device?.generator;
    return undefined;
  }

  /** False when the question was not taken: empty, or the previous one is still being answered. */
  function ask(raw: string): boolean {
    const question = raw.trim().slice(0, INPUT_MAX);
    if (!question || asking) return false;
    asking = true;
    void answer(question).catch(() => {
      view.busy(false);
      view.answer({ mode: 'quotes', text: [], lead: 'The assistant could not finish that request. Please try again, or contact Daniil directly.', passages: [], chips: [], email: 'line', followUps: SUGGESTED, meta: '' });
      view.status('Please try again');
    }).finally(() => (asking = false));
    return true;
  }

  async function answer(question: string) {
    const chat = chatNo;
    view.question(question);
    view.status(COPY.status.searching);

    const began = performance.now();
    const asked = turns.map((turn) => englishSource(turn.q));
    // After a fixed reply or a miss there is no topic to carry over.
    const last = turns[turns.length - 1];
    const retrievalQuestion = englishSource(question);
    const { query, result } = searchInContext(index, retrievalQuestion, last, subjects, localKb.chunks);
    const timings = [`search ${(performance.now() - began).toFixed(1)} ms`];

    let similar: Float32Array | undefined;
    if (semantic && !matchTrigger(question, kb.chunks)) {
      const embedding = performance.now();
      const vector = await semantic.embed(query);
      if (chat !== chatNo) return;
      if (vector) {
        similar = denseScores(vector, semantic.vectors.data, semantic.vectors.count, EMBED.dim);
        timings.push(`embed ${Math.round(performance.now() - embedding)} ms`);
      }
    }

    const { scores, top, level } = ranking(result, similar);
    const answer = composeExtractive(retrievalQuestion, { top, scores, terms: result.terms, index }, level, localKb, asked);
    const quotes = toRecord(answer, asked, timings.join(' · '));
    const local = answer.kind !== 'declined' ? conversationalFallback(retrievalQuestion, kb.chunks, last?.q) : undefined;
    if (local) {
      quotes.text = local.text;
      quotes.passages = [];
      quotes.chips = local.cites.flatMap((id) => byId.has(id) ? [sourceOf(byId.get(id)!)] : []);
      quotes.followUps = local.followUps ?? quotes.followUps;
      quotes.offerSemantic = false;
      quotes.email = undefined;
    }
    quotes.resources = answer.kind === 'declined' ? [] : selectResources(retrievalQuestion, resources, quotes.chips.length ? quotes.chips : answer.passages, last?.q, last?.url);
    if (!local && quotes.resources.length && requestsResources(question)) {
      quotes.text = ['Here are the relevant public resources. You can view them here or open and download the files below.'];
      quotes.passages = [];
      quotes.chips = [];
      quotes.offerSemantic = false;
      quotes.email = undefined;
    }
    const first = answer.kind === 'declined' ? undefined : byId.get(local?.cites[0] ?? answer.passages[0]?.chunkId);
    const generator = writer(question, answer);
    const chosen = mode;
    const finish = (record: AnswerRecord, status: string, about = first?.title, url = first?.url) => {
      // A video/code/demo follow-up keeps the project it actually shared as
      // context, even if keyword search happened to retrieve another project.
      const selected = new Set(record.resources?.map((resource) => resource.project).filter(Boolean));
      const project = selected.size === 1 ? resources.find((resource) => resource.kind === 'project' && selected.has(resource.project)) : undefined;
      if (project) {
        about = project.title;
        url = project.url;
        if (requestsResources(question)) record.followUps = [`What is the stack of ${project.title}?`, `What was the result of ${project.title}?`, 'Show me his CV'].filter((q) => q.length <= FOLLOW_UP_MAX && !asked.includes(q));
      }
      turns.push({ q: question, answer: record, about, url, sent: generator?.id === 'cloud', at: Date.now() });
      save();
      view.status(status);
      return record;
    };
    const quoted = (extra: Partial<AnswerRecord> = {}) => {
      const sources = quotes.passages.length + quotes.chips.length;
      return finish({ ...quotes, ...extra }, extra.notice ? COPY.status.fallback : extra.note ? COPY.status.stopped : sources ? COPY.status.ready(sources) : quotes.resources?.length ? 'Resources ready' : COPY.status.notCovered);
    };
    if (!generator) return view.answer(quoted());

    const live = view.pending(chosen, answer.passages.map(({ label, url }) => ({ label, url: url.split(':~:')[0].replace(/#$/, '') })));
    const stop = (stopper = new AbortController());
    view.busy(true);
    const writing = performance.now();
    const outcome = await generateAnswer({
      generator,
      question,
      locale: currentLocale(),
      // Only questions that were themselves sent: nothing typed in "Site quotes" and no private question leaves the browser later.
      prev: generator.id === 'cloud' ? earlier(turns) : [],
      history: generator.id === 'cloud' ? conversationHistory(turns) : [],
      chunks: top.map((i) => kb.chunks[i]),
      byId,
      stop: stop.signal,
      onBlock: (text, ids) => live.block(text, ids.map((id) => sourceOf(byId.get(id)!))),
    });
    if (stopper === stop) stopper = undefined;
    view.busy(false);
    // "New chat" was pressed meanwhile: the transcript is empty and stays so.
    if (chat !== chatNo) return;

    if (outcome.kind === 'fallback') {
      if (outcome.reason === 'stopped') return live.finish(quoted({ note: COPY.stopped }));
      if (outcome.reason === 'budget') disabled.cloud = COPY.notice.budget;
      if (outcome.reason === 'device') deviceFailed();
      if (disabled[mode] !== undefined) setMode('quotes', false);
      return live.finish(quoted({ notice: NOTICE[outcome.reason] }));
    }
    const cited = outcome.cites.map((id) => byId.get(id)!);
    const took = `${generator.id === 'cloud' ? 'AI' : 'on device'} ${((performance.now() - writing) / 1000).toFixed(1)} s`;
    const record: AnswerRecord = {
      mode: chosen,
      text: outcome.blocks,
      passages: [],
      chips: cited.map(sourceOf),
      note: outcome.stopped ? COPY.stopped : outcome.cutShort ? COPY.cutShort : undefined,
      email: outcome.abstained ? 'line' : undefined,
      followUps: outcome.abstained ? [] : quotes.followUps,
      meta: [...timings, took].join(' · '),
      resources: selectResources(question, resources, cited.map(sourceOf), last?.q, last?.url),
    };
    const status = outcome.stopped ? COPY.status.stopped : outcome.abstained ? COPY.status.notCovered : COPY.status.ready(cited.length);
    live.finish(finish(record, status, cited[0]?.title ?? first?.title, cited[0]?.url ?? first?.url));
  }

  /* ------------------------------------------------------------------ start */

  // The switch first: it takes height from the transcript, which then scrolls to its last turn.
  draw();
  view.status(COPY.status.fresh);
  if (!ENDPOINT) view.hint('AI conversation is currently offline. You can still explore the portfolio and get the CV, demos and papers.');
  for (const turn of turns) {
    view.question(turn.q);
    view.answer(turn.answer);
  }
  if (DEVICE_MODE !== 'off') {
    // What the device can run is only known after asking it; the switch is redrawn then.
    void import('./device.ts')
      .then(({ probe }) => probe(capabilities()))
      .then((caps) => {
        offer = offerModes(caps);
        setMode(usable(saved) ? saved : mode, false);
      });
  }
  // Agreed to on an earlier visit: the model comes from the browser's cache.
  if (read('local', 'chat:semantic') && canSearchSmarter()) void loadSemantic(() => {}, new AbortController().signal);

  return {
    opened(by: HTMLElement) {
      trigger = by;
      view.focus();
    },
  };
}

let chat: ReturnType<typeof start> | undefined;

/** Called by the opener with the dialog (already shown) and the control that was pressed. */
export async function open(dialog: HTMLDialogElement, trigger: HTMLElement) {
  try {
    (await (chat ??= start(dialog))).opened(trigger);
  } catch (error) {
    // A temporary network failure should be retried when the visitor opens the assistant again.
    chat = undefined;
    throw error;
  }
}
