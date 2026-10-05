import hashes from './csp-hashes.json' with { type: 'json' };

const PREVIEWS = new Set(['/architecture/', '/architecture/index.html', '/drawings/', '/drawings/index.html']);
const TFJS = ['core', 'backend-webgpu', 'backend-webgl'].map(name => `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-${name}@4.22.0/dist/tf-${name}.min.js`);

/** Security policy for the static portfolio, including its same-origin previews. */
export function secureHeaders(incoming, pathname = '/') {
  const headers = new Headers(incoming);
  const scripts = ["'self'", "'wasm-unsafe-eval'", ...hashes.map(hash => `'${hash}'`), ...(PREVIEWS.has(pathname) ? TFJS : [])];
  headers.delete('set-cookie');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()');
  headers.set('Content-Security-Policy', [
    "default-src 'self'", `script-src ${scripts.join(' ')}`, "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
    "connect-src 'self'", "media-src 'self' blob:", "worker-src 'self'", "frame-src 'self'",
    "frame-ancestors 'self'", "base-uri 'none'", "object-src 'none'", "form-action 'none'",
  ].join('; '));
  return headers;
}

/** Block common source/config probes before they reach assets or the origin. */
export function privatePath(pathname) {
  let path = pathname;
  try { for (let i = 0; i < 2; i++) path = decodeURIComponent(path); } catch { return true; }
  return path.split(/[\\/]/).some(part => part.startsWith('.') && part !== '.well-known')
    || /(?:^|\/)(?:node_modules|worker|src|me)(?:\/|$)/i.test(path)
    || /(?:^|\/)(?:package(?:-lock)?\.json|wrangler\.jsonc|AGENTS\.md|wp-login\.php|xmlrpc\.php)$/i.test(path);
}
