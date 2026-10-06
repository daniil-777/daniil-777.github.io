/**
 * Guards the document previews: every declared document has been rendered,
 * every reference to a document resolves, and nothing that was not declared
 * has found its way into `public/`. Published files are pinned by content,
 * not only by name.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { publications } from '../src/data/site.ts';
import { DOCUMENT_KINDS } from '../src/data/taxonomy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts: string[]) => path.join(root, ...parts);

interface Declared {
  id: string;
  kind: string;
  title: string;
  source: string;
  file?: string;
  original?: { label: string; href: string };
  project: string;
}

interface Image {
  src: string;
  width: number;
  height: number;
}

interface Entry {
  title: string;
  pdf: string;
  thumb: Image;
  thumbSmall: Image;
  pages: Image[];
  sha256: { source: string; pdf: string; images: string };
}

/**
 * The documents approved for publication, each with the SHA-256 of its source
 * PDF. Publishing another document, or another file under the same name, takes
 * a deliberate edit here. `npm run docs` records the digest of what it rendered
 * in src/data/documents.json, as `sha256.source`.
 */
const APPROVED: Record<string, string> = {
  'alzheimers-poster': 'c63865fb43f8786e1d8e5092b6ad2cfd05b2f03698c4c497701a6c141eda9484',
  'camera-pose-patent': 'd2de984650bf25a9fbc9b3597bf9bd063af7071a742a7fb9626ada7fb6f943a5',
  'dynamic-plane-onet-paper': '7f9859f6705a327b0177e5811dec55ee9013906c485a9c3f84c304d1ba051532',
  'loss-landscape-barcodes-paper': '788494ee49ea2ca6aec351d903244bf75e39273ee4e6aa50b131ea31ebb9271b',
  // Explicitly authorized upright ETH certificate; cover letter and transcript are excluded.
  'eth-masters-diploma': 'e23233fe8d36a19a2bfb8bcdd08d2d0fa8c2207bda2e2571bdcddc9d83b426fa',
};

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const images = (entry: Entry) => [entry.thumb, entry.thumbSmall, ...entry.pages];

const dir = at('src/content/projects');
const education = JSON.parse(readFileSync(at('src/data/education-documents.json'), 'utf8')) as Omit<Declared, 'project'>[];
const declared: Declared[] = [...readdirSync(dir)
  .filter((file) => file.endsWith('.md'))
  .flatMap((file) => {
    const frontmatter = readFileSync(path.join(dir, file), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, `${file}: missing frontmatter`);
    const documents = (parse(frontmatter[1]) as { documents?: Omit<Declared, 'project'>[] }).documents ?? [];
    return documents.map((document) => ({ ...document, project: file.replace(/\.md$/, '') }));
  }), ...education.map((document) => ({ ...document, project: 'education' }))];
const manifest = JSON.parse(readFileSync(at('src/data/documents.json'), 'utf8')) as Record<string, Entry>;
const ids = declared.map((document) => document.id);

/** Every file under a folder of the project, as a path relative to the project. */
function filesUnder(folder: string): string[] {
  return readdirSync(at(folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(relative) : [relative];
  });
}

/** Every file under `public/`, as a path relative to it. */
const publicFiles = () => filesUnder('public').map((file) => file.slice('public/'.length));

describe('documents', () => {
  it('ids are unique across the site', () => {
    assert.equal(new Set(ids).size, ids.length);
  });

  for (const document of declared) {
    describe(document.id, () => {
      it('is well formed', () => {
        assert.match(document.id, /^[a-z0-9-]+$/);
        assert.ok((DOCUMENT_KINDS as readonly string[]).includes(document.kind), `unknown kind "${document.kind}"`);
        assert.ok(document.title?.trim(), 'title is empty');
        assert.match(document.source, /\.pdf$/);
        if (document.original) assert.match(document.original.href, /^https:\/\/\S+$/);
      });

      it('has been rendered', () => {
        const entry = manifest[document.id];
        assert.ok(entry, `"${document.id}" is not in documents.json. Run: npm run docs`);
        assert.equal(entry.pdf, `/papers/${document.file ?? `${document.id}.pdf`}`);
        assert.ok(existsSync(at('public', entry.pdf)), `missing public${entry.pdf}`);
        assert.ok(entry.pages.length > 0, 'no pages');
        for (const image of images(entry)) {
          assert.ok(existsSync(at('public', image.src)), `missing public${image.src}`);
          assert.ok(image.width > 0 && image.height > 0, `${image.src} has no dimensions`);
        }
      });

      it('matches its declaration', () => {
        const entry = manifest[document.id];
        const stale = 'documents.json is out of date. Run: npm run docs';
        // Only the title: it is written into the PDF. The rest is read from the frontmatter directly.
        assert.equal(entry?.title, document.title, stale);
      });

      it('is approved, and published exactly as it was rendered', () => {
        const entry = manifest[document.id];
        assert.equal(entry.sha256.source, APPROVED[document.id], `"${document.id}" is not an approved document, or its source has changed: review it, then update APPROVED`);
        // The raw material is not in the repository; where it is present, it must be the approved file.
        if (existsSync(at(document.source))) assert.equal(sha256(at(document.source)), APPROVED[document.id], `${document.source} is not the approved file`);
        assert.equal(sha256(at('public', entry.pdf)), entry.sha256.pdf, `public${entry.pdf} is not the file that was rendered`);
        const digest = createHash('sha256').update(images(entry).map((image) => sha256(at('public', image.src))).join('\n')).digest('hex');
        assert.equal(digest, entry.sha256.images, `the images in public/docs/${document.id}/ are not the ones that were rendered`);
      });
    });
  }

  it('the manifest lists only declared documents', () => {
    for (const id of Object.keys(manifest)) assert.ok(ids.includes(id), `documents.json has an entry for unknown document "${id}"`);
  });

  it('the ETH preview contains only the upright diploma certificate', () => {
    const entry = manifest['eth-masters-diploma'];
    assert.equal(entry.pages.length, 1);
    assert.ok(entry.pages[0].width > entry.pages[0].height, 'the certificate must be upright in landscape orientation');
  });

  it('publications cite documents that exist, each once', () => {
    const cited = publications.map((publication) => publication.document);
    for (const id of cited) assert.ok(ids.includes(id), `a publication cites unknown document "${id}"`);
    assert.equal(new Set(cited).size, cited.length);
  });
});

describe('publication guard', () => {
  const files = publicFiles();

  it('every PDF in public/ is a declared document', () => {
    const allowed = new Set([...Object.values(manifest).map((entry) => entry.pdf), '/docs/daniil-emtsev-cv.pdf']);
    for (const file of files.filter((name) => /\.pdf$/i.test(name))) {
      assert.ok(allowed.has(`/${file}`), `public/${file} is not a declared document: remove it, or declare it in a project's frontmatter`);
    }
  });

  it('every preview image belongs to a declared document', () => {
    const allowed = new Set([...Object.values(manifest).flatMap((entry) => images(entry).map((image) => image.src)), '/docs/daniil-emtsev-cv.pdf']);
    for (const file of files.filter((name) => name.startsWith('docs/'))) {
      assert.ok(allowed.has(`/${file}`), `public/${file} does not belong to a declared document`);
    }
  });

  it('nothing in public/ is named like a private document', () => {
    // Exact approved certificate outputs are authorized; other private documents remain excluded.
    const authorized = new Set(education.flatMap(({ id }) => [manifest[id].pdf, ...images(manifest[id]).map((image) => image.src)]));
    const privateName = /(^|[^a-z])cv([^a-z]|$)|diplom|transcript|thesis|cvpr|de[-_ ]?novo|resume/i;
    for (const file of files.filter((name) => name !== 'docs/daniil-emtsev-cv.pdf' && !authorized.has(`/${name}`))) assert.doesNotMatch(file, privateName, `public/${file} looks like a private document`);
  });

  it('the site holds no conflict copies', () => {
    // A synced folder can leave "name 2.ext" beside a file it saw change; in public/ such a copy
    // would be published, and in src/content it would be built as a page of its own.
    for (const top of ['public', 'src', 'scripts', 'tests']) {
      for (const file of filesUnder(top)) assert.doesNotMatch(file, / \d+(\.[a-z0-9]+)?$/i, `${file} looks like a duplicate left by file sync`);
    }
  });

  it('documents are rendered only from their published sources', () => {
    for (const document of declared) {
      // Kept in step with PRIVATE_SOURCE in scripts/documents.mjs.
      const privateSource = /(^|\/)CV\/|(^|[^a-z])cv\.pdf$|diplom|transcript|thesis|gen-chemistry|cvpr|de[-_ ]?novo|report|review|resume/i;
      if (document.project === 'education') {
        assert.ok(APPROVED[document.id], `${document.id}: certificate is not approved`);
        assert.equal(manifest[document.id].sha256.source, APPROVED[document.id]);
      } else assert.doesNotMatch(document.source, privateSource, `${document.id}: ${document.source} is private`);
    }
  });
});
