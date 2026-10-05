/** Page chrome: navigation state, appearance toggle and scroll reveals. */

const root = document.documentElement;
// Tells the inline fallback in Base.astro that scroll reveals are being handled.
(window as Window & { __siteReady?: boolean }).__siteReady = true;

/* ------------------------------------------------------------- navigation */

const nav = document.querySelector<HTMLElement>('[data-nav]');
const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const sheet = document.querySelector<HTMLElement>('[data-nav-sheet]');

/** Everything behind the open menu, taken out of reach of Tab and screen readers meanwhile. */
const behindMenu = document.querySelectorAll<HTMLElement>('main, footer');
const menuIsOpen = () => toggle?.getAttribute('aria-expanded') === 'true';

function setMenu(open: boolean) {
  if (!nav || !toggle || !sheet) return;
  nav.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  sheet.hidden = !open;
  root.style.overflow = open ? 'hidden' : '';
  behindMenu.forEach((region) => region.toggleAttribute('inert', open));
}

toggle?.addEventListener('click', () => setMenu(!menuIsOpen()));
sheet?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('a')) {
    setMenu(false);
    toggle?.focus({ preventScroll: true });
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && menuIsOpen() && nav) {
    const controls = [...nav.querySelectorAll<HTMLElement>('a, button')].filter((el) => el.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }
  if (event.key !== 'Escape' || !menuIsOpen()) return;
  setMenu(false);
  toggle?.focus();
});
window.matchMedia('(min-width: 1100px)').addEventListener('change', () => setMenu(false));

const onScroll = () => nav?.classList.toggle('is-scrolled', window.scrollY > 4);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

/*
 * Highlight the nav link of the section currently on screen (home page only).
 * Watch the five top-level destinations; all project sections share Work.
 */
const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-nav-link]')];
const sections = [...document.querySelectorAll<HTMLElement>('main > [id]')];

if (sections.length) {
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of navLinks) {
          link.classList.toggle('is-active', new URL(link.href).hash === `#${entry.target.id}`);
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  sections.forEach((section) => spy.observe(section));
}

/* -------------------------------------------------------------- appearance */

const themeColor = { light: '#ffffff', dark: '#000000' };

function currentTheme(): 'light' | 'dark' {
  const forced = root.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = themeColor[next];
  });
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* private mode: the choice simply lasts for this page */
  }
});

/* ------------------------------------------------------------------ reveal */

const revealed = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      revealed.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
);
document.querySelectorAll('.reveal').forEach((el) => revealed.observe(el));
