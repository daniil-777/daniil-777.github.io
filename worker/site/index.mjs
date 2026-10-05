const ORIGIN = 'https://daniil-777.github.io';
const PUBLIC_HOST = 'demtsev.com';
const FORWARD_HEADERS = ['accept', 'accept-encoding', 'range', 'if-range', 'if-none-match', 'if-modified-since'];

export default {
  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    if (![PUBLIC_HOST, `www.${PUBLIC_HOST}`].includes(url.hostname)) return new Response('Not found', { status: 404 });
    if (url.protocol !== 'https:' || url.hostname !== PUBLIC_HOST) {
      url.protocol = 'https:';
      url.hostname = PUBLIC_HOST;
      return Response.redirect(url.href, 308);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });

    const upstream = new URL(ORIGIN);
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    try {
      const response = await fetch(upstream, { method: request.method, headers, redirect: 'manual' });
      const outgoing = new Headers(response.headers);
      outgoing.delete('set-cookie');
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
      return new Response('The site is temporarily unavailable. Please try again shortly.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
