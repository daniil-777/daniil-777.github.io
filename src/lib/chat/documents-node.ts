/** Shared build/test loader. A changed PDF requires re-extraction, never stale evidence. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Chunk } from './kb.ts';

export function loadDocumentChunks(root: string = process.cwd()): Chunk[] {
  const data = JSON.parse(readFileSync(resolve(root, 'src/data/ask-ai-documents.json'), 'utf8')) as {
    v: number; chunks: Chunk[]; documents: { id: string; url: string; sha256: string; pages: number }[];
  };
  if (data.v !== 1 || !Array.isArray(data.chunks)) throw new Error('Invalid Ask AI document corpus');
  for (const document of data.documents) {
    if (!/^\/(?:papers\/[a-z0-9-]+\.pdf|docs\/daniil-emtsev-cv\.pdf)$/.test(document.url)) throw new Error('Non-public document');
    const actual = createHash('sha256').update(readFileSync(resolve(root, `public${document.url}`))).digest('hex');
    if (actual !== document.sha256) throw new Error(`Ask AI document changed: ${document.url}. Run npm run chat:documents.`);
  }
  for (const chunk of data.chunks) {
    const source = data.documents.find(document => document.id === chunk.document?.id);
    const page = chunk.document?.page;
    if (!source || !page || !Number.isInteger(page) || page > source.pages || page < 1 || chunk.document?.sha256 !== source.sha256 || chunk.url !== `${source.url}#page=${page}`) throw new Error(`Invalid document provenance: ${chunk.id}`);
    if (chunk.document?.method === 'ocr' && (typeof chunk.document.confidence !== 'number' || chunk.document.confidence < 0.9 || chunk.document.confidence > 1)) throw new Error(`Uncertain OCR passage: ${chunk.id}`);
  }
  return data.chunks;
}
