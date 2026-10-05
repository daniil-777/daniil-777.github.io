import type { APIRoute } from 'astro';
import { getSiteKb } from '../../lib/chat/site-kb';

/** One int8 embedding per chunk of kb.json, or the bare header if the model could not be loaded. */
export const GET: APIRoute = async () => {
  const { vectors } = await getSiteKb();
  return new Response(vectors.slice().buffer, { headers: { 'Content-Type': 'application/octet-stream' } });
};
