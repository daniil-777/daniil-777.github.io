/**
 * The embedder for the build and for `npm run eval:chat` (Node only). It
 * loads the model from `.cache/transformers` without touching the network
 * when everything is there, and downloads it otherwise. The library's own
 * tokenizer loader cannot do that: it asks huggingface.co whether the
 * tokenizer exists on every load, cached or not, so a full cache would still
 * fail while the Hub is unreachable.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EMBED, createEmbedder, type Embedder, type Transformers } from './embed.ts';

export const CACHE_DIR = '.cache/transformers';

export async function createBuildEmbedder(): Promise<Embedder> {
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = CACHE_DIR;
  const library = transformers as unknown as Transformers;
  const files = ['tokenizer.json', 'tokenizer_config.json'].map((file) => path.join(CACHE_DIR, EMBED.model, EMBED.revision, file));
  if (files.every((file) => existsSync(file))) {
    transformers.env.allowRemoteModels = false;
    try {
      const [tokenizer, config] = files.map((file) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>);
      return await createEmbedder(library, {}, { tokenizer, config });
    } catch {
      // Part of the model is missing from the cache: download below.
    } finally {
      transformers.env.allowRemoteModels = true;
    }
  }
  return createEmbedder(library);
}
