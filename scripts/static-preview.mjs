/** Static preview with byte ranges so MP4 controls can seek before a full download. */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };

/**
 * Header decoration keeps the security preview's production policy on every response.
 * @param {string} root
 * @param {(headers: HeadersInit, pathname: string) => HeadersInit} [decorateHeaders]
 */
export function createStaticPreview(root, decorateHeaders = headers => headers) {
  const directory = resolve(root);
  return createServer(async (request, response) => {
    let pathname = '/';
    const sendHeaders = (status, headers) => response.writeHead(status, Object.fromEntries(new Headers(decorateHeaders(headers, pathname))));
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!['GET', 'HEAD'].includes(request.method)) {
        sendHeaders(405, { allow: 'GET, HEAD', 'content-length': '0' });
        return response.end();
      }
      let file = resolve(directory, `.${pathname}`);
      if (!file.startsWith(directory + sep) && file !== directory) throw new Error('outside');
      let info = await stat(file);
      if (info.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file);
      }
      if (!info.isFile()) throw new Error('not a file');
      const headers = {
        'content-type': types[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
        'last-modified': info.mtime.toUTCString(),
        'content-length': String(info.size),
      };
      let start = 0, end = info.size - 1, status = 200;
      // Ignore unsupported multi-range requests and stale If-Range validators.
      const range = request.method === 'GET'
        && (!request.headers['if-range'] || request.headers['if-range'] === headers['last-modified'])
        && request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (range && (range[1] || range[2])) {
        const first = Number(range[1]), last = Number(range[2]);
        start = range[1] ? first : Math.max(0, info.size - last);
        end = range[1] && range[2] ? Math.min(last, end) : end;
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || start > end || start >= info.size || (!range[1] && last === 0)) {
          sendHeaders(416, { ...headers, 'content-range': `bytes */${info.size}`, 'content-length': '0' });
          return response.end();
        }
        status = 206;
        headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
        headers['content-length'] = String(end - start + 1);
      }
      sendHeaders(status, headers);
      if (request.method === 'HEAD' || info.size === 0) return response.end();
      const stream = createReadStream(file, { start, end });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch {
      if (response.headersSent) return response.destroy();
      sendHeaders(404, { 'cache-control': 'no-store', 'content-type': 'text/plain', 'content-length': '9' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
    }
  });
}
