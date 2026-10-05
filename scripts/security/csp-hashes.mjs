/** Freeze exact built inline script bodies for an enforced CSP without unsafe-inline. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const hashes = new Set();
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(path, 'utf8');
      if (/\son[a-z]+\s*=/i.test(html)) throw new Error(`Inline event handler needs an external listener: ${path}`);
      for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!body.trim() || /application\/(?:ld\+)?json/i.test(attributes)) continue;
        hashes.add(`sha256-${createHash('sha256').update(body).digest('base64')}`);
      }
    }
  }
}
await scan('build');
const data = JSON.stringify([...hashes].sort(), null, 2) + '\n';
const file = 'worker/site/csp-hashes.json';
if (process.argv.includes('--write')) await writeFile(file, data);
else if (await readFile(file, 'utf8') !== data) throw new Error('Built inline scripts changed; run node scripts/security/csp-hashes.mjs --write and redeploy the gateway.');
console.log(`CSP verified ${hashes.size} trusted inline script hashes.`);
