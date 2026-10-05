import { chooseLocale, interpolate, isLocale, LANGUAGES, LOCALES, translate, translateProse, type Catalog, type Dictionary, type Locale } from './core.ts';

export const LANGUAGE_EVENT = 'portfolio:languagechange';
let catalogs: Catalog = {};
let locale: Locale = 'en';
const full = new Set<Locale>();
const requests = new Map<Locale, Promise<void>>();

export const currentLocale = () => locale;
export const dictionary = () => catalogs[locale] ?? {};
export const t = (source: string, values: Record<string, string | number> = {}) => interpolate(translate(source, dictionary()), values);
export const prose = (source: string) => locale === 'en' ? source : translateProse(source, dictionary());
const reverse = new WeakMap<Dictionary, Dictionary>();
export function englishSource(text: string, rich = false): string {
  const active = dictionary();
  let inverse = reverse.get(active);
  if (!inverse) {
    inverse = Object.fromEntries(Object.entries(active).filter(([, value]) => value).map(([source, value]) => [value, source]));
    reverse.set(active, inverse);
  }
  return rich ? translateProse(text, inverse) : translate(text, inverse);
}

/** Only the assistant and standalone 3D view need the entire site's catalog. */
export function loadFullCatalog(code = locale): Promise<void> {
  if (code === 'en' || full.has(code)) return Promise.resolve();
  const pending = requests.get(code);
  if (pending) return pending;
  const request = fetch(`/i18n/${code}.json`, { signal: AbortSignal.timeout(10_000) }).then(async (response) => {
    if (!response.ok) throw new Error('Language catalog unavailable');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some((value) => typeof value !== 'string')) throw new Error('Invalid language catalog');
    catalogs[code] = { ...catalogs[code], ...data as Dictionary };
    full.add(code);
  }).finally(() => requests.delete(code));
  requests.set(code, request);
  return request;
}

const ignored = 'script, style, svg, code, pre, textarea, [data-no-translate], [translate="no"]';
const textSources = new WeakMap<Text, { source: string; rendered: string }>();
const attributeSources = new WeakMap<Element, Map<string, { source: string; rendered: string }>>();
const attributes = ['aria-label', 'aria-description', 'aria-valuetext', 'title', 'alt', 'placeholder'];
let observer: MutationObserver | undefined;
let watched: HTMLElement | undefined;
function rememberText(node: Text) {
  if (node.parentElement?.closest(ignored) || !node.data.trim()) return;
  const prior = textSources.get(node);
  const rich = !!node.parentElement?.closest('.turn__text, .turn__quote');
  const source = prior && prior.rendered === node.data ? prior.source : englishSource(node.data, rich);
  const rendered = rich ? translateProse(source, dictionary()) : translate(source, dictionary());
  textSources.set(node, { source, rendered });
  if (node.data !== rendered) node.data = rendered;
}
function rememberAttributes(element: Element) {
  if (element.closest(ignored)) return;
  const prior = attributeSources.get(element) ?? new Map();
  for (const key of attributes) {
    const value = element.getAttribute(key);
    if (!value) continue;
    const old = prior.get(key);
    const source = old && old.rendered === value ? old.source : englishSource(value);
    const rendered = translate(source, dictionary());
    prior.set(key, { source, rendered });
    if (value !== rendered) element.setAttribute(key, rendered);
  }
  attributeSources.set(element, prior);
  // The player's shadow-DOM controller inherits this explicit language.
  if (element.localName === 'mux-player') element.setAttribute('lang', locale);
  if (element.localName === 'a') {
    const link = element as HTMLAnchorElement;
    if (!link.hasAttribute('href')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !(/^\/(?:work\/[^/]+\/|ask\/|smart-watch\/(?:embed\/)?|(?:architecture|drawings)\/(?:credits\.html)?|)$/.test(url.pathname))) return;
    url.searchParams.set('lang', locale);
    link.href = `${url.pathname}${url.search}${url.hash}`;
  }
}
function scan(root: Node) {
  if (root instanceof Text) return rememberText(root);
  if (!(root instanceof Element) || root.closest(ignored)) return;
  rememberAttributes(root);
  root.querySelectorAll('*').forEach(rememberAttributes);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) rememberText(node as Text);
}
function observe() {
  if (watched) observer?.observe(watched, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
}
export function refreshTranslations(root: Node = document.body) {
  observer?.disconnect();
  scan(root);
  observe();
}
function syncMetadata() {
  document.querySelectorAll<HTMLMetaElement>('meta[name="description"],meta[property="og:title"],meta[property="og:description"]').forEach((meta) => {
    const source = meta.dataset.source ??= meta.content;
    meta.content = t(source);
  });
  const title = document.querySelector('title');
  if (title) scan(title);
}

let selection = 0;
export async function setLocale(code: Locale, remember = true) {
  if (!isLocale(code)) return;
  const request = ++selection;
  // The host page has every locale inline. Standalone architecture pages load one catalog.
  if (!catalogs[code] && code !== 'en') {
    try { await loadFullCatalog(code); } catch { return; }
  }
  if (request !== selection) return;
  // Capture a just-updated control in its previous locale before changing dictionaries.
  observer?.takeRecords().forEach((record) => record.type === 'childList' ? record.addedNodes.forEach(scan) : scan(record.target));
  locale = code;
  document.documentElement.lang = code === 'zh' ? 'zh-Hans' : code;
  document.documentElement.dataset.language = code;
  if (remember) {
    try { localStorage.setItem('portfolio-language', code); } catch { /* page-local preference */ }
    const url = new URL(location.href);
    url.searchParams.set('lang', code);
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  refreshTranslations();
  syncMetadata();
  document.querySelectorAll<HTMLElement>('[data-language-code]').forEach((label) => { label.textContent = code.toUpperCase(); });
  document.querySelectorAll<HTMLElement>('[data-language-option]').forEach((option) => option.setAttribute('aria-checked', String(option.dataset.languageOption === code)));
  document.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { locale: code } }));
}

function setupMenu() {
  const root = document.querySelector<HTMLElement>('[data-language-switcher]');
  const trigger = root?.querySelector<HTMLButtonElement>('[data-language-trigger]');
  const menu = root?.querySelector<HTMLElement>('[data-language-menu]');
  if (!root || !trigger || !menu) return;
  const options = [...menu.querySelectorAll<HTMLButtonElement>('[data-language-option]')];
  const close = (focus = false) => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); };
  const open = (last = false) => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (last ? options.at(-1) : options.find((option) => option.dataset.languageOption === locale))?.focus();
  };
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); open(event.key === 'ArrowUp');
  });
  menu.addEventListener('click', (event) => {
    const code = (event.target as Element).closest<HTMLElement>('[data-language-option]')?.dataset.languageOption;
    if (!isLocale(code)) return;
    void setLocale(code);
    root.querySelector<HTMLElement>('[data-language-status]')!.textContent = t('Language changed to {language}', { language: LANGUAGES.find((language) => language.code === code)!.name });
    close(true);
  });
  menu.addEventListener('keydown', (event) => {
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % options.length : event.key === 'ArrowUp' ? (index - 1 + options.length) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : undefined;
    if (next !== undefined) { event.preventDefault(); options[next].focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'Tab') close(true);
  });
  document.addEventListener('pointerdown', (event) => { if (!root.contains(event.target as Node)) close(); });
  root.addEventListener('focusout', (event) => { if (!root.contains(event.relatedTarget as Node | null)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) close(true); });
}

export function initializeLanguage() {
  const pack = document.querySelector('[data-i18n-pack]');
  if (pack?.textContent) {
    const data = JSON.parse(pack.textContent) as { sources: string[]; translations: string[][] };
    catalogs = Object.fromEntries(LOCALES.slice(1).map((code, index) => [code, Object.fromEntries(data.sources.map((source, i) => [source, data.translations[index][i] || source]))]));
  }
  watched = document.body;
  observer = new MutationObserver((records) => {
    observer!.disconnect();
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(scan);
      else scan(record.target);
    }
    observe();
  });
  let saved: string | null = null;
  try { saved = localStorage.getItem('portfolio-language'); } catch { /* storage unavailable */ }
  void setLocale(chooseLocale(new URLSearchParams(location.search).get('lang'), saved), false).catch(() => setLocale('en', false));
  setupMenu();
}
