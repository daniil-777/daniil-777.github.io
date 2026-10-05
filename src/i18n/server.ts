import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import es from './locales/es.json';
import zh from './locales/zh.json';
import ru from './locales/ru.json';
import shared from './shared.json';
import { LOCALES, normaliseSource, type Dictionary } from './core';

export const dictionaries: Record<string, Dictionary> = { en, de, fr, it, es, zh, ru };
const sharedKeys = new Set(shared);
const decodeHtml = (html: string) => html.replace(/&#(x[\da-f]+|\d+);/gi, (_, value: string) => String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** All six languages for this page are inline: changing language requires no network request. */
export function pageCatalog(html: string): { sources: string[]; translations: string[][] } {
  const content = normaliseSource(decodeHtml(html));
  const keys = Object.keys(en).filter((key) => sharedKeys.has(key) || content.includes(key));
  return { sources: keys, translations: LOCALES.filter((locale) => locale !== 'en').map((locale) => keys.map((key) => dictionaries[locale][key] || key)) };
}
