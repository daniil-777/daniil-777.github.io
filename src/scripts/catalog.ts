/**
 * The catalog on the home page: filtering, live counts, the address bar,
 * the grid/list choice and the topic list on phones. The matching itself
 * lives in src/lib/filter.ts, where it is unit-tested.
 */
import {
  categoryCounts,
  filterItems,
  fromQuery,
  isActive,
  toQuery,
  topicCounts,
  type FilterItem,
  type FilterState,
} from '../lib/filter';
import { LANGUAGE_EVENT, t } from '../i18n/client';

const form = document.querySelector<HTMLFormElement>('[data-filters]');
const grid = document.querySelector<HTMLElement>('[data-grid]');

if (form && grid) {
  const cards = [...grid.querySelectorAll<HTMLElement>('[data-card]')];
  const items: FilterItem[] = cards.map((card) => ({
    id: card.dataset.id!,
    category: card.dataset.category!,
    topics: JSON.parse(card.dataset.topics!) as string[],
    text: card.dataset.text!,
    hasVideo: card.dataset.hasVideo === '1',
  }));

  const catInputs = [...form.querySelectorAll<HTMLInputElement>('input[name="cat"]')];
  const topicInputs = [...form.querySelectorAll<HTMLInputElement>('input[name="topic"]')];
  const videoInput = form.querySelector<HTMLInputElement>('input[name="video"]')!;
  const searchInput = form.querySelector<HTMLInputElement>('input[name="q"]')!;
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  const clear = form.querySelector<HTMLElement>('[data-clear]')!;
  const empty = document.querySelector<HTMLElement>('[data-empty]')!;

  const categories = catInputs.map((input) => input.value).filter((value) => value !== 'all');
  const topics = topicInputs.map((input) => input.value);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const read = (): FilterState => ({
    category: catInputs.find((input) => input.checked)?.value ?? 'all',
    topics: topicInputs.filter((input) => input.checked).map((input) => input.value),
    query: searchInput.value,
    videoOnly: videoInput.checked,
  });

  const write = (state: FilterState) => {
    catInputs.forEach((input) => (input.checked = input.value === state.category));
    topicInputs.forEach((input) => (input.checked = state.topics.includes(input.value)));
    searchInput.value = state.query;
    videoInput.checked = state.videoOnly;
  };

  function render(state: FilterState) {
    const shown = new Set(filterItems(items, state).map((item) => item.id));
    for (const card of cards) card.hidden = !shown.has(card.dataset.id!);

    const perTopic = topicCounts(items, state, topics);
    for (const input of topicInputs) {
      const n = perTopic[input.value];
      form!.querySelector(`[data-topic-count="${CSS.escape(input.value)}"]`)!.textContent = String(n);
      // A topic that would empty the list is dimmed, unless it is already on.
      input.disabled = n === 0 && !input.checked;
    }
    const perCategory = categoryCounts(items, state, categories);
    for (const input of catInputs) {
      form!.querySelector(`[data-cat-count="${input.value}"]`)!.textContent = String(perCategory[input.value]);
    }

    const active = isActive(state);
    status.textContent = active ? t('{count} of {total} projects', { count: shown.size, total: items.length }) : t('Showing all {count} projects', { count: items.length });
    clear.hidden = !active;
    empty.hidden = shown.size > 0;
  }

  /** Runs a change to the grid, letting the cards glide to their new places where supported. */
  function transition(change: () => void, animate: boolean) {
    if (animate && !reducedMotion && 'startViewTransition' in document) document.startViewTransition(change);
    else change();
  }

  /** Mirrors the filters in the address bar, leaving any other query parameters alone. */
  function syncUrl(state: FilterState) {
    const params = new URLSearchParams(location.search);
    for (const key of ['cat', 'topic', 'q', 'video']) params.delete(key);
    for (const [key, value] of new URLSearchParams(toQuery(state))) params.append(key, value);
    const query = params.toString();
    const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', url);
  }

  function apply(state: FilterState, animate: boolean) {
    transition(() => render(state), animate);
    syncUrl(state);
  }

  /* Grid or list. The choice is remembered on this device. */
  type View = 'grid' | 'list';
  const VIEW_KEY = 'catalog-view';
  const viewButtons = [...form.querySelectorAll<HTMLButtonElement>('[data-view-btn]')];

  const images = [...grid.querySelectorAll<HTMLImageElement>('.card__media img')];
  const gridSizes = new Map(images.map((image) => [image, image.sizes]));
  // Matches the breakpoint in ProjectCard.astro below which the list shows small thumbnails.
  const phone = window.matchMedia('(max-width: 760px)');
  /** Tells the browser how wide the card images really are, so a list thumbnail is not fetched at grid size. */
  const syncSizes = (view = grid.dataset.view) => {
    const small = view === 'list' && phone.matches;
    for (const image of images) image.sizes = small ? '112px' : gridSizes.get(image)!;
  };
  phone.addEventListener('change', () => syncSizes());

  function setView(view: View, animate: boolean) {
    syncSizes(view);
    transition(() => {
      grid!.dataset.view = view;
      for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.viewBtn === view));
    }, animate);
  }

  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      const view = button.dataset.viewBtn as View;
      setView(view, true);
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch {
        /* private mode: the choice lasts for this visit */
      }
    });
  }

  // A saved choice wins. Without one, a phone starts on the compact list: the grid is a very long scroll there.
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(VIEW_KEY);
  } catch {
    /* storage unavailable: fall through to the default */
  }
  if (saved === 'list' || (saved === null && window.matchMedia('(max-width: 600px)').matches)) setView('list', false);

  let typing: number | undefined;
  form.addEventListener('input', (event) => {
    window.clearTimeout(typing);
    // Typing settles for a moment before the grid moves; clicks apply at once.
    const delay = event.target === searchInput ? 140 : 0;
    typing = window.setTimeout(() => apply(read(), true), delay);
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('reset', () =>
    // The controls only hold their reset values after this event has finished.
    window.setTimeout(() => {
      apply(read(), true);
      // Both "Clear filters" buttons hide themselves; keep keyboard focus in the catalog.
      status.focus({ preventScroll: true });
    }),
  );
  document.querySelector('[data-reset]')?.addEventListener('click', () => form.reset());

  /* Only the most common topics show until "More topics" is pressed (the CSS decides how many). */
  const topicBox = form.querySelector<HTMLElement>('[data-topics]')!;
  const topicToggle = form.querySelector<HTMLButtonElement>('[data-topics-toggle]')!;
  const expandTopics = (open: boolean) => {
    topicBox.toggleAttribute('data-expanded', open);
    topicToggle.setAttribute('aria-expanded', String(open));
    topicToggle.textContent = t(open ? 'Fewer topics' : 'More topics');
  };
  topicToggle.addEventListener('click', () => expandTopics(!topicBox.hasAttribute('data-expanded')));

  const initial = fromQuery(location.search, { categories, topics });
  write(initial);
  apply(initial, false);
  document.addEventListener(LANGUAGE_EVENT, () => {
    items.forEach((item, index) => { item.text = `${cards[index].dataset.text} ${cards[index].textContent} ${item.topics.map((topic) => t(topic)).join(' ')}`; });
    render(read());
    expandTopics(topicBox.hasAttribute('data-expanded'));
  });
}
