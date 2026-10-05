/**
 * Video playback.
 *
 * Posters are plain images until someone presses play; only then is Mux Player
 * downloaded. A video with a Mux playback id streams from Mux, one without
 * plays the self-hosted MP4 through the same player.
 */
import { currentLocale, LANGUAGE_EVENT, t } from '../i18n/client';

export interface VideoPayload {
  id: string;
  title: string;
  src: string;
  /** A lighter rendition of `src` for phones. */
  small?: string;
  poster: string;
  /** width / height */
  ratio: number;
  playbackId?: string;
  startAt?: number;
}

const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
// A phone, upright or sideways: the 1080p file is several times what its screen can show.
const phone = window.matchMedia('(max-width: 760px), (max-height: 500px)');

let mux: Promise<unknown> | undefined;
let localizeMedia: (() => void) | undefined;
const loadMux = () => (mux ??= Promise.all([import('@mux/mux-player'), import('media-chrome/dist/utils/i18n.js'), import('media-chrome/dist/lang/en.js')]).then(([, i18n, { En }]) => {
  localizeMedia = () => {
    i18n.addTranslation(currentLocale(), Object.fromEntries(Object.keys(En).map((key) => [key, t(key)])) as typeof En);
    i18n.setLanguage(currentLocale());
    function visit(root: ShadowRoot | Element) {
      for (const element of root.querySelectorAll('*')) {
        if (element.localName === 'media-controller') element.setAttribute('lang', currentLocale());
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    }
    document.querySelectorAll('mux-player').forEach((player) => { if (player.shadowRoot) visit(player.shadowRoot); });
  };
  localizeMedia();
  document.addEventListener(LANGUAGE_EVENT, localizeMedia);
}).catch((error) => {
  mux = undefined;
  throw error;
}));

function readPayload(el: HTMLElement): VideoPayload | undefined {
  try {
    return JSON.parse(el.dataset.video ?? '') as VideoPayload;
  } catch {
    return undefined;
  }
}

async function createPlayer(video: VideoPayload): Promise<HTMLElement> {
  try {
    await loadMux();
  } catch {
    // Keep recordings watchable when the enhanced player cannot be downloaded.
    const fallback = document.createElement('video');
    fallback.poster = video.poster;
    fallback.controls = true;
    fallback.playsInline = true;
    if (video.startAt) fallback.addEventListener('loadedmetadata', () => { fallback.currentTime = video.startAt!; }, { once: true });
    fallback.src = (phone.matches || saveData) && video.small ? video.small : video.src;
    fallback.setAttribute('aria-label', video.title);
    fallback.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain';
    return fallback;
  }
  const player = document.createElement('mux-player');
  const attrs: Record<string, string> = {
    'stream-type': 'on-demand',
    poster: video.poster,
    title: video.title,
    'metadata-video-id': video.id,
    'metadata-video-title': video.title,
    'accent-color': '#0071e3',
    playsinline: '',
    lang: currentLocale(),
    autoplay: '',
  };
  if (video.playbackId) attrs['playback-id'] = video.playbackId;
  if (video.startAt) attrs['start-time'] = String(video.startAt);
  else Object.assign(attrs, { src: (phone.matches || saveData) && video.small ? video.small : video.src, 'disable-tracking': '' });
  for (const [name, value] of Object.entries(attrs)) player.setAttribute(name, value);
  queueMicrotask(() => localizeMedia?.());
  return player;
}

/* ------------------------------------------------------- inline players */

/** The inline player most recently asked to play. The last request wins. */
let wanted: HTMLElement | undefined;

document.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-player] .player__btn');
  const host = button?.closest<HTMLElement>('[data-player]');
  if (!host || host.dataset.state) return;
  const video = readPayload(host);
  if (!video) return;

  wanted = host;
  host.dataset.state = 'loading';
  try {
    const player = await createPlayer(video);
    // The player may have taken a while to download; another video may have been chosen since.
    if (wanted !== host) return resetPlayer(host);
    // One video at a time: every other player returns to its poster.
    document.querySelectorAll<HTMLElement>('[data-player][data-state]').forEach((other) => {
      if (other !== host) resetPlayer(other);
    });
    host.append(player);
    host.dataset.state = 'playing';
    // The play button has just been hidden; keep keyboard focus on the video.
    host.focus({ preventScroll: true });
  } catch (error) {
    resetPlayer(host);
    console.error('Could not start the video player', error);
  }
});

function resetPlayer(host: HTMLElement) {
  host.querySelector('mux-player, video:not(.preview-video)')?.remove();
  delete host.dataset.state;
}

/* --------------------------------------------------------- video dialog */

const dialog = document.querySelector<HTMLDialogElement>('[data-video-dialog]');
const stage = dialog?.querySelector<HTMLElement>('[data-video-stage]');
const heading = dialog?.querySelector<HTMLElement>('[data-video-title]');

document.addEventListener('click', async (event) => {
  const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-video-open]');
  if (!trigger || !dialog || !stage || !heading) return;
  const video = readPayload(trigger);
  if (!video) return;
  event.preventDefault();

  wanted = undefined;
  document.querySelectorAll<HTMLElement>('[data-player][data-state]').forEach(resetPlayer);
  heading.textContent = video.title;
  stage.style.setProperty('--ratio', String(video.ratio));
  stage.replaceChildren();
  dialog.showModal();
  const request = ++dialogRequest;
  try {
    const player = await createPlayer(video);
    // Closed, or another video chosen, while the player was still downloading:
    // attaching it now would play sound from a dialog nobody can see.
    if (!dialog.open || request !== dialogRequest) return;
    stage.replaceChildren(player);
  } catch (error) {
    dialog.close();
    console.error('Could not start the video player', error);
  }
});

/** Counts requests to the dialog, so a slow one can tell it has been superseded. */
let dialogRequest = 0;

if (dialog) closeOnBackdrop(dialog, '[data-video-close]');
dialog?.addEventListener('close', () => {
  dialogRequest++;
  stage?.replaceChildren();
});

/**
 * Closes a dialog from its close button or from a click on the backdrop.
 * The press must also have started on the backdrop: dragging a scrubber or
 * selecting text and letting go outside the panel should not close anything.
 */
export function closeOnBackdrop(target: HTMLDialogElement, closeSelector: string) {
  let pressedBackdrop = false;
  target.addEventListener('pointerdown', (event) => {
    pressedBackdrop = event.target === target;
  });
  target.addEventListener('click', (event) => {
    const el = event.target as HTMLElement;
    if (el.closest(closeSelector) || (el === target && pressedBackdrop)) target.close();
  });
}

/* -------------------------------------------------------- card previews */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function startPreview(host: HTMLElement) {
  let video = host.querySelector<HTMLVideoElement>('.preview-video');
  if (!video) {
    video = document.createElement('video');
    video.className = 'preview-video';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.src = host.dataset.preview!;
    video.addEventListener('playing', () => host.classList.add('is-previewing'));
    host.append(video);
  }
  video.play().catch(() => {
    /* autoplay refused: the poster simply stays */
  });
}

function stopPreview(host: HTMLElement) {
  const video = host.querySelector<HTMLVideoElement>('.preview-video');
  if (!video) return;
  video.pause();
  host.classList.remove('is-previewing');
}

if (!saveData && !reducedMotion) {
  const hosts = [...document.querySelectorAll<HTMLElement>('[data-preview]')];
  if (canHover) {
    // Previews respect both data-saving and reduced-motion preferences.
    for (const host of hosts) {
      const scope = host.closest<HTMLElement>('[data-preview-scope]') ?? host;
      scope.addEventListener('pointerenter', () => startPreview(host));
      scope.addEventListener('pointerleave', () => stopPreview(host));
      scope.addEventListener('focusin', () => startPreview(host));
      scope.addEventListener('focusout', () => stopPreview(host));
    }
  } else if (!reducedMotion) {
    // Touch devices have no hover: play the one preview nearest the centre of the screen.
    const inBand = new Set<HTMLElement>();
    const fromCentre = (host: HTMLElement) => {
      const box = host.getBoundingClientRect();
      return Math.hypot(box.left + box.width / 2 - window.innerWidth / 2, box.top + box.height / 2 - window.innerHeight / 2);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const host = entry.target as HTMLElement;
          if (entry.isIntersecting) inBand.add(host);
          else inBand.delete(host);
        }
        // Several sit in the band at once where cards are side by side.
        const [nearest] = [...inBand].sort((a, b) => fromCentre(a) - fromCentre(b));
        for (const host of hosts) {
          if (host === nearest) startPreview(host);
          else stopPreview(host);
        }
      },
      { rootMargin: '-35% 0px -35% 0px' },
    );
    hosts.forEach((host) => watcher.observe(host));
  }
}
