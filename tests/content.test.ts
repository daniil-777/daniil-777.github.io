/**
 * Guards the content: every project is well formed and every file it points
 * to exists. Runs in CI before the build, so a typo in frontmatter or a
 * video that was never transcoded fails loudly instead of shipping a hole.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { journey } from '../src/data/site.ts';
import { CATEGORY_IDS, LINK_KINDS, TOPICS } from '../src/data/taxonomy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts: string[]) => path.join(root, ...parts);
const readJson = (file: string) => JSON.parse(readFileSync(at(file), 'utf8'));

interface Frontmatter {
  title: string;
  tagline: string;
  summary: string;
  category: string;
  year: string | number;
  sortDate: string | Date;
  organisation: string;
  featured?: boolean;
  topics: string[];
  links?: { label: string; href: string; kind: string }[];
  cover?: string;
  videos?: { id: string; title: string; source: string; startAt?: number }[];
  gallery?: { src: string; alt: string }[];
  compare?: { before: string; after: string };
}

const dir = at('src/content/projects');
const projects = readdirSync(dir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(path.join(dir, file), 'utf8');
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    assert.ok(match, `${file}: missing frontmatter`);
    return { id: file.replace(/\.md$/, ''), data: parse(match[1]) as Frontmatter, body: match[2] };
  });

const media = readJson('src/data/media.json') as Record<string, { src: string; small?: string; preview: string; duration: number }>;
const mux = readJson('src/data/mux.json') as Record<string, string>;
const videoIds = projects.flatMap((project) => (project.data.videos ?? []).map((video) => video.id));
/** Image paths in frontmatter are relative to the project file. */
const asset = (relative: string) => path.resolve(dir, relative);

describe('projects', () => {
  it('there is at least one', () => assert.ok(projects.length > 0));

  for (const { id, data, body } of projects) {
    describe(id, () => {
      it('has the required text', () => {
        for (const field of ['title', 'tagline', 'summary', 'organisation'] as const) {
          assert.ok(data[field]?.trim(), `${field} is empty`);
        }
        assert.ok(String(data.year).trim(), 'year is empty');
        assert.ok(!Number.isNaN(new Date(data.sortDate).getTime()), 'sortDate is not a date');
        assert.ok(body.trim().length > 200, 'the write-up is very short');
      });

      it('uses a known category and known topics', () => {
        assert.ok((CATEGORY_IDS as readonly string[]).includes(data.category), `unknown category "${data.category}"`);
        assert.ok(data.topics.length > 0, 'no topics');
        for (const topic of data.topics) {
          assert.ok((TOPICS as readonly string[]).includes(topic), `unknown topic "${topic}": add it to src/data/taxonomy.ts`);
        }
      });

      it('has well-formed links', () => {
        for (const link of data.links ?? []) {
          assert.ok((LINK_KINDS as readonly string[]).includes(link.kind), `unknown link kind "${link.kind}"`);
          assert.match(link.href, /^(https:\/\/|\/(?!\/))\S+$/, `bad link "${link.href}"`);
          if (link.href.startsWith('/')) assert.ok(existsSync(at('public', link.href)), `missing file public${link.href}`);
        }
      });

      it('has something to show on its card', () => {
        assert.ok((data.videos?.length ?? 0) > 0 || data.cover, 'needs a video or a cover image');
      });

      it('points only at images that exist', () => {
        const images = [data.cover, data.compare?.before, data.compare?.after, ...(data.gallery ?? []).map((g) => g.src)];
        for (const image of images.filter((value): value is string => Boolean(value))) {
          assert.ok(existsSync(asset(image)), `missing image ${image}`);
        }
        for (const figure of data.gallery ?? []) assert.ok(figure.alt?.trim(), `${figure.src} has no alt text`);
      });

      it('has transcoded files for every video', () => {
        for (const video of data.videos ?? []) {
          const entry = media[video.id];
          assert.ok(entry, `"${video.id}" is not in media.json. Run: npm run media`);
          assert.ok(existsSync(at('public', entry.src)), `missing public${entry.src}`);
          assert.ok(entry.small && existsSync(at('public', entry.small)), `missing the phone rendition of "${video.id}". Run: npm run media`);
          assert.ok(existsSync(at('public', entry.preview)), `missing public${entry.preview}`);
          assert.ok(existsSync(at('src/assets/posters', `${video.id}.jpg`)), `missing poster for "${video.id}"`);
          assert.ok(entry.duration > 0, `"${video.id}" has no duration`);
          assert.ok(video.startAt === undefined || (Number.isFinite(video.startAt) && video.startAt >= 0 && video.startAt < entry.duration), `"${video.id}" starts outside its recording`);
        }
      });
    });
  }

  it('video ids are unique across the site', () => {
    assert.equal(new Set(videoIds).size, videoIds.length);
  });

  it('featured projects have a video or cover for their tile', () => {
    for (const { id, data } of projects.filter((project) => project.data.featured)) {
      assert.ok((data.videos?.length ?? 0) > 0 || data.cover, `${id} is featured but has no video or cover`);
    }
  });

  it('Laparoscopic Skills Trainer features Stratafix guidance at its instruction segment', () => {
    const project = projects.find(({ id }) => id === 'laparoscopic-skills-trainer')!;
    assert.equal(project.data.videos?.[0].id, 'lap-stratafix');
    assert.equal(project.data.videos?.[0].startAt, 111);
    assert.equal(project.data.videos?.length, 5);
  });
});

describe('site data', () => {
  const ids = new Set(projects.map((project) => project.id));

  it('journey entries link to projects that exist', () => {
    for (const entry of journey) for (const id of entry.projects) assert.ok(ids.has(id), `journey links to unknown project "${id}"`);
  });

  it('Mux playback ids belong to videos that exist', () => {
    for (const id of Object.keys(mux)) assert.ok(videoIds.includes(id), `mux.json has an entry for unknown video "${id}"`);
  });

  it('the hero showreel has been rendered', () => {
    assert.ok(existsSync(at('public/media/showreel.mp4')));
    assert.ok(existsSync(at('public/media/showreel-small.mp4')));
    assert.ok(existsSync(at('src/assets/posters/showreel.jpg')));
  });

  it('every video is H.264 High profile, which phones and tablets can decode', () => {
    // An encode without a pinned pixel format can come out as High 4:4:4 (profile 244),
    // which plays on a desktop and stays black on a phone. Read from the avcC box, so no ffprobe is needed.
    const mp4s = (readdirSync(at('public/media'), { recursive: true }) as string[]).filter((file) => file.endsWith('.mp4'));
    assert.ok(mp4s.length > 0);
    for (const file of mp4s) {
      const bytes = readFileSync(at('public/media', file));
      const avcC = bytes.indexOf('avcC', 0, 'latin1');
      assert.ok(avcC > 0, `public/media/${file} is not H.264`);
      assert.equal(bytes[avcC + 5], 100, `public/media/${file} is not High profile (4:2:0). Fix its encode in scripts/media.mjs`);
    }
  });
});
