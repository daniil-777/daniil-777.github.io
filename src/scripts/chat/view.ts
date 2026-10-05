/**
 * Everything the assistant draws. The dialog shell is static markup
 * (ChatDialog.astro); the rest is built here on first open. Text always goes
 * in through `textContent`, and every link comes from the knowledge base:
 * nothing a model writes is ever parsed as markup or turned into a link.
 */
import { COPY, INPUT_MAX, SUGGESTED } from '../../data/chat.ts';
import { site } from '../../data/site.ts';
import type { Resource } from '../../lib/chat/resources.ts';
import type { Progress } from './semantic.ts';
import { createVoice } from './voice.ts';

export type Mode = keyof typeof COPY.modes;

export interface Source {
  label: string;
  url: string;
}

/** One answer as it is shown, and as it is kept in sessionStorage. */
export interface AnswerRecord {
  mode: Mode;
  /** Why this is not the kind of answer the visitor chose. */
  notice?: string;
  /** Blocks written by a model. Empty for a quotes answer. */
  text: string[];
  lead?: string;
  /** The lines of a list answer. */
  items?: string[];
  /** Quoted sentences, each with its source. */
  passages: (Source & { text: string })[];
  chips: Source[];
  /** "Stopped" or "(answer cut short)". */
  note?: string;
  /** Where the mail link goes: on a line of its own, or inside the "not what you were looking for" sentence. */
  email?: 'line' | 'closest';
  followUps: string[];
  meta: string;
  offerSemantic?: boolean;
  resources?: Resource[];
}

export interface ModeOption {
  mode: Mode;
  /** Set when the mode cannot be used for the rest of this page view. */
  disabled?: string;
}

export interface Handlers {
  /** False when the question was not taken, so the field keeps it. */
  ask(question: string): boolean;
  stop(): void;
  mode(mode: Mode): void;
  reset(): void;
  semantic(): void;
}

/** An answer that is still being written. */
export interface Live {
  block(text: string, chips: Source[]): void;
  finish(record: AnswerRecord): void;
}

type Child = Node | string | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) el.setAttribute(name, '');
    else if (typeof value === 'string') el.setAttribute(name, value);
  }
  el.append(...children.filter((child): child is Node | string => child !== false && child !== undefined));
  return el;
}

const chip = (source: Source) => h('a', { class: 'chip', href: source.url }, source.label);
const chips = (sources: Source[]) => sources.length > 0 && h('ul', { class: 'turn__sources', 'aria-label': 'Sources' }, ...sources.map((source) => h('li', {}, chip(source))));
const mail = () => h('a', { href: `mailto:${site.email}` }, COPY.emailLink);

/** Shared by live, completed and restored assistant replies. */
function assistantTurn(busy: boolean, ...children: Child[]) {
  return h('article', { class: 'turn turn--a', 'aria-busy': busy ? 'true' : undefined },
    h('img', { class: 'turn__avatar', src: '/images/chat-avatar.webp', alt: '', width: '36', height: '36', decoding: 'async' }),
    h('div', { class: 'turn__content' }, ...children),
  );
}

function resourceCards(resources: Resource[] = []) {
  const labels = { cv: 'CV · PDF', video: 'Video', project: 'Project', demo: 'Live demo', code: 'Source code', document: 'Document · PDF', profile: 'Profile' };
  return resources.length > 0 && h('div', { class: 'turn__resources', 'aria-label': 'Files and project resources' }, ...resources.map((resource) => h(
    'article', { class: 'turn__resource' },
    h('p', { class: 'turn__resource-kind' }, labels[resource.kind]),
    h('strong', {}, resource.title),
    resource.description && h('p', { class: 'turn__resource-description' }, resource.description),
    resource.kind === 'video' && h('video', { src: resource.url, controls: true, playsinline: true, preload: 'none', poster: resource.poster, 'aria-label': resource.title }),
    h('p', { class: 'turn__resource-actions' },
      h('a', { class: 'chip', href: resource.url, target: '_blank', rel: 'noopener', 'data-resource-link': true }, resource.kind === 'video' ? 'Open video' : resource.download ? 'Open PDF' : 'Open'),
      resource.download && h('a', { class: 'chip', href: resource.url, download: true, 'data-resource-link': true }, resource.kind === 'cv' ? 'Download CV' : 'Download PDF'),
    ),
  )));
}

export function createView(dialog: HTMLDialogElement, built: string, handlers: Handlers) {
  const body = dialog.querySelector<HTMLElement>('[data-chat-body]')!;
  const live = dialog.querySelector<HTMLElement>('[data-chat-status]')!;
  const fresh = dialog.querySelector<HTMLButtonElement>('[data-chat-new]')!;

  const modes = h('fieldset', { class: 'chat__modes', hidden: true });
  const smart = h('button', { class: 'chat__smart', type: 'button', hidden: true }, COPY.semantic.offer);
  const hint = h('p', { class: 'chat__hint', hidden: true });
  const log = h('div', { class: 'chat__log', role: 'log', 'aria-live': 'off', 'aria-label': 'Conversation' });
  const suggest = h('ul', { class: 'chat__suggest', 'aria-label': 'Suggested questions' }, ...SUGGESTED.map((q) => h('li', {}, h('button', { class: 'chip', type: 'button', 'data-ask': q }, q))));
  const consent = h('div', { class: 'chat__consent', hidden: true });
  // Everything between the header and the field scrolls together, so the field is always the last visible row.
  const scroll = h('div', { class: 'chat__scroll', role: 'group', 'aria-label': 'Conversation and suggestions', tabindex: '0' }, h('p', { class: 'chat__disclosure' }, COPY.disclosure), log, suggest, consent);
  const narrow = window.matchMedia('(max-width: 420px)');
  const input = h('textarea', { id: 'chat-q', rows: '1', maxlength: String(INPUT_MAX), enterkeyhint: 'send', placeholder: narrow.matches ? COPY.placeholderShort : COPY.placeholder });
  narrow.addEventListener('change', () => (input.placeholder = narrow.matches ? COPY.placeholderShort : COPY.placeholder));
  const count = h('p', { class: 'chat__count', hidden: true });
  const send = h('button', { class: 'btn btn--primary btn--small', type: 'submit', 'data-chat-send': true }, COPY.send);
  const form = h('form', { class: 'chat__form', 'data-chat-form': true }, h('label', { class: 'sr-only', for: 'chat-q' }, 'Your question'), input, send, count);

  body.replaceChildren(
    h('div', { class: 'chat__tools' }, modes, smart, hint),
    scroll,
    form,
    h('p', { class: 'chat__foot' }, `Content updated ${built}. `, h('a', { href: '/ask/#how-it-works' }, COPY.howItWorks)),
  );

  let running = false;
  let announce = 0;

  function status(text: string) {
    window.clearTimeout(announce);
    live.textContent = '';
    announce = window.setTimeout(() => (live.textContent = text), 100);
  }

  const voice = createVoice(form, input, send, resize, status);

  const submit = () => {
    const question = input.value.trim();
    if (running || voice.active() || !question || !handlers.ask(question)) return;
    input.value = '';
    resize();
  };

  /** The field grows with its text, up to the four lines the stylesheet allows. */
  function resize() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    count.hidden = input.value.length < INPUT_MAX - 50;
    count.textContent = `${input.value.length} / ${INPUT_MAX}`;
  }

  input.addEventListener('input', resize);
  input.addEventListener('keydown', (event) => {
    // Enter during an IME composition picks a candidate; it must not send.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submit();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (running) handlers.stop();
    else submit();
  });
  fresh.addEventListener('click', () => handlers.reset());
  smart.addEventListener('click', () => handlers.semantic());
  modes.addEventListener('change', (event) => handlers.mode((event.target as HTMLInputElement).value as Mode));
  body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const asked = target.closest<HTMLElement>('[data-ask]')?.dataset.ask;
    if (asked && !running && !voice.active()) handlers.ask(asked);
    if (target.closest('[data-semantic]')) handlers.semantic();
    // A source on this very page scrolls behind the dialog, so the dialog gets out of the way.
    if (target.closest('a[href^="/"]:not([data-resource-link])')) dialog.close();
  });

  // On a phone the on-screen keyboard covers the bottom of the layout viewport; the sheet follows the visible part.
  const viewport = window.visualViewport;
  const fit = () => dialog.style.setProperty('--vvh', `${viewport!.height}px`);
  if (viewport) {
    viewport.addEventListener('resize', fit);
    fit();
  }

  function article(record: AnswerRecord): HTMLElement {
    const lead = record.text.length === 0 && record.lead;
    return assistantTurn(
      false,
      h('h3', { class: 'sr-only' }, 'Answer'),
      h('p', { class: 'turn__mode' }, COPY.modes[record.mode].label),
      record.notice && h('p', { class: 'turn__notice' }, record.notice),
      record.text.length > 0 && h('div', { class: 'turn__text', 'data-no-translate': record.mode !== 'quotes' || undefined }, ...record.text.map((text) => h('p', {}, text))),
      lead && h('div', { class: 'turn__text' }, ...lead.split(/\n+/).map((line) => h('p', {}, line))),
      record.items && h('ul', { class: 'turn__list' }, ...record.items.map((item) => h('li', {}, item))),
      ...record.passages.map((passage) => h('figure', { class: 'turn__passage' }, h('blockquote', { class: 'turn__quote' }, passage.text), h('figcaption', {}, chip(passage)))),
      record.note && h('p', { class: 'turn__note' }, record.note),
      record.email === 'line' && h('p', { class: 'turn__email' }, mail()),
      record.email === 'closest' && h('p', { class: 'turn__email' }, COPY.lead.closestAfter.split(COPY.emailLink)[0], mail(), COPY.lead.closestAfter.split(COPY.emailLink)[1]),
      chips(record.chips),
      resourceCards(record.resources),
      record.offerSemantic && !smart.hidden && h('p', {}, h('button', { class: 'chat__smart', type: 'button', 'data-semantic': true }, COPY.semantic.offer)),
      record.followUps.length > 0 &&
        h('ul', { class: 'turn__next', 'aria-label': 'Follow-up questions' }, ...record.followUps.map((q) => h('li', {}, h('button', { class: 'chip', type: 'button', 'data-ask': q }, q)))),
    );
  }

  /** The start of the newest turn comes into view, not the end of its answer. Focus never moves. */
  let asked: HTMLElement | undefined;
  const reveal = () => asked && (scroll.scrollTop = asked.offsetTop - 4);

  function started() {
    body.toggleAttribute('data-started', true);
    suggest.hidden = true;
    fresh.hidden = false;
  }

  return {
    focus: () => input.focus({ preventScroll: true }),

    /** Announced by screen readers. Cleared first, so the same words are read again. */
    status,

    /** While an answer is being written, Send is Stop. */
    busy(on: boolean) {
      running = on;
      voice.busy(on);
      send.textContent = on ? COPY.stop : COPY.send;
      send.classList.toggle('btn--primary', !on);
      send.classList.toggle('btn--quiet', on);
    },

    question(text: string) {
      started();
      const turn = h('article', { class: 'turn turn--q' }, h('h3', { class: 'sr-only' }, 'You asked'), h('p', { 'data-no-translate': true }, text));
      log.append(turn);
      asked = turn;
    },

    answer(record: AnswerRecord) {
      started();
      log.append(article(record));
      reveal();
    },

    /** The sources are there at once; the text arrives block by block above them. */
    pending(mode: Mode, sources: Source[]): Live {
      const text = h('div', { class: 'turn__text' }, h('p', { class: 'turn__writing' }, COPY.writing));
      const list = h('ul', { class: 'turn__sources', 'aria-label': 'Sources' }, ...sources.map((source) => h('li', {}, chip(source))));
      const shown = new Set(sources.map((source) => source.url));
      const turn = assistantTurn(true, h('h3', { class: 'sr-only' }, 'Answer'), h('p', { class: 'turn__mode' }, COPY.modes[mode].label), text, list);
      let first = true;
      log.append(turn);
      reveal();
      return {
        block(block, cited) {
          if (first) text.replaceChildren();
          // The quotes' sources were a promise; from the first block on, only what the answer cites stays.
          if (first) list.replaceChildren();
          if (first) shown.clear();
          first = false;
          text.append(h('p', { 'data-no-translate': true }, block));
          for (const source of cited) {
            if (shown.has(source.url)) continue;
            shown.add(source.url);
            list.append(h('li', {}, chip(source)));
          }
        },
        finish: (record) => turn.replaceWith(article(record)),
      };
    },

    clear() {
      voice.cancel();
      log.querySelectorAll('video').forEach((video) => video.pause());
      log.replaceChildren();
      body.removeAttribute('data-started');
      suggest.hidden = false;
      fresh.hidden = true;
    },

    /** The switch is drawn only when there is something to choose. */
    modes(options: ModeOption[], current: Mode) {
      modes.hidden = options.length < 2;
      modes.replaceChildren(
        h('legend', { class: 'sr-only' }, COPY.modesLegend),
        ...options.map(({ mode, disabled }) =>
          h(
            'label',
            { class: 'chat__mode' },
            h('input', { type: 'radio', name: 'chat-mode', value: mode, checked: mode === current, disabled: disabled !== undefined }),
            h('span', {}, COPY.modes[mode].option, disabled !== undefined && h('small', {}, ` · ${disabled}`)),
          ),
        ),
      );
    },

    semanticOffer(show: boolean) {
      smart.hidden = !show;
      if (!show) log.querySelectorAll('[data-semantic]').forEach((button) => button.parentElement?.remove());
    },

    /** A line under the switch: what an optional model is doing, and a way to undo it. */
    hint(text: string, action?: { label: string; run(): void }) {
      const button = action && h('button', { class: 'chat__smart', type: 'button' }, action.label);
      button?.addEventListener('click', action!.run);
      hint.replaceChildren(text, ...(button ? [button] : []));
      hint.hidden = !text && !action;
    },

    /**
     * Asks before a download. On "yes" the row shows the progress of `run` and a
     * Cancel button that aborts it; it goes away when `run` settles.
     */
    consent(copy: { consent: string; accept: string; decline: string }, run: (progress: Progress, signal: AbortSignal) => Promise<void>, declined: () => void = () => {}) {
      const close = () => {
        consent.hidden = true;
        consent.replaceChildren();
      };
      const accept = h('button', { class: 'btn btn--primary btn--small', type: 'button' }, copy.accept);
      const decline = h('button', { class: 'btn btn--quiet btn--small', type: 'button' }, copy.decline);
      decline.addEventListener('click', () => {
        close();
        declined();
        input.focus();
      });
      accept.addEventListener('click', () => {
        const control = new AbortController();
        const bar = h('progress', { max: '1', 'aria-label': 'Download' });
        const amount = h('span', { class: 'chat__amount' });
        const cancel = h('button', { class: 'btn btn--quiet btn--small', type: 'button' }, 'Cancel');
        cancel.addEventListener('click', () => control.abort());
        let step = 0;
        consent.replaceChildren(h('p', {}, bar, amount), h('p', { class: 'chat__choice' }, cancel));
        cancel.focus();
        run((loaded, total) => {
          bar.value = total ? loaded / total : 0;
          amount.textContent = `${(loaded / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB`;
          // Announced at quarters, not at every chunk.
          const quarter = Math.floor((bar.value * 100) / 25);
          if (quarter > step) this.status(`Downloaded ${(step = quarter) * 25}%`);
        }, control.signal).finally(() => {
          close();
          input.focus();
        });
      });
      consent.replaceChildren(h('p', {}, copy.consent), h('p', { class: 'chat__choice' }, accept, decline));
      consent.hidden = false;
      accept.focus();
    },
  };
}

export type View = ReturnType<typeof createView>;
