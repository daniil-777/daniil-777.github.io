import type { APIRoute } from 'astro';
import { LOCALES } from '../../i18n/core';
import { dictionaries } from '../../i18n/server';

export function getStaticPaths() {
  return LOCALES.filter((locale) => locale !== 'en').map((locale) => ({ params: { locale } }));
}
export const GET: APIRoute = ({ params }) => new Response(JSON.stringify(dictionaries[params.locale!]), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
