import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPreview } from '../src/lib/architecture/preview.ts';

/** Exercise the controller against browsing-context boundaries, without a GPU. */
test('activation, controls, focus, removal during loading, stale messages and reopening', () => {
  const requests: unknown[] = [];
  const messages: any[] = [];
  let observerCallback: (entries: { isIntersecting: boolean }[]) => void = () => {};
  class Element extends EventTarget {
    hidden = true; textContent = ''; src = ''; title = ''; focused = false;
    owner: Element | null = null; children: Element[] = [];
    attributes = new Map<string, string>();
    contentWindow = { postMessage: (message: any) => messages.push(message) };
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    getBoundingClientRect() { return { top: 100, bottom: 600 }; }
    focus() { this.focused = true; document.activeElement = this; }
    append(child: Element) { this.children.push(child); child.owner = this; requests.push(child.src); }
    remove() { if (this.owner) this.owner.children = this.owner.children.filter((child) => child !== this); }
  }
  const play = new Element(), remove = new Element(), panel = new Element(), status = new Element();
  const toggle = new Element(), next = new Element();
  const elements: Record<string, Element> = { '[data-play]': play, '[data-remove]': remove, '[data-toggle]': toggle, '[data-next]': next, '[data-preview]': panel, '[data-status]': status };
  const root = Object.assign(new Element(), { querySelector: (selector: string) => elements[selector], contains: (element: Element) => Object.values(elements).includes(element) || panel.children.includes(element) });
  const host = new EventTarget();
  const document = Object.assign(new EventTarget(), { activeElement: new Element(), hidden: false, documentElement: { dataset: { theme: 'light' } }, createElement: () => new Element() });
  const media = Object.assign(new EventTarget(), { matches: false });
  const overrides = { window: host, document, location: { origin: 'https://portfolio.test' }, innerHeight: 900,
    matchMedia: () => media,
    IntersectionObserver: class { constructor(callback: typeof observerCallback) { observerCallback = callback; } observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} } };
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const emit = (frame: Element, session: string, type: string, origin = 'https://portfolio.test') => {
    const event = Object.assign(new Event('message'), { source: frame.contentWindow, origin, data: { channel: 'portfolio-architecture', session, type } });
    host.dispatchEvent(event);
  };
  try {
    const controller = setupPreview(root as unknown as HTMLElement);
    assert.equal(requests.length, 0, 'no iframe/model fetch before activation');
    controller.start(); const first = panel.children[0];
    const firstSession = new URL(first.src, 'https://portfolio.test').searchParams.get('session')!;
    assert.equal(requests.length, 1); assert.equal(panel.hidden, false);
    assert.equal(document.activeElement, remove, 'manual Play moves focus to a visible control');
    controller.start(); assert.equal(requests.length, 1, 'repeated Play does not duplicate the context');
    remove.dispatchEvent(new Event('click')); assert.equal(panel.children.length, 0); assert.equal(panel.hidden, true);
    emit(first, firstSession, 'ready'); assert.equal(status.textContent, 'Preview removed.');
    controller.start(); const second = panel.children[0];
    const secondSession = new URL(second.src, 'https://portfolio.test').searchParams.get('session')!;
    assert.notEqual(firstSession, secondSession);
    emit(first, firstSession, 'error'); assert.equal(panel.children.length, 1);
    emit(second, secondSession, 'error', 'https://foreign.test'); assert.equal(panel.children.length, 1);
    emit(second, firstSession, 'error'); assert.equal(panel.children.length, 1);
    observerCallback([{ isIntersecting: false }]); assert.equal(messages.at(-1).active, false);
    observerCallback([{ isIntersecting: true }]); assert.equal(messages.at(-1).active, true);
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(messages.at(-1).active, false);
    emit(second, secondSession, 'ready'); assert.equal(status.hidden, true); assert.equal(toggle.hidden, false);
    toggle.dispatchEvent(new Event('click')); assert.equal(messages.at(-1).type, 'toggle');
    next.dispatchEvent(new Event('click')); assert.equal(messages.at(-1).type, 'next');
    remove.dispatchEvent(new Event('click')); assert.equal(panel.children.length, 0); assert.equal(play.focused, true);
    const elsewhere = new Element(); elsewhere.focus();
    controller.start(false); const third = panel.children[0];
    const thirdSession = new URL(third.src, 'https://portfolio.test').searchParams.get('session')!;
    assert.equal(document.activeElement, elsewhere, 'automatic activation preserves focus');
    emit(third, thirdSession, 'error');
    assert.equal(panel.children.length, 0);
    assert.equal(document.activeElement, elsewhere, 'automatic failure does not steal focus');
    controller.start(); const fourth = panel.children[0];
    emit(fourth, new URL(fourth.src, 'https://portfolio.test').searchParams.get('session')!, 'error');
    assert.equal(document.activeElement, play, 'a focused loading control returns to Play after failure');
  } finally {
    host.dispatchEvent(new Event('pagehide'));
    for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
