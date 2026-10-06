/** Read-only local production preview for isolated browser acceptance tests. */
import { resolve } from 'node:path';
import { createStaticPreview } from '../static-preview.mjs';
import { secureHeaders } from '../../worker/site/security.mjs';
const directory = resolve(process.argv[2] ?? 'build');
const port = Number(process.argv[3] ?? 4357);
createStaticPreview(directory, (headers, pathname) => secureHeaders(headers, pathname, { localChat: true }))
  .listen(port, '127.0.0.1', () => console.log(`Production preview: http://127.0.0.1:${port}`));
