import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { LOCALES, type Dictionary } from '../src/i18n/core.ts';

const dictionaries = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))])) as Record<string, Dictionary>;

function environment(url = 'http://localhost/?topic=Computer+Vision#work') {
  const window = new Window({ url });
  const globals = ['window', 'document', 'localStorage', 'location', 'history', 'Element', 'HTMLElement', 'Text', 'Node', 'NodeFilter', 'MutationObserver', 'CustomEvent'];
  const prior = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : (window as unknown as Record<string, unknown>)[key] });
  return { window, async restore() {
    await window.happyDOM.abort();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('all seven locales switch instantly, restore copy, preserve state and support keyboard selection', async () => {
  const env = environment();
  try {
    const sources = Object.keys(dictionaries.en);
    const pack = { sources, translations: LOCALES.slice(1).map((locale) => sources.map((source) => dictionaries[locale][source] === source ? '' : dictionaries[locale][source])) };
    document.body.innerHTML = `<h1>About</h1><a href="/work/test/">Work</a><input placeholder="Search projects"><dialog open><span data-count>Page 1 of 16</span></dialog><p data-no-translate>About</p><div data-language-switcher><button data-language-trigger aria-expanded="false">Language</button><span data-language-code data-no-translate>EN</span><div data-language-menu hidden>${LOCALES.map((code) => `<button data-language-option="${code}" tabindex="-1">${code}</button>`).join('')}</div><span data-language-status data-no-translate></span></div><script type="application/json" data-i18n-pack>${JSON.stringify(pack).replace(/</g, '\\u003c')}</script>`;
    const { initializeLanguage, setLocale, prose, dictionary } = await import('../src/i18n/client.ts');
    initializeLanguage();
    for (const locale of LOCALES) {
      await setLocale(locale); await tick();
      if (locale !== 'en') assert.deepEqual(dictionary(), dictionaries[locale], 'compact catalogs restore every translation and preserve source order');
      assert.equal(document.querySelector('h1')!.textContent, dictionaries[locale].About);
      assert.equal(document.querySelector<HTMLInputElement>('input')!.placeholder, dictionaries[locale]['Search projects']);
      assert.equal(document.querySelector('[data-no-translate]')!.textContent, 'About');
      assert.ok(document.querySelector<HTMLDialogElement>('dialog')!.open);
      assert.equal(new URLSearchParams(location.search).get('topic'), 'Computer Vision');
      assert.equal(location.hash, '#work');
      assert.equal(new URLSearchParams(location.search).get('lang'), locale);
    }
    await setLocale('zh');
    // A chat passage is composed from separately translated published paragraphs.
    const source = 'For the past 4.5 years, I’ve been a Machine Learning Research Engineer at VirtaMed in Zurich, building AI for surgical training. I take projects from model development to browser-based applications and deployment, including computer vision, generative image enhancement and AI coaching systems.';
    const next = 'Alongside my industry work, I build independent AI applications for art, real-time 2D and 3D generation, autonomous navigation and financial analysis. I’m also developing a fast browser-based AI library to make advanced models more accessible.';
    const quote = document.createElement('blockquote');
    quote.className = 'turn__quote'; quote.textContent = prose(`${source} ${next}`); document.body.append(quote);
    const link = document.createElement('a'); link.href = '/work/test/'; document.body.append(link);
    await tick();
    assert.match(link.href, /lang=zh/);
    document.querySelector('[data-count]')!.textContent = 'Page 2 of 16'; await tick();
    await setLocale('en'); await tick();
    assert.equal(quote.textContent, `${source} ${next}`, 'composite translated prose returns to the English source');
    assert.equal(document.querySelector('[data-count]')!.textContent, 'Page 2 of 16');
    const trigger = document.querySelector<HTMLButtonElement>('[data-language-trigger]')!;
    trigger.click();
    assert.equal(document.querySelector<HTMLElement>('[data-language-menu]')!.hidden, false);
    assert.equal((document.activeElement as HTMLElement).dataset.languageOption, 'en');
    document.querySelector('[data-language-menu]')!.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }) as unknown as Event);
    assert.equal((document.activeElement as HTMLElement).dataset.languageOption, 'de');
    (document.activeElement as HTMLElement).click(); await tick();
    assert.equal(document.documentElement.lang, 'de');
    assert.equal(document.activeElement, trigger);
    assert.equal(document.querySelector<HTMLElement>('[data-language-menu]')!.hidden, true);
    assert.equal(localStorage.getItem('portfolio-language'), 'de');
  } finally { await env.restore(); }
});

test('slow architecture catalog loads cannot override a more recent language choice', async () => {
  const env = environment('http://localhost/architecture/');
  const originalFetch = globalThis.fetch;
  try {
    const pending: Record<string, (response: Response) => void> = {};
    globalThis.fetch = (async (url: string | URL | Request) => new Promise<Response>((resolve) => { pending[String(url)] = resolve; })) as typeof fetch;
    // A separate document has a separate module instance, as the real iframe does.
    const moduleUrl = new URL('../src/i18n/client.ts?architecture-test', import.meta.url);
    const { initializeLanguage, setLocale } = await import(moduleUrl.href) as typeof import('../src/i18n/client.ts');
    initializeLanguage();
    const older = setLocale('zh', false);
    const newer = setLocale('ru', false);
    pending['/i18n/ru.json'](new Response(JSON.stringify(dictionaries.ru)));
    await newer;
    assert.equal(document.documentElement.lang, 'ru');
    pending['/i18n/zh.json'](new Response(JSON.stringify(dictionaries.zh)));
    await older;
    assert.equal(document.documentElement.lang, 'ru');
  } finally { globalThis.fetch = originalFetch; await env.restore(); }
});
