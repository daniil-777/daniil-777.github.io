/** Public locale codes are deliberately shared with the chat request validator. */
export const LOCALES = ['en', 'de', 'fr', 'it', 'es', 'zh', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export type Dictionary = Record<string, string>;
export type Catalog = Partial<Record<Locale, Dictionary>>;
export const LANGUAGES: { code: Locale; name: string; label: string }[] = [
  { code: 'en', name: 'English', label: 'English' },
  { code: 'de', name: 'Deutsch', label: 'German' },
  { code: 'fr', name: 'Français', label: 'French' },
  { code: 'it', name: 'Italiano', label: 'Italian' },
  { code: 'es', name: 'Español', label: 'Spanish' },
  { code: 'zh', name: '简体中文', label: 'Simplified Chinese' },
  { code: 'ru', name: 'Русский', label: 'Russian' },
];

export const normaliseSource = (text: string) => text.replace(/\s+/g, ' ').trim();
export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && LOCALES.includes(value as Locale);
export function resolveLocale(value: string | null | undefined): Locale | undefined {
  const code = value?.toLowerCase().split(/[-_]/)[0];
  return isLocale(code) ? code : undefined;
}

/** A URL choice wins over a saved choice; English is the site's original language. */
export function chooseLocale(url: string | null, saved: string | null): Locale {
  return resolveLocale(url) ?? resolveLocale(saved) ?? 'en';
}

export function interpolate(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const apostrophes = (text: string) => text.replace(/[’‘]/g, "'");
const aliases = new WeakMap<Dictionary, Dictionary>();
function aliasDictionary(dictionary: Dictionary): Dictionary {
  let lookup = aliases.get(dictionary);
  if (!lookup) {
    lookup = Object.fromEntries(Object.entries(dictionary).map(([source, value]) => [apostrophes(source), value]));
    aliases.set(dictionary, lookup);
  }
  return lookup;
}
/** Compiled once per catalog, never on each DOM mutation. */
const compiled = new WeakMap<Dictionary, { pattern: RegExp; source: string; keys: string[] }[]>();
function templates(dictionary: Dictionary) {
  let list = compiled.get(dictionary);
  if (!list) {
    list = Object.keys(dictionary).filter((key) => /\{\w+\}/.test(key)).map((source) => {
      const keys: string[] = [];
      const pattern = source.split(/(\{\w+\})/).map((part) => {
        if (!/^\{\w+\}$/.test(part)) return escape(part);
        const key = part.slice(1, -1);
        keys.push(key);
        // Media's "{currentTime} of {totalTime}" must never match prose containing "of".
        if (['count', 'current', 'total', 'loaded', 'percent', 'number', 'status', 'seekOffset', 'playbackRate'].includes(key)) return '([\\d.,]+)';
        if (['time', 'currentTime', 'totalTime'].includes(key)) return '(\\d[\\d:.,]*)';
        return '(.+?)';
      }).join('');
      return { source, keys, pattern: new RegExp(`^${pattern}$`) };
    });
    compiled.set(dictionary, list);
  }
  return list;
}

/** Exact source copy is the stable key, including strings rendered by Markdown. */
export function translate(text: string, dictionary: Dictionary = {}): string {
  const source = normaliseSource(text);
  if (!source) return text;
  let translated = dictionary[source] || aliasDictionary(dictionary)[apostrophes(source)];
  if (!translated) {
    for (const template of templates(dictionary)) {
      const match = source.match(template.pattern);
      if (!match) continue;
      translated = interpolate(dictionary[template.source], Object.fromEntries(template.keys.map((key, i) => [key, translate(match[i + 1], dictionary)])));
      break;
    }
  }
  if (!translated && source.includes(' · ')) translated = source.split(' · ').map((part) => translate(part, dictionary)).join(' · ');
  if (!translated) return text;
  return `${text.match(/^\s*/)?.[0] ?? ''}${translated}${text.match(/\s*$/)?.[0] ?? ''}`;
}

/** KB paragraphs can contain several separately authored page paragraphs or list items. */
const phrases = new WeakMap<Dictionary, string[]>();
export function translateProse(text: string, dictionary: Dictionary): string {
  const exact = translate(text, dictionary);
  if (exact !== text) return exact;
  let keys = phrases.get(dictionary);
  if (!keys) {
    keys = Object.keys(dictionary).filter((key) => key.length >= 20 && !key.includes('{')).sort((a, b) => b.length - a.length);
    phrases.set(dictionary, keys);
  }
  // Resolve published spans together, so a short label never replaces part of a longer paragraph.
  const source = normaliseSource(text);
  const comparable = apostrophes(source);
  const spans: { start: number; end: number; value: string }[] = [];
  for (const key of keys) {
    const comparableKey = apostrophes(key);
    let start = comparable.indexOf(comparableKey);
    while (start !== -1) {
      const end = start + key.length;
      if (!spans.some((span) => start < span.end && end > span.start) &&
          (start === 0 || !/\p{L}/u.test(key[0]) || !/\p{L}/u.test(source[start - 1])) &&
          (end === source.length || !/\p{L}/u.test(key.at(-1)!) || !/\p{L}/u.test(source[end]))) spans.push({ start, end, value: dictionary[key] || key });
      start = comparable.indexOf(comparableKey, end);
    }
  }
  if (!spans.length) return text;
  let result = source;
  for (const span of spans.sort((a, b) => b.start - a.start)) result = result.slice(0, span.start) + span.value + result.slice(span.end);
  return result;
}
