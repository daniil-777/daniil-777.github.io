/**
 * The "Ask AI" assistant: loaded by the opener in Base.astro on the first
 * click, never before. Loads the knowledge base, answers each question from
 * the site's own sentences, and, where a model is offered, lets it write the
 * answer and falls back to the quotes whenever that cannot be trusted.
 */
import styles from '../../styles/chat.css?inline';
import { CHAT_ENABLED } from '../../data/chat-status.ts';
import { COPY, DEVICE_MODE, INPUT_MAX, LOCAL_LLM, SUGGESTED } from '../../data/chat.ts';
import { createRag } from '../../lib/chat/rag.ts';
import { generalQuestion } from '../../lib/chat/prompt.ts';
import { composeExtractive, type Answer } from '../../lib/chat/answer.ts';
import { buildIndex } from '../../lib/chat/bm25.ts';
import { EMBED } from '../../lib/chat/embed.ts';
import type { Chunk, Kb } from '../../lib/chat/kb.ts';
import { offerModes, type Capabilities } from '../../lib/chat/modes.ts';
import { denseScores, matchTrigger, ranking, subjectTerms } from '../../lib/chat/retrieve.ts';
import { conversationalFallback, offlineReply, requestsResources, safeResource, selectResources } from '../../lib/chat/resources.ts';
import { displayTitle } from '../../lib/chat/text.ts';
import type { Generator } from '../../lib/chat/types.ts';
import { chatConnection } from '../../lib/chat/connection.ts';
import { closeOnBackdrop } from '../player.ts';
import { createCloud } from './cloud.ts';
import { conversationHistory, earlier, generateAnswer, searchInContext, type FallbackReason } from './pipeline.ts';
import { createOptionalModels } from './optional-models.ts';
import { restoreTurns, type Turn } from './transcript.ts';
import { createView, type AnswerRecord, type Mode, type Source } from './view.ts';
import { currentLocale, englishSource, LANGUAGE_EVENT, loadFullCatalog, prose, refreshTranslations, t } from '../../i18n/client';

// As text, not as a stylesheet of the page: Astro would add that to every page, opened or not.
document.head.append(Object.assign(document.createElement('style'), { textContent: styles }));

const { local: LOCAL_ENDPOINT, endpoint: ENDPOINT } = chatConnection();
/** How many turns survive a page change (sessionStorage). */
const TURNS_MAX = 10;
const FOLLOW_UP_MAX = 80;
async function cancellable(work: Promise<void>, signal: AbortSignal) {
  if (signal.aborted) return;
  let abort!: () => void;
  try { await Promise.race([work, new Promise<void>(resolve => { abort = resolve; signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}

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
  budget: COPY.notice.localFallback,
  credits: COPY.notice.credits,
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
  const rag = createRag(kb.chunks, buildIndex(kb.chunks));
  const recruiter = rag.recruiter;
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
  let modeRevision = 0;
  /** Modes that failed in a way that will not get better during this page view, and why. */
  const disabled: Partial<Record<Mode, string>> = {};
  const cloud = ENDPOINT ? createCloud(ENDPOINT, fetch, LOCAL_ENDPOINT ? 90_000 : undefined) : undefined;

  const view = createView(dialog, kb.built, { ask, stop: () => stopper?.abort(), mode: setMode, reset, semantic: () => optional.offerSemantic() });
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
  const saved = read('local', 'chat:mode:v3');
  // A local download needs consent even when a billing failure selects the mode.
  // Until capability probing finishes, a saved local preference stays source-only.
  // It must never temporarily send a question to OpenAI.
  let mode: Mode = saved === 'device' ? 'quotes' : usable(saved) ? saved : usable('cloud') ? 'cloud' : 'quotes';

  const optional = createOptionalModels({ kb, dialog, view, offer: () => offer, mode: () => mode,
    select: next => setMode(next, false), changed: draw, failed: deviceFailed, stop: () => stopper?.abort(),
    read: key => read('local', key), write: (key, value) => write('local', key, value) });
  function draw() {
    view.modes([{ mode: 'cloud', label: LOCAL_ENDPOINT ? 'Local server' : 'OpenAI', disabled: !cloud ? 'Not configured' : disabled.cloud },
      { mode: 'device', disabled: disabled.device ?? (!(offer.builtin || offer.webgpu) ? COPY.device.unavailable : undefined) },
      { mode: 'quotes' }], mode);
    view.semanticOffer(mode === 'quotes' && optional.canSearch());
  }

  function setMode(next: Mode, remember = true) {
    if (remember && asking) return;
    modeRevision++;
    mode = usable(next) ? next : 'quotes';
    if (remember) write('local', 'chat:mode:v3', mode);
    draw();
    if (mode === 'device') void optional.local();
  }

  function save() {
    turns = turns.slice(-TURNS_MAX);
    write('session', 'chat:turns', JSON.stringify(turns));
  }

  function reset() {
    chatNo += 1;
    stopper?.abort();
    optional.cancel();
    view.cancelConsent();
    turns = [];
    save();
    view.clear();
    view.status(COPY.status.fresh);
    view.focus();
  }

  function deviceFailed() {
    disabled.device = COPY.notice.deviceFailed;
    view.hint(COPY.notice.deviceFailed);
    setMode('quotes', false);
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
    if (matchTrigger(question, kb.chunks)) return undefined;
    // Personal replies use published text and reviewed assessments. A small
    // language model's fluent wording is not evidence for a new biographical claim.
    if (mode === 'cloud') return cloud;
    if (mode === 'device' && generalQuestion(question, kb.chunks, turns.map(turn => ({ q: turn.q, a: '' })))) return optional.generator();
    return undefined;
  }

  /** False when the question was not taken: empty, or the previous one is still being answered. */
  function ask(raw: string): boolean {
    const question = raw.trim().slice(0, INPUT_MAX);
    if (!question || asking) return false;
    asking = true;
    const askedIn = chatNo;
    void answer(question).catch(() => {
      if (askedIn !== chatNo) return;
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
    const offline = offlineReply(retrievalQuestion);
    const { query, result } = searchInContext(index, retrievalQuestion, last, subjects, localKb.chunks);
    const timings = [`search ${(performance.now() - began).toFixed(1)} ms`];

    let similar: Float32Array | undefined;
    const semantic = optional.semantic();
    if (semantic && !offline && !matchTrigger(question, kb.chunks) && !requestsResources(question)) {
      const embedding = performance.now();
      const vector = await semantic.embed(query);
      if (chat !== chatNo || !dialog.open) return;
      if (vector) {
        similar = denseScores(vector, semantic.vectors.data, semantic.vectors.count, EMBED.dim);
        timings.push(`embed ${Math.round(performance.now() - embedding)} ms`);
      }
    }

    const { scores, top, level } = ranking(result, similar);
    const answer = composeExtractive(retrievalQuestion, { top, scores, terms: result.terms, index }, level, localKb, asked);
    const quotes = toRecord(answer, asked, timings.join(' · '));
    const card = answer.kind !== 'declined' ? recruiter.match(retrievalQuestion) : undefined;
    const detail = answer.kind !== 'declined' ? rag.detailed(retrievalQuestion, last) : undefined;
    const local = offline ?? (detail ? { ...detail, followUps: undefined } : card ? { text: card.answer.split('\n\n'), cites: card.sourceIds, followUps: undefined } : answer.kind !== 'declined' ? conversationalFallback(retrievalQuestion, kb.chunks, last?.q) : undefined);
    if (local) {
      quotes.text = local.text;
      quotes.passages = [];
      quotes.chips = local.cites.flatMap((id) => byId.has(id) ? [sourceOf(byId.get(id)!)] : []);
      quotes.followUps = local.followUps ?? (card ? SUGGESTED.filter(q => !asked.includes(q) && q !== question) : quotes.followUps);
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
    let generator = offline || (mode !== 'cloud' && (detail || card)) || (quotes.resources.length && requestsResources(question)) ? undefined : writer(question, answer);
    let chosen = mode;
    const finish = (record: AnswerRecord, status: string, about?: string, url?: string) => {
      // A video/code/demo follow-up keeps the project it actually shared as
      // context, even if keyword search happened to retrieve another project.
      const selected = new Set(record.resources?.map((resource) => resource.project).filter(Boolean));
      const project = selected.size === 1 ? resources.find((resource) => resource.kind === 'project' && selected.has(resource.project)) : undefined;
      if (project) {
        about = project.title;
        url = project.url;
        if (requestsResources(question)) record.followUps = [`What is the stack of ${project.title}?`, `What was the result of ${project.title}?`, 'Show me his CV'].filter((q) => q.length <= FOLLOW_UP_MAX && !asked.includes(q));
      }
      turns.push({ q: question, answer: record, about, url, sent: !!generator, at: Date.now() });
      save();
      view.status(status);
      return record;
    };
    const quoted = (extra: Partial<AnswerRecord> = {}) => {
      const sources = quotes.passages.length + quotes.chips.length;
      return finish({ ...quotes, ...extra }, extra.notice ? COPY.status.fallback : extra.note ? COPY.status.stopped : sources ? COPY.status.ready(sources) : quotes.resources?.length ? 'Resources ready' : COPY.status.notCovered, first?.title, first?.url);
    };
    if (!generator) return view.answer(quoted());

    const live = view.pending(chosen, answer.passages.map(({ label, url }) => ({ label, url: url.split(':~:')[0].replace(/#$/, '') })));
    const stop = (stopper = new AbortController());
    view.busy(true);
    const writing = performance.now();
    // A source-only resource reply can change the topic between cloud turns.
    // Send a public, retrieved title as context; never upload the earlier local question.
    const withTopic = last?.answer.mode !== 'cloud' && query !== retrievalQuestion && first ? `${question}\nPublic portfolio topic: ${first.title}` : question;
    const modelQuestion = withTopic.length <= INPUT_MAX ? withTopic : question;
    const generate = () => generateAnswer({
      generator: generator!,
      question: modelQuestion,
      locale: currentLocale(),
      // Only earlier cloud questions/replies are sent back to the cloud.
      prev: generator!.id === 'cloud' ? earlier(turns) : [],
      history: conversationHistory(turns, chosen),
      chunks: rag.retrieve(retrievalQuestion, last),
      byId,
      stop: stop.signal,
      onBlock: (text, ids) => live.block(text, ids.map((id) => sourceOf(byId.get(id)!))),
    });
    let outcome = await generate();
    let fallbackNotice: string | undefined;
    if (outcome.kind === 'fallback' && (outcome.reason === 'credits' || outcome.reason === 'budget') && chosen === 'cloud' && chat === chatNo && !stop.signal.aborted) {
      const reason = outcome.reason;
      fallbackNotice = reason === 'credits' ? COPY.notice.credits : COPY.notice.localFallback;
      await cancellable(probeReady, stop.signal);
      if (stop.signal.aborted || chat !== chatNo) {
        if (stopper === stop) stopper = undefined;
        view.busy(false);
        if (chat !== chatNo) return;
        return live.finish(quoted({ note: COPY.stopped }));
      }
      if (!stop.signal.aborted && chat === chatNo && (offer.builtin || offer.webgpu) && !disabled.device) {
        setMode('device', false);
        live.restart('device', fallbackNotice);
        view.status(fallbackNotice);
        if (generalQuestion(modelQuestion, kb.chunks, turns.map(turn => ({ q: turn.q, a: '' })))) {
          const localGenerator = await optional.local(stop.signal);
          if (localGenerator && !stop.signal.aborted && chat === chatNo) {
            generator = localGenerator; chosen = 'device';
            outcome = await generate();
            if (outcome.kind === 'answer') fallbackNotice = 'OpenAI usage limit reached. Answered with our local model.';
            else if (outcome.reason !== 'stopped') fallbackNotice = `${NOTICE[outcome.reason]} ${COPY.notice.budget}`;
          } else fallbackNotice = 'The AI usage limit was reached. Showing portfolio sources instead.';
        } else fallbackNotice = 'The AI usage limit was reached. Answering from the public portfolio.';
      } else {
        setMode('quotes', false);
        fallbackNotice = stop.signal.aborted ? undefined : COPY.notice.localUnavailable;
      }
      if (stop.signal.aborted) outcome = { kind: 'fallback', reason: 'stopped' };
    }
    if (stopper === stop) stopper = undefined;
    view.busy(false);
    // "New chat" was pressed meanwhile: the transcript is empty and stays so.
    if (chat !== chatNo) return;

    if (outcome.kind === 'fallback') {
      if (outcome.reason === 'stopped') return live.finish(quoted({ note: COPY.stopped }));
      if (outcome.reason === 'device') deviceFailed();
      if (disabled[mode] !== undefined) setMode('quotes', false);
      return live.finish(quoted({ notice: fallbackNotice ?? NOTICE[outcome.reason] }));
    }
    const cited = outcome.cites.map((id) => byId.get(id)!);
    const took = `${generator.id === 'cloud' ? 'AI' : 'on device'} ${((performance.now() - writing) / 1000).toFixed(1)} s`;
    const record: AnswerRecord = {
      mode: chosen,
      notice: fallbackNotice,
      text: outcome.blocks,
      passages: [],
      chips: cited.map(sourceOf),
      note: outcome.stopped ? COPY.stopped : outcome.cutShort ? COPY.cutShort : undefined,
      email: outcome.abstained ? 'line' : undefined,
      followUps: outcome.abstained ? [] : cited.length ? quotes.followUps : ['Give a concrete example.', 'Explain it in more detail.'],
      meta: [...timings, took].join(' · '),
      resources: requestsResources(question) ? selectResources(question, resources, cited.map(sourceOf), last?.q, last?.url) : [],
    };
    const status = outcome.stopped ? COPY.status.stopped : outcome.abstained ? COPY.status.notCovered : COPY.status.ready(cited.length);
    live.finish(finish(record, status, cited[0]?.title, cited[0]?.url));
  }

  /* ------------------------------------------------------------------ start */

  // The switch first: it takes height from the transcript, which then scrolls to its last turn.
  draw();
  view.status(COPY.status.fresh);
  if (!ENDPOINT) view.hint('Portfolio answers run locally. Choose Local AI on a supported device for broader questions and conversation.');
  for (const turn of turns) {
    view.question(turn.q);
    view.answer(turn.answer);
  }
  const initialRevision = modeRevision;
  const probeReady = DEVICE_MODE !== 'off' ? import('./device.ts').then(({ probe }) => probe(capabilities())).then(caps => {
    offer = offerModes(caps);
    if (modeRevision === initialRevision) setMode(usable(saved) ? saved : mode, false);
    else draw();
  }).catch(() => {}) : Promise.resolve();
  optional.restoreSearch();

  return {
    opened(by: HTMLElement) {
      trigger = by;
      optional.opened();
      view.focus();
    },
  };
}

let chat: ReturnType<typeof start> | undefined;

/** Called by the opener with the dialog (already shown) and the control that was pressed. */
export async function open(dialog: HTMLDialogElement, trigger: HTMLElement) {
  if (!CHAT_ENABLED) return;
  try {
    (await (chat ??= start(dialog))).opened(trigger);
  } catch (error) {
    // A temporary network failure should be retried when the visitor opens the assistant again.
    chat = undefined;
    throw error;
  }
}
