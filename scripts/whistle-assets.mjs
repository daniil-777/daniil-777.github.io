/** Re-fetch the frozen Apache 2.0 Whistle release. Run: npm run voice:assets. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../public/vendor/whistle/2026-10-02/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
await mkdir(directory, { recursive: true });
for (const file of manifest.files) {
  const response = await fetch(file.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${file.name}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`${file.name}: integrity check failed`);
  await writeFile(new URL(file.name, directory), bytes);
  console.log(`${file.name}: verified ${bytes.length} bytes`);
}
