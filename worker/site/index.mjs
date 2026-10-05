import { secureHeaders, privatePath } from './security.mjs';
const ORIGIN = 'https://daniil-777.github.io';
const PUBLIC_HOST = 'demtsev.com';
const FORWARD_HEADERS = ['accept', 'accept-encoding', 'range', 'if-range', 'if-none-match', 'if-modified-since'];

// One release state per isolate; a positive KV receipt survives future origin updates.
let handoff;
async function originReady(env) {
  const release = env.FALLBACK_RELEASE;
  if (!release || !env.ORIGIN_STATE) return false;
  if (!handoff || handoff.release !== release) handoff = { release, ready: false, nextProbe: 0, pending: undefined };
  const state = handoff;
  if (state.ready) return true;
  if (state.pending) return state.pending;
  if (Date.now() < state.nextProbe) return false;
  state.nextProbe = Date.now() + 60_000;
  state.pending = (async () => {
    try {
      const key = `origin-ready:${release}`;
      if (await env.ORIGIN_STATE.get(key) === 'true') return state.ready = true;
      const probe = await fetch(`${ORIGIN}/watch/release.json`, {
        method: 'GET', redirect: 'manual', headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(3000),
      });
      if (!probe.ok || (await probe.json())?.release !== release) return false;
      await env.ORIGIN_STATE.put(key, 'true');
      return state.ready = true;
    } catch { return false; }
  })();
  try { return await state.pending; }
  finally { state.pending = undefined; }
}

function publicResponse(response, pathname) {
  const outgoing = secureHeaders(response.headers, pathname);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
}

export default {
  /** @param {Request} request */
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (![PUBLIC_HOST, `www.${PUBLIC_HOST}`].includes(url.hostname)) return publicResponse(new Response('Not found', { status: 404 }), url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== PUBLIC_HOST) {
      url.protocol = 'https:';
      url.hostname = PUBLIC_HOST;
      return publicResponse(Response.redirect(url.href, 308), url.pathname);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return publicResponse(new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }), url.pathname);

    if (privatePath(url.pathname)) return publicResponse(new Response('Not found', { status: 404 }), url.pathname);
    try {
      if (env.RL_SITE && !(await env.RL_SITE.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success) {
        return publicResponse(new Response('Too many requests. Please try again shortly.', { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }), url.pathname);
      }
    } catch {
      return publicResponse(new Response('The site is temporarily unavailable. Please try again shortly.', { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }), url.pathname);
    }
    const upstream = new URL(ORIGIN);
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    try {
      if (env.ASSETS && !await originReady(env)) {
        const assetRequest = new Request(url.href, { method: request.method, headers });
        try {
          const asset = await env.ASSETS.fetch(assetRequest);
          if (asset.status !== 404) return publicResponse(asset, url.pathname);
        } catch { /* An asset binding failure leaves the static origin available. */ }
      }
      const response = await fetch(upstream, { method: request.method, headers, redirect: 'manual' });
      const outgoing = secureHeaders(response.headers, url.pathname);
      const location = outgoing.get('location');
      if (location) {
        const target = new URL(location, upstream);
        if (target.origin === ORIGIN) {
          target.hostname = PUBLIC_HOST;
          outgoing.set('location', target.href);
        }
      }
      outgoing.set('Strict-Transport-Security', 'max-age=31536000');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
    } catch {
      return publicResponse(new Response('The site is temporarily unavailable. Please try again shortly.', { status: 502, headers: { 'Cache-Control': 'no-store' } }), url.pathname);
    }
  },
};
