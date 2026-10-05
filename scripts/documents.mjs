#!/usr/bin/env node
/**
 * Turns the PDFs referenced in src/content/projects/*.md into an in-page preview.
 *
 *   npm run docs              render anything new or changed
 *   npm run docs -- --force   redo everything
 *   npm run docs -- camera-pose-patent    only these document ids
 *
 * For every `documents[]` entry it writes
 *   public/papers/<file>            the PDF itself, with a proper Title in its metadata
 *   public/docs/<id>/<n>.webp       one image per page, 1400px wide
 *   public/docs/<id>/thumb.webp     the first page, small
 *   public/docs/<id>/thumb-s.webp   the same, smaller still, for phones
 * and records paths, dimensions and SHA-256 digests in src/data/documents.json.
 * The digests let `npm test` notice a published file that was swapped for another.
 *
 * The browser only ever shows these images, so no PDF viewer is shipped.
 * An output is rebuilt when a file is missing, or when something it depends on
 * has changed: the source PDF, the `title`, or the settings below.
 *
 * Requires pdftoppm and pdfinfo (poppler) on PATH. The PDF Title is set with
 * python3 + pypdf when they are available; without them the PDF is copied as it is.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = new Set(args.filter((a) => !a.startsWith('--')));

const PAGE = { width: 1400, quality: 80 };
const THUMB = { width: 480, quality: 76 };
const THUMB_SMALL = { width: 240, quality: 74 };

/** Kept in step with tests/documents.test.ts: CVs, diplomas, transcripts, theses, reports and unpublished manuscripts. */
const PRIVATE_SOURCE = /(^|\/)CV\/|(^|[^a-z])cv\.pdf$|diplom|transcript|thesis|gen-chemistry|cvpr|de[-_ ]?novo|report|review|resume/i;

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

const fingerprint = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);

/** Writes through a temporary file, so an interrupted run never leaves a half-written one. */
async function atomic(out, write) {
  const partial = out.replace(/(\.\w+)$/, '.partial$1');
  await write(partial);
  await rename(partial, out);
}

async function readDocuments() {
  const dir = at('src/content/projects');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  const documents = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), 'utf8');
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error(`${file}: missing frontmatter`);
    const data = parseYaml(match[1]);
    for (const d of data.documents ?? []) documents.push({ ...d, project: file.replace(/\.md$/, '') });
  }
  return documents;
}

/** Refuses a declaration that would write outside its folders or publish a private file. Runs before anything is written. */
function validate(doc) {
  const where = `${doc.project}: document "${doc.id}"`;
  if (!/^[a-z0-9-]+$/.test(String(doc.id))) throw new Error(`${where}: id must be lower-case letters, digits and hyphens`);
  if (doc.file !== undefined && !/^[a-z0-9-]+\.pdf$/.test(String(doc.file))) throw new Error(`${where}: file must look like some-name.pdf`);
  if (!String(doc.title ?? '').trim()) throw new Error(`${where}: title is empty`);
  const source = String(doc.source ?? '');
  if (!/\.pdf$/i.test(source)) throw new Error(`${where}: source must be a PDF`);
  if (path.relative(root, at(source)).startsWith('..') || path.isAbsolute(source)) throw new Error(`${where}: source is outside the repository`);
  if (PRIVATE_SOURCE.test(source)) throw new Error(`${where}: ${source} looks like a private document and is not published`);
}

const SET_TITLE = `
import sys
from pypdf import PdfWriter
source, out, title = sys.argv[1:4]
writer = PdfWriter(clone_from=source)
writer.add_metadata({'/Title': title})
writer.write(out)
`;

let pypdf;
/** Whether python3 can import pypdf. Asked once. */
function hasPypdf() {
  pypdf ??= run('python3', ['-c', 'import pypdf']).then(() => true, () => false);
  return pypdf;
}

/** Rasterises pages `first`..`last` to PNG and returns the files in page order. */
async function rasterise(src, dir, first, last) {
  await run('pdftoppm', [
    '-png', '-scale-to-x', String(PAGE.width), '-scale-to-y', '-1',
    '-f', String(first), '-l', String(last), src, path.join(dir, 'page'),
  ], { maxBuffer: 1 << 26 });
  // pdftoppm pads the page number to the width of the last one, so a plain sort is page order.
  return (await readdir(dir)).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(dir, f));
}

/** @param previous this document's entry from the last run, if any */
async function render(doc, previous) {
  const src = at(doc.source);
  if (!existsSync(src)) throw new Error(`${doc.id}: source not found: ${doc.source}`);
  const file = doc.file ?? `${doc.id}.pdf`;
  const dir = at('public/docs', doc.id);
  const out = { pdf: at('public/papers', file), thumb: path.join(dir, 'thumb.webp'), thumbSmall: path.join(dir, 'thumb-s.webp') };
  await mkdir(dir, { recursive: true });

  const { stdout } = await run('pdfinfo', [src]);
  const count = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (!count) throw new Error(`${doc.id}: could not read the page count of ${doc.source}`);
  const pageFile = (n) => path.join(dir, `${n}.webp`);
  const numbers = Array.from({ length: count }, (_, i) => i + 1);

  // What each output depends on. A change to any of it rebuilds just that output.
  const source = [doc.source, (await stat(src)).size];
  const sig = {
    pdf: fingerprint([source, file, doc.title]),
    pages: fingerprint([source, PAGE]),
    thumb: fingerprint([source, THUMB]),
    thumbSmall: fingerprint([source, THUMB_SMALL]),
  };
  const known = previous?.sig ?? {};
  const stale = {
    pdf: force || !existsSync(out.pdf) || known.pdf !== sig.pdf,
    pages: force || known.pages !== sig.pages || numbers.some((n) => !existsSync(pageFile(n))),
    thumb: force || known.thumb !== sig.thumb || !existsSync(out.thumb),
    thumbSmall: force || known.thumbSmall !== sig.thumbSmall || !existsSync(out.thumbSmall),
  };

  if (stale.pdf) {
    console.log(`  pdf      ${doc.id}`);
    if (await hasPypdf()) {
      await atomic(out.pdf, (partial) => run('python3', ['-c', SET_TITLE, src, partial, doc.title]));
    } else {
      console.warn('  python3 with pypdf not found: the PDF is published without a Title in its metadata');
      await atomic(out.pdf, (partial) => copyFile(src, partial));
    }
  }

  if (stale.pages || stale.thumb || stale.thumbSmall) {
    const tmp = await mkdtemp(path.join(tmpdir(), 'documents-'));
    try {
      const pngs = await rasterise(src, tmp, 1, stale.pages ? count : 1);
      if (stale.pages) {
        console.log(`  pages    ${doc.id} (${count})`);
        if (pngs.length !== count) throw new Error(`${doc.id}: pdftoppm wrote ${pngs.length} of ${count} pages`);
        for (const n of numbers) {
          await atomic(pageFile(n), (partial) => sharp(pngs[n - 1]).webp({ quality: PAGE.quality }).toFile(partial));
        }
      }
      if (stale.thumb) {
        console.log(`  thumb    ${doc.id}`);
        await atomic(out.thumb, (partial) =>
          sharp(pngs[0]).resize({ width: THUMB.width }).webp({ quality: THUMB.quality }).toFile(partial),
        );
      }
      if (stale.thumbSmall) {
        console.log(`  thumb-s  ${doc.id}`);
        await atomic(out.thumbSmall, (partial) =>
          sharp(pngs[0]).resize({ width: THUMB_SMALL.width }).webp({ quality: THUMB_SMALL.quality }).toFile(partial),
        );
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  // Pages left over from a longer version of the document.
  for (const f of await readdir(dir)) {
    if (/^\d+\.webp$/.test(f) && Number.parseInt(f, 10) > count) await rm(path.join(dir, f));
  }

  const describe = async (abs) => {
    const { width, height } = await sharp(abs).metadata();
    return { src: `/${path.relative(at('public'), abs).split(path.sep).join('/')}`, width, height };
  };
  const images = [out.thumb, out.thumbSmall, ...numbers.map(pageFile)];
  return {
    title: doc.title,
    pdf: `/papers/${file}`,
    thumb: await describe(out.thumb),
    thumbSmall: await describe(out.thumbSmall),
    pages: await Promise.all(numbers.map((n) => describe(pageFile(n)))),
    sig,
    // What was published, and from what. `images` is one digest over those of the thumbnails and pages, in order.
    sha256: {
      source: await sha256(src),
      pdf: await sha256(out.pdf),
      images: createHash('sha256').update((await Promise.all(images.map(sha256))).join('\n')).digest('hex'),
    },
  };
}

async function main() {
  await mkdir(at('public/papers'), { recursive: true });
  const manifestPath = at('src/data/documents.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
  const save = () => atomic(manifestPath, (partial) => writeFile(partial, `${JSON.stringify(manifest, null, 2)}\n`));

  const documents = await readDocuments();
  const ids = documents.map((d) => d.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate document ids: ${[...new Set(dupes)].join(', ')}`);
  documents.forEach(validate);

  for (const doc of documents) {
    if (only.size && !only.has(doc.id)) continue;
    console.log(`${doc.project} / ${doc.id}`);
    manifest[doc.id] = await render(doc, manifest[doc.id]);
    // Written after every document so an interrupted run keeps its progress.
    await save();
  }
  // A document removed from the frontmatter leaves the manifest. Its files are
  // left for you to delete, and `npm test` fails until the PDF is gone.
  for (const id of Object.keys(manifest)) {
    if (ids.includes(id)) continue;
    console.warn(`"${id}" is no longer declared: delete public${manifest[id].pdf} and public/docs/${id}/`);
    delete manifest[id];
  }
  await save();
  console.log('docs: done');
}

main().catch((err) => {
  console.error(`docs: ${err.stderr || err.message}`);
  process.exit(1);
});
