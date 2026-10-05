/**
 * Catalog filtering. Pure functions, shared by the browser script in
 * Catalog.astro and by the tests, so the logic can be verified without a DOM.
 */

export interface FilterItem {
  id: string;
  category: string;
  topics: string[];
  /** Everything searchable about the project, in any case. */
  text: string;
  hasVideo: boolean;
}

export interface FilterState {
  /** A category id, or `all`. */
  category: string;
  /** A project must carry every selected topic. */
  topics: string[];
  query: string;
  videoOnly: boolean;
}

export const EMPTY_STATE: FilterState = { category: 'all', topics: [], query: '', videoOnly: false };

/** Lower-cases and strips accents, so "zurich" finds "Zürich". */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function words(query: string): string[] {
  return normalise(query).split(/\s+/).filter(Boolean);
}

function matches(item: FilterItem, state: FilterState, haystack: string): boolean {
  if (state.category !== 'all' && item.category !== state.category) return false;
  if (state.videoOnly && !item.hasVideo) return false;
  if (!state.topics.every((t) => item.topics.includes(t))) return false;
  return words(state.query).every((w) => haystack.includes(w));
}

export function filterItems<T extends FilterItem>(items: T[], state: FilterState): T[] {
  return items.filter((item) => matches(item, state, normalise(`${item.text} ${item.topics.join(' ')}`)));
}

/**
 * For each topic, how many projects would remain if it were selected on top
 * of the current state. A topic that is already selected reports the current
 * result count.
 */
export function topicCounts(items: FilterItem[], state: FilterState, topics: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const topic of topics) {
    const selected = state.topics.includes(topic) ? state.topics : [...state.topics, topic];
    counts[topic] = filterItems(items, { ...state, topics: selected }).length;
  }
  return counts;
}

/** Results per category (and under `all`) with every other constraint applied. */
export function categoryCounts(items: FilterItem[], state: FilterState, categories: readonly string[]): Record<string, number> {
  const rest = filterItems(items, { ...state, category: 'all' });
  const counts: Record<string, number> = { all: rest.length };
  for (const category of categories) counts[category] = rest.filter((i) => i.category === category).length;
  return counts;
}

export function isActive(state: FilterState): boolean {
  return state.category !== 'all' || state.topics.length > 0 || state.videoOnly || state.query.trim() !== '';
}

/** Serialises to a query string without the leading `?`. Empty when nothing is selected. */
export function toQuery(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.category !== 'all') params.set('cat', state.category);
  for (const topic of state.topics) params.append('topic', topic);
  if (state.query.trim()) params.set('q', state.query.trim());
  if (state.videoOnly) params.set('video', '1');
  return params.toString();
}

export function fromQuery(search: string, valid: { categories: readonly string[]; topics: readonly string[] }): FilterState {
  const params = new URLSearchParams(search);
  const category = params.get('cat') ?? 'all';
  return {
    category: valid.categories.includes(category) ? category : 'all',
    topics: params.getAll('topic').filter((t) => valid.topics.includes(t)),
    query: params.get('q') ?? '',
    videoOnly: params.get('video') === '1',
  };
}
