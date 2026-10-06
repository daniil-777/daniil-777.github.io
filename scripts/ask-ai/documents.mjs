/** Extract only already-public PDFs. Requires Poppler's pdftotext. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublic, privacyProblems, PHONE, EMAIL } from '../../src/lib/chat/kb.ts';
import { site } from '../../src/data/site.ts';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function cleanPage(raw) {
  let text = raw.normalize('NFKC').replace(/\u00ad/g, '').replace(/([a-z])-\n\s*([a-z])/g, '$1$2');
  text = text.replace(EMAIL, address => address.toLowerCase() === site.email.toLowerCase() ? address : '[contact omitted]');
  text = text.replace(/https?:\/\/\S+|www\.\S+/g, '[external link omitted]');
  text = text.replace(/\S+\.(?:pdf|mp4|mov)\b/gi, '[file omitted]');
  // Keep dates and the public patent number, remove phone-like sequences.
  const years = [];
  text = text.replace(/\b(?:19|20)\d{2}\b|WO2023186262A1/g, value => {
    years.push(value); return `YEARPLACEHOLDER${String.fromCharCode(65 + years.length - 1)}`;
  });
  text = text.replace(new RegExp(PHONE.source, 'g'), '[number omitted]');
  text = text.replace(/YEARPLACEHOLDER([\s\S])/g, (_, char) => years[char.charCodeAt(0) - 65]);
  text = text.replace(/^\s*\d{1,3}\s*$/gm, '').replace(/\s+/g, ' ').trim();
  return text;
}

export function splitPage(text, maxWords = 230, overlap = 25) {
  const words = text.split(/\s+/).filter(Boolean);
  const parts = [];
  for (let start = 0; start < words.length; start += maxWords - overlap) {
    parts.push(words.slice(start, start + maxWords).join(' '));
    if (start + maxWords >= words.length) break;
  }
  return parts;
}

export function extractDocuments({ ocr = false } = {}) {
  const catalog = JSON.parse(readFileSync(resolve(root, 'src/data/documents.json'), 'utf8'));
  const allowed = [
    { id: 'public-cv', title: 'Daniil Emtsev — public CV', pdf: '/docs/daniil-emtsev-cv.pdf', tags: ['CV', 'Experience', 'Education'] },
    ...Object.entries(catalog).map(([id, value]) => ({ id, title: value.title, pdf: value.pdf, tags: ['Research document'] })),
  ];
  const chunks = [], documents = [];
  for (const document of allowed) {
    if (!/^\/(?:papers\/[a-z0-9-]+\.pdf|docs\/daniil-emtsev-cv\.pdf)$/.test(document.pdf)) throw new Error('Document is not an allowlisted public PDF');
    const file = resolve(root, `public${document.pdf}`);
    const sha256 = digest(readFileSync(file));
    const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 });
    const pages = raw.split('\f');
    if (!pages.at(-1)?.trim()) pages.pop();
    let recognized;
    if (ocr && document.id === 'camera-pose-patent' && !pages.some(page => /[\p{L}]{3}/u.test(page))) {
      recognized = JSON.parse(execFileSync('swift', ['-module-cache-path', '/tmp/ask-ai-swift-cache', resolve(root, 'scripts/ask-ai/ocr.swift'), file], { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2, timeout: 300_000 }));
      for (const page of recognized) if (page.confidence >= 0.9) pages[page.number - 1] = page.text;
    }
    const first = chunks.length;
    let omitted = 0;
    pages.forEach((page, index) => {
      const cleaned = cleanPage(page);
      if (!/[\p{L}]{3}/u.test(cleaned)) return;
      for (const [part, text] of splitPage(cleaned).entries()) {
        // Fail closed for residual source paths/client names instead of publishing them.
        if (privacyProblems(text).length) { omitted++; continue; }
        chunks.push({ id: `document:${document.id}:p${index + 1}:${part + 1}`, kind: 'document',
          url: `${document.pdf}#page=${index + 1}`, title: document.title, heading: `Page ${index + 1}${recognized ? ' · OCR transcription' : ''}`,
          tags: document.tags, asks: [], text, document: { id: document.id, page: index + 1, sha256,
            ...(recognized ? { method: 'ocr', confidence: recognized.find(page => page.number === index + 1)?.confidence ?? 0 } : { method: 'text' }) } });
      }
    });
    documents.push({ id: document.id, title: document.title, url: document.pdf, sha256, pages: pages.length,
      chunks: chunks.length - first, omitted, ...(recognized ? { ocr: 'apple-vision-accurate', excludedPages: [1, 2, 32, 34, 36, 37], note: 'Prose transcription only; equations and symbols require checking the original PDF.' } : {}), status: chunks.length === first ? 'ocr-required' : 'extracted' });
  }
  assertPublic({ chunks });
  const output = { v: 1, extractor: documents.some(d => d.ocr) ? 'poppler-pdftotext-layout+apple-vision-accurate' : 'poppler-pdftotext-layout', documents, chunks };
  writeFileSync(resolve(root, 'src/data/ask-ai-documents.json'), JSON.stringify(output, null, 2) + '\n');
  mkdirSync(resolve(root, 'docs/ask-ai'), { recursive: true });
  writeFileSync(resolve(root, 'docs/ask-ai/document-extraction.json'), JSON.stringify({ ...output, chunks: undefined }, null, 2) + '\n');
  console.log(`Extracted ${chunks.length} page chunks from ${documents.filter(d => d.status === 'extracted').length} public PDFs; ${documents.filter(d => d.status === 'ocr-required').length} needs OCR.`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) extractDocuments({ ocr: process.argv.includes('--ocr') });
