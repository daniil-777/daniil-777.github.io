/** Browser checks for the featured video, diploma actions, and Email copy feedback. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowser } from '../watch-language/browser-helper.mjs';

const url = process.env.PORTFOLIO_QA_URL ?? 'http://127.0.0.1:4391/';
const output = process.env.PORTFOLIO_QA_OUTPUT ?? '/tmp/portfolio-actions-qa';
await mkdir(output, { recursive: true });
const browser = await startBrowser(url, { width: 1440, height: 1000 });
const page = (fn, argument) => browser.evaluate('(' + fn.toString() + ')(' + JSON.stringify(argument) + ')');
const screenshot = async () => Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
function check(name, condition) { assert.ok(condition, name); checks.push(name); }
async function waitFor(fn, name, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page(fn)) return;
    await sleep(100);
  }
  throw new Error('Timed out: ' + name);
}
async function click(selector, touch = false) {
  await page(selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  await sleep(300);
  const point = await page(selector => {
    const element = document.querySelector(selector);
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, selector);
  if (touch) {
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1 }] });
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
}
try {
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await browser.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await waitFor(() => window.__siteReady && document.querySelector('[data-email-copy]'), 'site ready');
  const featured = await page(() => {
    const tile = document.querySelector('#featured a[href^="/work/laparoscopic-skills-trainer/"]').closest('article');
    return { preview: tile.querySelector('[data-preview]').dataset.preview, poster: tile.querySelector('img').src, payload: JSON.parse(tile.querySelector('[data-video]').dataset.video) };
  });
  check('Selected Work uses the Stratafix preview and poster', featured.preview === '/media/preview/lap-stratafix.mp4' && featured.poster.includes('lap-stratafix'));
  check('Watch opens Stratafix at its guidance segment', featured.payload.id === 'lap-stratafix' && featured.payload.startAt === 111);
  await click('#featured article:has(a[href^="/work/laparoscopic-skills-trainer/"]) [data-video-open]');
  await waitFor(() => document.querySelector('[data-video-dialog]').open && document.querySelector('[data-video-stage] mux-player, [data-video-stage] video')?.currentTime >= 110.5, 'Stratafix playback');
  await waitFor(() => {
    const video = document.querySelector('[data-video-stage] mux-player, [data-video-stage] video');
    return video.currentTime > 111.25 && video.readyState >= 2 && !video.paused;
  }, 'Stratafix time advances');
  check('Stratafix video plays from 1:51', await page(() => {
    const video = document.querySelector('[data-video-stage] mux-player, [data-video-stage] video');
    video.pause();
    return video.currentTime < 116 && (video.currentSrc || video.getAttribute('src')).includes('lap-stratafix');
  }));
  await page(() => document.querySelector('[data-video-dialog]').close());

  await click('[data-doc="eth-masters-diploma"]');
  await waitFor(() => document.querySelector('[data-doc-dialog]').open && document.querySelector('[data-doc-pages] img')?.naturalWidth > 0, 'diploma preview');
  const diploma = await page(() => ({
    title: document.querySelector('[data-doc-title]').textContent,
    pages: document.querySelector('[data-doc-pages]').children.length,
    pdf: document.querySelector('[data-doc-pdf]').getAttribute('href'),
    download: document.querySelector('.entry__documents a[download]')?.getAttribute('href'),
  }));
  check('Diploma preview shows the single ETH certificate', diploma.pages === 1 && diploma.title.includes('ETH Zurich'));
  check('Preview and download use the same certificate PDF', diploma.pdf === '/papers/eth-masters-diploma.pdf' && diploma.download === diploma.pdf);
  const pdf = await fetch(new URL(diploma.pdf, url));
  check('Certificate PDF is served successfully', pdf.ok && Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString() === '%PDF-');
  await sleep(750);
  await writeFile(join(output, 'diploma-desktop.png'), await screenshot());
  await page(() => document.querySelector('[data-doc-dialog]').close());

  await click('[data-email-copy]');
  await waitFor(() => document.querySelector('[data-email-message]').textContent === 'Copied', 'email copy');
  check('Email button copies the exact address', await page(async () => await navigator.clipboard.readText() === 'daniil.emtsev.ig@gmail.com'));
  check('Email displays its address and success checkmark', await page(() => {
    const bar = document.querySelector('[data-email-feedback]');
    return bar.dataset.open === 'true' && bar.textContent.includes('daniil.emtsev.ig@gmail.com') && !bar.querySelector('[data-email-check]').hidden;
  }));
  check('Email reveal uses a slower transition', await page(() => getComputedStyle(document.querySelector('[data-email-feedback]')).transitionDuration.split(',').some(value => parseFloat(value) >= 0.5)));
  await sleep(750);
  await writeFile(join(output, 'email-desktop.png'), await screenshot());
  await waitFor(() => document.querySelector('[data-email-feedback]').dataset.open === 'false', 'automatic email dismissal', 7000);
  await sleep(750);
  check('Email confirmation fades and collapses', await page(() => {
    const bar = document.querySelector('[data-email-feedback]');
    return parseFloat(getComputedStyle(bar).opacity) === 0 && bar.getBoundingClientRect().height < 1;
  }));
  await page(() => document.querySelector('[data-email-copy]').focus());
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(() => document.querySelector('[data-email-feedback]').dataset.open === 'true', 'keyboard email');
  check('Email supports keyboard activation', true);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check('Escape dismisses the email bar', await page(() => document.querySelector('[data-email-copy]').getAttribute('aria-expanded') === 'false'));

  await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await click('[data-email-copy]', true);
  await waitFor(() => document.querySelector('[data-email-message]').textContent === 'Copied', 'touch email');
  await sleep(750);
  check('Email bar fits a narrow mobile screen', await page(() => {
    const bar = document.querySelector('.email-copy__bar').getBoundingClientRect();
    return bar.left >= 0 && bar.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  }));
  await writeFile(join(output, 'email-mobile.png'), await screenshot());
  await click('[data-doc="eth-masters-diploma"]', true);
  await waitFor(() => document.querySelector('[data-doc-dialog]').open && document.querySelector('[data-doc-pages] img')?.naturalWidth > 0, 'touch diploma');
  check('Diploma supports touch and has 44px actions', await page(() => [...document.querySelectorAll('.entry__document')].every(button => button.getBoundingClientRect().height >= 44)));
  await sleep(750);
  await writeFile(join(output, 'diploma-mobile.png'), await screenshot());
  await page(() => document.querySelector('[data-doc-dialog]').close());
  await page(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('denied'); } }));
  await click('[data-email-copy]', true);
  await waitFor(() => document.querySelector('[data-email-message]').textContent === 'Select the address to copy', 'clipboard failure');
  check('Clipboard failure keeps a selectable address without a false success', await page(() => document.querySelector('[data-email-check]').hidden && document.querySelector('[data-email-feedback]').dataset.open === 'true'));
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  check('Email respects reduced motion', await page(() => getComputedStyle(document.querySelector('[data-email-feedback]')).transitionDuration.split(',').every(value => parseFloat(value) <= 0.001)));
  await writeFile(join(output, 'report.json'), JSON.stringify({ url, checks }, null, 2) + '\n');
  console.log('Portfolio browser QA passed: ' + checks.length + ' checks. Screenshots: ' + output);
} catch (error) {
  await writeFile(join(output, 'failure.png'), await screenshot());
  console.error(await page(() => ({
    href: location.href,
    videoDialog: document.querySelector('[data-video-dialog]')?.open,
    video: document.querySelector('[data-video-stage] mux-player, [data-video-stage] video') && {
      time: document.querySelector('[data-video-stage] mux-player, [data-video-stage] video').currentTime,
      source: document.querySelector('[data-video-stage] mux-player, [data-video-stage] video').getAttribute('src'),
      readyState: document.querySelector('[data-video-stage] mux-player, [data-video-stage] video').readyState,
      error: document.querySelector('[data-video-stage] mux-player, [data-video-stage] video').error?.message,
    },
    email: document.querySelector('[data-email-feedback]')?.dataset.open,
  })));
  throw error;
} finally { await browser.close(); }
