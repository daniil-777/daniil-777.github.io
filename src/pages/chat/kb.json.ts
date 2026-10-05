import type { APIRoute } from 'astro';
import { getSiteKb } from '../../lib/chat/site-kb';

/** The assistant's knowledge base: every public chunk of the site. */
export const GET: APIRoute = async () => {
  const { kb } = await getSiteKb();
  return new Response(JSON.stringify(kb), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
