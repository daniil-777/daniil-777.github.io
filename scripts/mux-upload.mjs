#!/usr/bin/env node
/**
 * Uploads the site's videos to Mux and records their playback ids, so the
 * player streams them adaptively from Mux instead of serving the MP4 files.
 *
 *   MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... npm run mux
 *   npm run mux -- astro-pilot          only this video id
 *   npm run mux -- --force              upload again, even if already mapped
 *
 * Create the token at https://dashboard.mux.com (Settings → Access Tokens,
 * with "Mux Video: Read and Write"). Each run uploads only videos that have
 * no entry yet in src/data/mux.json; commit that file afterwards.
 *
 * Uploaded assets get a public playback policy: anyone with the id can watch.
 */
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);
const API = 'https://api.mux.com/video/v1';

const { MUX_TOKEN_ID, MUX_TOKEN_SECRET } = process.env;
if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
  console.error('mux: set MUX_TOKEN_ID and MUX_TOKEN_SECRET (see the comment at the top of scripts/mux-upload.mjs).');
  process.exit(1);
}
const auth = `Basic ${Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString('base64')}`;

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = new Set(args.filter((a) => !a.startsWith('--')));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One call to the Mux API. Rate limits and server errors are retried a few times. */
async function mux(method, endpoint, body) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API}${endpoint}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok) return json.data;
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 4) {
      await sleep(2000 * attempt);
      continue;
    }
    const detail = json?.error?.messages?.join('; ') ?? response.statusText;
    throw new Error(`Mux ${method} ${endpoint} failed (${response.status}): ${detail}`);
  }
}

/** Polls until `read()` returns a value, or gives up after `minutes`. */
async function waitFor(what, read, minutes = 15) {
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function upload(id, file) {
  const direct = await mux('POST', '/uploads', {
    cors_origin: '*',
    new_asset_settings: { playback_policies: ['public'], passthrough: id },
  });

  const size = (await stat(file)).size;
  const put = await fetch(direct.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: await readFile(file),
  });
  if (!put.ok) throw new Error(`upload of ${id} failed (${put.status} ${put.statusText})`);

  const assetId = await waitFor(`Mux to register ${id}`, async () => {
    const current = await mux('GET', `/uploads/${direct.id}`);
    // Without this a failed upload would be polled until the timeout.
    if (['errored', 'cancelled', 'timed_out'].includes(current.status)) {
      throw new Error(`Mux reported the upload of ${id} as ${current.status}`);
    }
    return current.asset_id;
  });
  const asset = await waitFor(`Mux to process ${id}`, async () => {
    const current = await mux('GET', `/assets/${assetId}`);
    if (current.status === 'errored') throw new Error(`Mux could not process ${id}: ${current.errors?.messages?.join('; ')}`);
    return current.status === 'ready' ? current : undefined;
  });

  const playback = asset.playback_ids?.find((p) => p.policy === 'public');
  if (!playback) throw new Error(`${id}: the asset has no public playback id`);
  return playback.id;
}

async function main() {
  const media = JSON.parse(await readFile(at('src/data/media.json'), 'utf8'));
  const mapPath = at('src/data/mux.json');
  const map = existsSync(mapPath) ? JSON.parse(await readFile(mapPath, 'utf8')) : {};

  const ids = Object.keys(media).filter((id) => (only.size === 0 || only.has(id)) && (force || !map[id]));
  if (ids.length === 0) {
    console.log('mux: nothing to upload. Every video already has a playback id.');
    return;
  }

  for (const id of ids) {
    const file = at('public', media[id].src);
    if (!existsSync(file)) throw new Error(`${id}: ${media[id].src} is missing. Run: npm run media`);
    console.log(`uploading ${id} ...`);
    const replaced = map[id];
    map[id] = await upload(id, file);
    if (replaced) {
      // Nothing is deleted on Mux from here; the old asset keeps counting towards storage.
      console.warn(`  note: ${id} was already on Mux as ${replaced}. Delete that asset in the Mux dashboard if it is no longer needed.`);
    }
    // Saved after each video so an interrupted run keeps its progress.
    await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    console.log(`  ${id} -> ${map[id]}`);
  }
  console.log('mux: done. Commit src/data/mux.json and rebuild.');
}

main().catch((error) => {
  console.error(`mux: ${error.message}`);
  process.exit(1);
});
