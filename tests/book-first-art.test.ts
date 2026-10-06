import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { createBookPages } from '../src/lib/book/pages.ts';

test('cancelled initial artwork retries when the book becomes visible again', async () => {
  const originalFetch = globalThis.fetch;
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement,
    getComputedStyle: win.getComputedStyle.bind(win) });
  const metadata = readFileSync(resolve('public/book/contour/contour-decoder.json'),'utf8');
  const bytes = readFileSync(resolve('public/book/contour/contour-decoder.bin'));
  const binary = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  let release!: () => void;
  const waiting = new Promise<void>(done => { release = done; });
  let fetches = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    fetches++; await waiting;
    return String(url).endsWith('.json') ? new Response(metadata) : new Response(binary.slice(0));
  }) as typeof fetch;
  win.document.body.innerHTML = `<article data-book><div class="ai-book__spread">
    <div class="ai-book__page--left"><svg data-book-artwork><path data-book-contour></path><path data-book-contour-accent></path></svg></div>
    <div class="ai-book__page--right"><p data-book-output>Keep this thought.</p></div>
  </div></article>`;
  const root = win.document.querySelector('[data-book]')! as unknown as HTMLElement;
  const pages = createBookPages(root, { thought: { text: 'Keep this thought.', reviewed: true, sources: [] }, mode: 'wellbeing', origin: 'Reviewed thought', seed: 20261006 },
    { motion: () => false, visible: () => true, start() {}, commit() {}, settled() {} });
  try {
    pages.cancel();
    release();
    await new Promise(done => setTimeout(done, 15));
    assert.equal(root.querySelector('[data-book-contour]')!.getAttribute('d'), null);
    pages.syncArt(true);
    for (let i = 0; i < 40 && !root.querySelector('[data-book-contour]')!.getAttribute('d'); i++) await new Promise(done => setTimeout(done,5));
    assert.ok(root.querySelector('[data-book-contour]')!.getAttribute('d')?.startsWith('M'), 'initial contour recovered after cancellation');
    assert.equal(fetches, 2, 'shared model asset cache avoids additional downloads');
  } finally { pages.unmount(); globalThis.fetch = originalFetch; await win.happyDOM.close(); }
});
