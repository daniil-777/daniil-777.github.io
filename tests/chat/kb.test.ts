/**
 * The knowledge base holds every public part of the site and nothing private.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { journey, publications, site } from '../../src/data/site.ts';
import { assertPublic, buildChunks, buildKb, privacyProblems, splitSections, toKbProject, type Chunk } from '../../src/lib/chat/kb.ts';
import { sentences, slug, toPlain, words } from '../../src/lib/chat/text.ts';
import { loadKb, loadSource, readCollection } from './load.ts';

const kb = await loadKb();
const ids = new Set(kb.chunks.map((chunk) => chunk.id));
const chunk = (patch: Partial<Chunk>): Chunk => ({ id: 'x', kind: 'site', url: '/', title: 'T', heading: '', tags: [], asks: [], text: 'Some text.', ...patch });

describe('text helpers', () => {
  it('slugs headings the way Astro does', () => {
    assert.equal(slug('Describe it, or create it'), 'describe-it-or-create-it');
    assert.equal(slug('3D objects'), '3d-objects');
    assert.equal(slug('Three models, three questions'), 'three-models-three-questions');
    // Accents and other scripts stay, as in the ids Astro writes into the page.
    assert.equal(slug('ETH Zürich'), 'eth-zürich');
    assert.equal(slug('Résumé & results (v2.0)'), 'résumé--results-v20');
    assert.equal(slug('Что дальше?'), 'что-дальше');
    assert.equal(slug('snake_case and C++'), 'snake_case-and-c');
    assert.deepEqual(splitSections('## Résumé & results (v2.0)\n\ntext').sections.map((s) => s.anchor), ['résumé--results-v20']);
  });

  it('turns Markdown into plain sentences', () => {
    assert.equal(toPlain('- **Find.** A `CLIP` encoder\n- [Code](https://x.y/z) here'), 'Find. A CLIP encoder. Code here.');
    assert.equal(toPlain('1. **3D modelling.** The anatomy *starts* as a model.'), '3D modelling. The anatomy starts as a model.');
  });

  it('splits sentences but not titles, initials or volume numbers', () => {
    assert.deepEqual(sentences('Supervised by Prof. Luc Van Gool and Dr. Danda Pani Paudel. It was graded 5.75 out of 6.'), [
      'Supervised by Prof. Luc Van Gool and Dr. Danda Pani Paudel.',
      'It was graded 5.75 out of 6.',
    ]);
    assert.deepEqual(sentences('With Christian F. Baumgartner. Published in vol. 514 (2023).'), ['With Christian F. Baumgartner.', 'Published in vol. 514 (2023).']);
    assert.deepEqual(sentences('One line\nAnother line'), ['One line', 'Another line']);
  });
});

describe('knowledge base', () => {
  it('passes the privacy check', () => assert.doesNotThrow(() => assertPublic(kb)));

  it('has unique ids and no chunk over 350 words', () => {
    assert.equal(ids.size, kb.chunks.length);
    for (const c of kb.chunks) assert.ok(words(c.text).length <= 350, `${c.id} is too long`);
  });

  it('has a chunk for every journey entry, publication, project and fact', () => {
    for (const entry of journey) assert.ok(ids.has(`journey:${slug(entry.organisation)}`), entry.organisation);
    for (const publication of publications) assert.ok(ids.has(`pub:${publication.document}`), publication.document);
    for (const { id } of readCollection('projects')) assert.ok(ids.has(`project:${id}`), id);
    for (const { id } of readCollection('facts')) assert.ok(ids.has(`fact:${id}`), id);
  });

  it('gives every section the anchor of its heading', () => {
    for (const { id, body } of readCollection('projects')) {
      for (const heading of body.match(/^## .+$/gm) ?? []) {
        const anchor = slug(heading.slice(3));
        const section = kb.chunks.find((c) => c.id === `project:${id}#${anchor}`);
        assert.ok(section, `${id}: no chunk for "${heading}"`);
        assert.equal(section.url, `/work/${id}/#${anchor}`);
      }
    }
    assert.deepEqual(splitSections('intro\n\n## Same\n\na\n\n## Same\n\nb').sections.map((s) => s.anchor), ['same', 'same-1']);
  });

  it('calls the patent filing an application, never a granted patent', () => {
    const patent = kb.chunks.find((c) => c.id === 'pub:camera-pose-patent')!;
    assert.match(patent.text, /^Patent application: /);
    assert.match(patent.text, /International patent application WO2023186262A1/);
  });

  it('says nothing about a work permit: the words are only triggers of the fixed reply', () => {
    const said = kb.chunks.filter(c => c.kind !== 'document').map(({ title, heading, text, tags, asks }) => [title, heading, text, ...tags, ...asks].join('\n')).join('\n');
    assert.ok(!/permit|\bvisa\b/i.test(said));
    assert.deepEqual(kb.chunks.filter((chunk) => chunk.kind !== 'document' && /permit|\bvisa\b/i.test(JSON.stringify(chunk))).map((chunk) => chunk.id), ['fact:personal']);
  });

  it('has a stable hash that does not depend on the build date', async () => {
    const again = await buildKb(loadSource(), '1999-12-31');
    assert.equal(again.hash, kb.hash);
    assert.match(kb.hash, /^[0-9a-f]{16}$/);
    assert.notEqual(again.built, kb.built);
  });

  it('picks up a new project without any other change', () => {
    const source = loadSource();
    const added = toKbProject('new-thing', { title: 'New Thing', tagline: 'A tagline', summary: 'A summary.', category: 'independent', year: '2027', organisation: 'Independent project', topics: ['3D'] }, '## How\n\nIt works.');
    const chunks = buildChunks({ ...source, projects: [...source.projects, added] });
    assert.ok(chunks.some((c) => c.id === 'project:new-thing'));
    assert.ok(chunks.some((c) => c.id === 'project:new-thing#how'));
    assert.match(chunks.find((c) => c.id === 'rollup:projects')!.text, /New Thing \(Independent project, 2027\): A tagline/);
  });

  it('lists a topic only when at least two projects share it, and orders projects by id', () => {
    const source = loadSource();
    const project = (id: string, topics: string[]) => toKbProject(id, { title: id.toUpperCase(), tagline: 't', summary: 's', category: 'independent', year: '2027', organisation: 'O', topics }, 'Body.');
    const chunks = buildChunks({ ...source, publications: [], projects: [project('zeta', ['Shared', 'Only zeta']), project('alpha', ['Shared'])] });
    assert.ok(chunks.some((c) => c.id === 'rollup:topic:shared'));
    assert.ok(!chunks.some((c) => c.id === 'rollup:topic:only-zeta'));
    assert.deepEqual(chunks.filter((c) => c.kind === 'project').map((c) => c.id), ['project:alpha', 'project:zeta']);
    assert.match(chunks.find((c) => c.id === 'rollup:projects')!.text, /^ALPHA[^\n]*\nZETA/);
  });

  it('lists the whole timeline, newest first, and the stack of a project in its own sentence', () => {
    const timeline = kb.chunks.find((c) => c.id === 'rollup:journey')!;
    assert.deepEqual(timeline.text.split('\n').map((line) => line.split(':')[0]), journey.map((entry) => entry.period));
    assert.equal(timeline.url, '/#journey');
    assert.match(kb.chunks.find((c) => c.id === 'project:pixel-morph')!.text, /Stack: TensorFlow\.js, WebGPU/);
  });

  it('splits a long section at paragraph boundaries', () => {
    const paragraph = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');
    const project = toKbProject('long', { title: 'Long', tagline: 't', summary: 's', category: 'research', year: '2020', organisation: 'O', topics: [] }, `## Part\n\n${paragraph}\n\n${paragraph}`);
    const chunks = buildChunks({ ...loadSource(), projects: [project], publications: [] });
    assert.ok(chunks.some((c) => c.id === 'project:long#part'));
    assert.equal(chunks.find((c) => c.id === 'project:long#part-2')?.url, '/work/long/#part');
  });
});

describe('privacy', () => {
  it('reads only allowlisted frontmatter fields', () => {
    const project = toKbProject(
      'p',
      {
        title: 'P',
        tagline: 't',
        summary: 's',
        category: 'research',
        year: 2020,
        organisation: 'O',
        topics: ['3D'],
        cover: '../../assets/secret-cover.png',
        sortDate: '2020-01-01',
        videos: [{ id: 'v', title: 'Video', caption: 'Shown.', source: 'VirtaMed/x.mov', posterAt: 3 }],
        documents: [{ id: 'd', kind: 'paper', title: 'Doc', source: 'ETH/thesis.pdf', file: 'doc.pdf' }],
        gallery: [{ src: '../x.png', alt: 'Alt text never shown', caption: 'Caption.' }],
      },
      'Body.',
    );
    const text = JSON.stringify(project);
    for (const leak of ['VirtaMed/x.mov', 'ETH/thesis.pdf', 'doc.pdf', 'secret-cover', 'Alt text', 'posterAt', '2020-01-01']) assert.ok(!text.includes(leak), leak);
    assert.ok(text.includes('Shown.') && text.includes('Caption.'));
  });

  it('never carries a raw source path of the real projects', () => {
    const text = JSON.stringify(kb);
    for (const { data } of readCollection('projects')) {
      const sources = [...((data.videos as { source: string }[]) ?? []), ...((data.documents as { source: string }[]) ?? [])].map((item) => item.source);
      for (const source of sources) assert.ok(!text.includes(source), source);
    }
  });

  // Canaries: made-up values of the kinds that exist only in the private CV.
  const canaries: [string, string][] = [
    ['a phone number', 'Call +41 79 555 01 23 any time.'],
    ['a phone number without a prefix', 'Phone: 079 555 01 23'],
    ['a referee’s email', 'Referee: prof.someone@ethz.ch'],
    ['a private folder', 'See CV/Daniil_CV.pdf'],
    ['a raw recording', 'From VirtaMed/ethicon/peg_transfer.mov'],
    ['a PDF outside /papers/', 'Download thesis.pdf'],
    ['the client name', 'Built for Ethicon.'],
    ['an insecure URL', 'See http://example.com/page'],
  ];
  for (const [name, text] of canaries) {
    it(`rejects ${name}`, () => {
      assert.ok(privacyProblems(text).length > 0);
      assert.throws(() => assertPublic({ chunks: [chunk({ text })] }), /\[chat\] chunk "x"/);
    });
  }

  it('rejects empty text, template leaks, long chunks, duplicate ids and off-site URLs', () => {
    assert.throws(() => assertPublic({ chunks: [chunk({ text: ' ' })] }));
    assert.throws(() => assertPublic({ chunks: [chunk({ text: 'Role: undefined.' })] }));
    assert.throws(() => assertPublic({ chunks: [chunk({ text: 'Value [object Object]' })] }));
    assert.throws(() => assertPublic({ chunks: [chunk({ text: 'word '.repeat(351) })] }));
    assert.throws(() => assertPublic({ chunks: [chunk({}), chunk({})] }));
    assert.throws(() => assertPublic({ chunks: [chunk({ url: 'https://elsewhere.example/' })] }));
    assert.throws(() => assertPublic({ chunks: [chunk({ url: '//elsewhere.example/' })] }));
  });

  it('accepts what the site really publishes', () => {
    for (const text of [`Email: ${site.email}.`, 'WO2023186262A1, filed 2021 – 2023', 'arXiv:2011.05813', 'Read /papers/camera-pose-patent.pdf', 'GitHub: https://github.com/daniil-777', '2015 – 2019 and 2019 – 2022']) {
      assert.deepEqual(privacyProblems(text), [], text);
    }
  });
});
