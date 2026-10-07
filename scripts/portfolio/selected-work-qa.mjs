/** Real-browser checks for selected projects, cover-only cards and saved layouts. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowser } from '../watch-language/browser-helper.mjs';

const base = process.env.SELECTED_QA_URL ?? 'http://127.0.0.1:4373/';
const baseline = process.env.SELECTED_QA_BASELINE;
const output = process.env.SELECTED_QA_OUTPUT ?? '/tmp/selected-universal-browser';
await mkdir(output, { recursive: true });
const expected = ['ai-proctor', 'astro-pilot', 'pixel-morph', 'laparoscopic-skills-trainer', 'universal-ai-proctor'];
const checks = [];
const browser = await startBrowser('about:blank', { width: 1440, height: 1000 });
const page = (fn, arg) => browser.evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, arg) {
  for (let i = 0; i < 150; i++) {
    if (await page(fn, arg)) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function navigate(url) {
  const old = await page(() => performance.timeOrigin);
  await browser.send('Page.navigate', { url });
  await waitFor(({ old, target }) => performance.timeOrigin !== old && location.href === target && window.__siteReady && document.querySelector('[data-featured-items]'), 'site ready', { old, target: new URL(url).href });
  await page(() => document.fonts.ready.then(() => true));
}
async function resetLayout() {
  const old = await page(() => { localStorage.removeItem('featured-view'); return performance.timeOrigin; });
  await browser.send('Page.reload');
  await waitFor(old => performance.timeOrigin !== old && window.__siteReady && document.querySelector('[data-featured-items]')?.dataset.view === 'list', 'default list', old);
  await page(() => document.fonts.ready.then(() => true));
}
async function measure() {
  return page(() => {
    const wrap = document.querySelector('[data-featured-items]');
    return {
      view: wrap.dataset.view,
      overflow: document.documentElement.scrollWidth > innerWidth,
      rows: [...wrap.querySelectorAll('article')].map(tile => {
        const link = tile.querySelector('h3 a'), image = tile.querySelector('.tile__media img');
        const box = tile.getBoundingClientRect(), media = image?.getBoundingClientRect();
        return { id: link.getAttribute('href').split('/')[2], title: link.textContent.trim(), width: box.width, height: box.height,
          image: !!image && image.complete && image.naturalWidth > 0,
          imageWidth: media?.width, imageHeight: media?.height,
          preview: !!tile.querySelector('[data-preview]'), watch: !!tile.querySelector('[data-video-open]') };
      }),
      errors: window.__selectedErrors,
    };
  });
}
async function screenshot(name) {
  const result = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(output, name), Buffer.from(result.data, 'base64'));
}
try {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__selectedErrors=[];
    addEventListener('error',e=>window.__selectedErrors.push(e.message));
    addEventListener('unhandledrejection',e=>window.__selectedErrors.push(String(e.reason)));
    addEventListener('securitypolicyviolation',e=>window.__selectedErrors.push('CSP: '+e.blockedURI));` });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const width of [320, 390, 768, 1440]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    let before;
    if (baseline) {
      await navigate(baseline);
      await resetLayout();
      await page(() => { for (const image of document.querySelectorAll('#featured img')) image.loading = 'eager'; });
      await waitFor(() => [...document.querySelectorAll('#featured img')].every(img => img.complete && img.naturalWidth), 'baseline images');
      before = await measure();
    }
    await navigate(base);
    await resetLayout();
    await page(() => { for (const image of document.querySelectorAll('#featured img')) image.loading = 'eager'; });
    await waitFor(() => [...document.querySelectorAll('#featured img')].every(img => img.complete && img.naturalWidth), 'selected images');
    const list = await measure();
    assert.equal(list.view, 'list');
    assert.deepEqual(list.rows.map(row => row.id), expected);
    assert.ok(list.rows.every(row => row.image && row.imageWidth > 0 && row.imageHeight > 0));
    assert.equal(list.overflow, false);
    assert.deepEqual(list.errors, []);
    assert.equal(list.rows[4].preview, false);
    assert.equal(list.rows[4].watch, false);
    assert.equal(list.rows[4].title, 'Cuevertis');
    if (before) for (let i = 0; i < 4; i++) {
      assert.equal(list.rows[i].id, before.rows[i].id);
      assert.ok(Math.abs(list.rows[i].height - before.rows[i].height) < 2, 'existing card height changed');
      assert.ok(Math.abs(list.rows[i].imageWidth - before.rows[i].imageWidth) < 2, 'existing thumbnail changed');
    }
    await page(() => document.querySelector('#featured article:last-child').scrollIntoView({ block: 'center' }));
    await waitFor(() => parseFloat(getComputedStyle(document.querySelector('#featured article:last-child')).opacity) >= 0.99, 'visible list card');
    await screenshot(`selected-list-${width}.png`);
    await page(() => document.querySelector('[data-featured-view-btn="grid"]').focus());
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(() => document.querySelector('[data-featured-items]').dataset.view === 'grid', 'keyboard grid');
    await waitFor(() => [...document.querySelectorAll('#featured img')].every(img => img.complete && img.naturalWidth), 'grid image sources');
    const grid = await measure();
    assert.equal(grid.overflow, false);
    assert.ok(grid.rows.every(row => row.image && row.imageWidth > 0));
    assert.equal(await page(() => document.querySelector('[data-featured-view-btn="grid"]').getAttribute('aria-pressed')), 'true');
    await page(() => document.querySelector('#featured article:last-child').scrollIntoView({ block: 'center' }));
    await waitFor(() => parseFloat(getComputedStyle(document.querySelector('#featured article:last-child')).opacity) >= 0.99, 'visible grid card');
    await screenshot(`selected-grid-${width}.png`);
    await navigate(base);
    assert.equal((await measure()).view, 'grid', 'saved preference');
    const links = await page(() => {
      const tile = document.querySelector('#featured article:last-child');
      return { project: tile.querySelector('h3 a').getAttribute('href'), actions: [...tile.querySelectorAll('.act')].map(a => a.getAttribute('href')) };
    });
    assert.equal(new URL(links.project, base).pathname, '/work/universal-ai-proctor/');
    assert.ok(links.actions.includes('https://cueveris.demtsev.com/'));
    assert.ok(links.actions.includes('https://github.com/daniil-777/universal-ai-proctor'));
    await page(() => document.querySelector('#featured article:last-child h3 a').click());
    await waitFor(() => location.pathname === '/work/universal-ai-proctor/' && document.querySelector('h1')?.textContent.includes('Cuevertis'), 'project navigation');
    const description = await page(() => document.querySelector('main').innerText);
    assert.match(description, /local Qwen vision-language models/);
    assert.match(description, /Google EmbeddingGemma models power semantic search/);
    assert.match(description, /BM25 keyword search/);
    assert.deepEqual(await page(() => window.__selectedErrors), []);
    checks.push({ width, list, grid, links, savedPreference: true, keyboardToggle: true, projectNavigation: true,
      baselineGeometry: before ? 'first four cards unchanged within 2px' : 'not compared' });
  }
  const translations = [];
  for (const locale of ['de', 'fr', 'it', 'es', 'zh', 'ru']) {
    await page(locale => document.querySelector(`[data-language-option="${locale}"]`).click(), locale);
    await waitFor(locale => document.documentElement.dataset.language === locale, 'language update', locale);
    const translated = await page(() => ({ title: document.querySelector('h1').textContent.trim(), text: document.querySelector('main').innerText,
      overflow: document.documentElement.scrollWidth > innerWidth, errors: window.__selectedErrors }));
    assert.equal(translated.title, 'Cuevertis');
    assert.ok(translated.text.includes('Google EmbeddingGemma') && translated.text.includes('Qwen'));
    assert.ok(!translated.text.includes('The report assistant uses local Qwen vision-language models'));
    assert.equal(translated.overflow, false);
    assert.deepEqual(translated.errors, []);
    translations.push(locale);
  }
  await writeFile(join(output, 'report.json'), JSON.stringify({ base, baseline: baseline ?? null, checks, passed: true,
    translations,
    scope: 'Responsive selected-work rendering, links, keyboard layout toggle, preference and page navigation. Baseline comparison covers existing list geometry; screenshots require visual review.' }, null, 2));
  console.log(JSON.stringify({ passed: true, widths: checks.map(check => check.width), output }));
} finally {
  await browser.close();
}
