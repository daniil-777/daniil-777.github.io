import type { APIRoute } from 'astro';
import script from '../../scripts/architecture-language.ts?worker&url';

/** The standalone iframe and credits are public HTML, so share the normal bundled locale runtime. */
export const GET: APIRoute = () => new Response(`import ${JSON.stringify(script)};`, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
