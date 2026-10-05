/** The model runs in its own browsing context, activated on visibility or Play. */
import { currentLocale, LANGUAGE_EVENT } from '../../i18n/client.ts';

export interface PreviewKind {
  channel: string;
  title: string;
  loading: string;
  failure: string;
  src(query: string, manual: boolean): string;
}
export const ARCHITECTURE: PreviewKind = {
  channel: 'portfolio-architecture',
  title: 'Live neural architecture generation — Pixel Morph',
  loading: 'Loading live 3D…',
  failure: 'This browser could not start the 3D preview. Try Play again, or open the full Pixel Morph demo from Selected work.',
  src: (query, manual) => `/architecture/?${query}&anchor=8&walk=tour&trans=blend&hd=1&neural=1&compact=1&speed=0.8&play=${manual ? 1 : 0}`,
};
export const DRAWING: PreviewKind = {
  channel: 'portfolio-drawing',
  title: 'Live neural drawing generation — Pixel Morph',
  loading: 'Loading live 2D…',
  failure: 'This browser could not start the 2D preview. Try Play again, or open the full Pixel Morph demo from Selected work.',
  src: (query, manual) => `/drawings/?${query}&play=${manual ? 1 : 0}`,
};

export function setupPreview(root: HTMLElement, kind: PreviewKind = ARCHITECTURE) {
  const play = root.querySelector<HTMLAnchorElement>('[data-play]')!;
  const remove = root.querySelector<HTMLButtonElement>('[data-remove]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-toggle]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-next]')!;
  const panel = root.querySelector<HTMLElement>('[data-preview]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  let frame: HTMLIFrameElement | null = null;
  let session = '';
  let visible = false;
  let ready = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const say = (message: string) => { status.hidden = !message; status.textContent = message; };
  const send = (type: string) => frame?.contentWindow?.postMessage({ channel: kind.channel, session, type, active: visible && !document.hidden }, location.origin);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const appearance = () => document.documentElement.dataset.theme ?? (scheme.matches ? 'dark' : 'light');
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; onVisibility(); }, { threshold: 0.05 });
  const sendTheme = () => frame?.contentWindow?.postMessage({ channel: kind.channel, session, type: 'theme', theme: appearance() }, location.origin);
  const sendLanguage = () => frame?.contentWindow?.postMessage({ channel: kind.channel, session, type: 'language', locale: currentLocale() }, location.origin);
  const theme = new MutationObserver(sendTheme);

  function teardown(message = '', restoreFocus = false) {
    const hadFocus = root.contains(document.activeElement);
    clearTimeout(deadline);
    observer.disconnect();
    theme.disconnect();
    scheme.removeEventListener('change', sendTheme);
    document.removeEventListener(LANGUAGE_EVENT, sendLanguage);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('pagehide', onPageHide);
    send('dispose');
    frame?.remove(); // Destroys the document, pending fetches, timers, and graphics contexts.
    frame = null;
    ready = false;
    session = '';
    panel.hidden = true;
    remove.hidden = true;
    toggle.hidden = next.hidden = true;
    play.hidden = false;
    play.setAttribute('aria-expanded', 'false');
    say(message);
    if (restoreFocus && hadFocus) play.focus({ preventScroll: true });
  }
  function onVisibility() {
    send('visibility');
    clearTimeout(deadline);
    if (frame && !ready && visible && !document.hidden) deadline = setTimeout(() => {
      teardown('The preview took too long to start. Check your connection and try Play again.', true);
    }, 90_000);
  }
  function onPageHide() { teardown(); }
  function playback(paused: boolean) {
    toggle.textContent = paused ? 'Resume' : 'Pause';
  }
  function onMessage(event: MessageEvent) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.channel !== kind.channel || data.session !== session) return;
    if (data.type === 'ready') {
      ready = true;
      clearTimeout(deadline);
      toggle.hidden = next.hidden = false;
      playback(data.paused === true);
      say('');
    } else if (data.type === 'playback' && typeof data.paused === 'boolean') {
      playback(data.paused);
    } else if (data.type === 'error') {
      teardown(kind.failure, true);
    }
  }
  remove.addEventListener('click', () => { teardown('Preview removed.'); play.focus({ preventScroll: true }); });
  toggle.addEventListener('click', () => send('toggle'));
  next.addEventListener('click', () => send('next'));

  return {
    start(manual = true) {
      if (frame) { frame.focus(); send('focus'); return; }
      session = crypto.randomUUID();
      visible = panel.getBoundingClientRect().top < innerHeight && root.getBoundingClientRect().bottom > 0;
      frame = document.createElement('iframe');
      frame.title = kind.title;
      frame.src = kind.src(`session=${encodeURIComponent(session)}&lang=${currentLocale()}&theme=${appearance()}`, manual);
      frame.addEventListener('load', () => { sendTheme(); sendLanguage(); onVisibility(); });
      document.addEventListener(LANGUAGE_EVENT, sendLanguage);
      window.addEventListener('message', onMessage);
      window.addEventListener('pagehide', onPageHide);
      document.addEventListener('visibilitychange', onVisibility);
      panel.hidden = false;
      panel.append(frame);
      remove.hidden = false;
      play.hidden = true;
      play.setAttribute('aria-expanded', 'true');
      if (manual) remove.focus({ preventScroll: true });
      say(kind.loading);
      observer.observe(panel);
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      scheme.addEventListener('change', sendTheme);
      onVisibility();
    },
  };
}
