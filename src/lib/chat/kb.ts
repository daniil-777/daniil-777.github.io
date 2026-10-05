/**
 * The assistant's knowledge base: public site content cut into chunks.
 * Pure functions. The Astro build (site-kb.ts) and the tests (tests/chat/load.ts)
 * read the files and hand the data in, so both build exactly the same chunks.
 */
import { site as siteData } from '../../data/site.ts';
import type { JourneyEntry, Publication } from '../../data/site.ts';
import { CATEGORIES, type CategoryId } from '../../data/taxonomy.ts';
import { slug, toPlain, words } from './text.ts';

export interface Chunk {
  id: string;
  kind: 'site' | 'journey' | 'publication' | 'project' | 'section' | 'media' | 'fact' | 'rollup';
  /** Root-relative, with an anchor where one exists. */
  url: string;
  /** The subject, e.g. "AI Proctor", "Journey", "Research". */
  title: string;
  /** The sub-part, e.g. "What I built", "VirtaMed"; empty if none. */
  heading: string;
  tags: string[];
  /** Facts only: the question and its other phrasings. */
  asks: string[];
  /** Plain text. Roll-ups hold one item per line. */
  text: string;
  triggers?: string[];
  sensitive?: boolean;
}

export interface Kb {
  v: 1;
  /** First 16 hex characters of SHA-256 over JSON.stringify(chunks). */
  hash: string;
  /** YYYY-MM-DD. Not part of the hash. */
  built: string;
  embedding: null | { model: string; revision: string; dtype: 'q8'; dim: 768; scale: number; count: number };
  chunks: Chunk[];
}

/** The public part of a project: what `toKbProject` lets through. */
export interface KbProject {
  id: string;
  title: string;
  tagline: string;
  summary: string;
  category: CategoryId;
  year: string;
  organisation: string;
  role?: string;
  topics: string[];
  stack: string[];
  highlights: { value: string; label: string }[];
  links: { label: string; href: string }[];
  documents: { id: string; kind: string; title: string; original?: { label: string; href: string } }[];
  videos: { title: string; caption?: string }[];
  captions: string[];
  compare?: { beforeLabel: string; afterLabel: string; caption?: string };
  body: string;
}

export interface KbFact {
  id: string;
  question: string;
  asks: string[];
  triggers: string[];
  sensitive: boolean;
  url?: string;
  body: string;
}

export interface KbSource {
  site: { name: string; role: string; location: string; description: string; email: string };
  hero: { lead: string };
  links: { id: string; label: string; href: string }[];
  stats: { value: string; label: string }[];
  bio: string[];
  facts: { label: string; value: string }[];
  journey: JourneyEntry[];
  publications: Publication[];
  awards: { title: string; detail: string; year: string }[];
  skills: { group: string; items: string[] }[];
  interests: string[];
  projects: KbProject[];
  factFiles: KbFact[];
}

type Raw = Record<string, unknown>;
const list = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);
const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value));
const optional = (value: unknown): string | undefined => (value === undefined || value === null ? undefined : String(value));

/**
 * The only place project frontmatter is read for the knowledge base. Fields are
 * picked one by one, never spread: `videos[].source` and `documents[].source`
 * are paths into private folders and must not get through.
 */
export function toKbProject(id: string, data: Raw, body: string): KbProject {
  const compare = data.compare as Raw | undefined;
  return {
    id,
    title: text(data.title),
    tagline: text(data.tagline),
    summary: text(data.summary),
    category: text(data.category) as CategoryId,
    year: text(data.year),
    organisation: text(data.organisation),
    role: optional(data.role),
    topics: (Array.isArray(data.topics) ? data.topics : []).map(text),
    stack: (Array.isArray(data.stack) ? data.stack : []).map(text),
    highlights: list(data.highlights).map((h) => ({ value: text(h.value), label: text(h.label) })),
    links: list(data.links).map((l) => ({ label: text(l.label), href: text(l.href) })),
    documents: list(data.documents).map((d) => {
      const original = d.original as Raw | undefined;
      return {
        id: text(d.id),
        kind: text(d.kind),
        title: text(d.title),
        original: original ? { label: text(original.label), href: text(original.href) } : undefined,
      };
    }),
    videos: list(data.videos).map((v) => ({ title: text(v.title), caption: optional(v.caption) })),
    captions: list(data.gallery).map((g) => text(g.caption)).filter(Boolean),
    compare: compare
      ? { beforeLabel: text(compare.beforeLabel), afterLabel: text(compare.afterLabel), caption: optional(compare.caption) }
      : undefined,
    body,
  };
}

/** A fact file's frontmatter with the same defaults as the `facts` collection schema. */
export function toKbFact(id: string, data: Raw, body: string): KbFact {
  const strings = (value: unknown) => (Array.isArray(value) ? value.map(text) : []);
  return {
    id,
    question: text(data.question),
    asks: strings(data.asks),
    triggers: strings(data.triggers),
    sensitive: data.sensitive === true,
    url: optional(data.url),
    body,
  };
}

/** A patent filing is an application, not a grant, so it is never called just "Patent". */
const KIND_LABEL: Record<string, string> = { paper: 'Paper', patent: 'Patent application', poster: 'Poster' };

/** Where the timeline is on the site, and the chunk that lists all of it. */
export const JOURNEY_URL = '/#journey';
export const JOURNEY_ROLLUP = 'rollup:journey';

/** Sections longer than this are split at paragraph boundaries. */
export const SECTION_WORDS = 200;
export const CHUNK_WORDS_MAX = 350;

const sentence = (value: string) => (/[.!?:]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`);
const join = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ');

function where(project: KbProject): string {
  const label = CATEGORIES[project.category]?.label;
  return project.category === 'independent' || !label
    ? `${project.organisation}, ${project.year}.`
    : `${label} at ${project.organisation}, ${project.year}.`;
}

/** The `##` sections of a write-up, and the text before the first one. */
export function splitSections(body: string): { intro: string; sections: { heading: string; anchor: string; paragraphs: string[] }[] } {
  const [intro, ...rest] = body.split(/^## +/m);
  const seen = new Map<string, number>();
  const sections = rest.map((part) => {
    const end = part.indexOf('\n');
    const heading = toPlain(end < 0 ? part : part.slice(0, end));
    const base = slug(heading);
    // A repeated heading gets "-1", "-2" …, as Astro numbers them.
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const paragraphs = (end < 0 ? '' : part.slice(end)).split(/\n\s*\n/).map(toPlain).filter(Boolean);
    return { heading, anchor: count ? `${base}-${count}` : base, paragraphs };
  });
  return { intro: toPlain(intro), sections };
}

function projectChunks(project: KbProject): Chunk[] {
  const url = `/work/${project.id}/`;
  const { intro, sections } = splitSections(project.body);
  const chunks: Chunk[] = [
    {
      id: `project:${project.id}`,
      kind: 'project',
      url,
      title: project.title,
      heading: '',
      tags: [...project.topics, ...project.stack, project.organisation],
      asks: [],
      text: join([
        sentence(project.tagline),
        sentence(project.summary),
        where(project),
        project.role && `Role: ${project.role}.`,
        project.stack.length > 0 && `Stack: ${project.stack.join(', ')}.`,
        ...project.highlights.map((h) => `${h.value}: ${h.label}.`),
        ...project.links.map((l) => `${l.label}: ${l.href}`),
        ...project.documents.map((d) => `${KIND_LABEL[d.kind] ?? d.kind}: ${d.title}.`),
        intro,
      ]),
    },
  ];
  for (const section of sections) {
    // Pack whole paragraphs into parts of at most SECTION_WORDS.
    const parts: string[] = [];
    for (const paragraph of section.paragraphs) {
      const last = parts.length - 1;
      if (last >= 0 && words(parts[last]).length + words(paragraph).length <= SECTION_WORDS) parts[last] += ` ${paragraph}`;
      else parts.push(paragraph);
    }
    parts.forEach((part, index) => {
      chunks.push({
        id: `project:${project.id}#${section.anchor}${index ? `-${index + 1}` : ''}`,
        kind: 'section',
        url: `${url}#${section.anchor}`,
        title: project.title,
        heading: section.heading,
        tags: project.topics,
        asks: [],
        text: part,
      });
    });
  }
  const media = join([
    ...project.videos.map((v) => (v.caption ? `${v.title}: ${sentence(v.caption)}` : sentence(v.title))),
    ...project.captions.map(sentence),
    project.compare && sentence(join([`${project.compare.beforeLabel} and ${project.compare.afterLabel}:`, project.compare.caption])),
  ]);
  if (media) {
    chunks.push({ id: `project:${project.id}:media`, kind: 'media', url, title: project.title, heading: 'Videos and figures', tags: project.topics, asks: [], text: media });
  }
  return chunks;
}

/** Every chunk, in a deterministic order: site, journey, publications, projects, facts, roll-ups. */
export function buildChunks(source: KbSource): Chunk[] {
  const { site, journey } = source;
  const projects = [...source.projects].sort((a, b) => a.id.localeCompare(b.id));
  const factFiles = [...source.factFiles].sort((a, b) => a.id.localeCompare(b.id));
  const titleOf = (id: string) => projects.find((p) => p.id === id)?.title;
  const documents = projects.flatMap((p) => p.documents.map((d) => ({ ...d, project: p })));
  const chunks: Chunk[] = [];
  const add = (kind: Chunk['kind'], id: string, url: string, title: string, heading: string, body: string, tags: string[] = []) =>
    chunks.push({ id, kind, url, title, heading, tags, asks: [], text: body });

  add('site', 'site:intro', '/', site.name, '', join([`${site.role}, ${site.location}.`, site.description, source.hero.lead]));
  add('site', 'site:stats', '/', site.name, 'Highlights', join(source.stats.map((s) => `${s.value}: ${s.label}.`)));
  source.bio.forEach((paragraph, index) => add('site', `site:bio-${index + 1}`, '/#about', 'About', '', paragraph));
  add('site', 'site:facts', '/#about', 'About', 'Facts', join(source.facts.map((f) => `${f.label}: ${f.value}.`)), ['Location', 'Spoken languages']);
  add('site', 'site:skills', '/#skills-title', 'About', 'Tools I work with', join(source.skills.map((s) => `${s.group}: ${s.items.join(', ')}.`)), ['Skills', 'Programming languages', 'Frameworks']);
  add('site', 'site:awards', '/#awards-title', 'About', 'Awards and honours', join(source.awards.map((a) => `${a.title} (${a.detail}, ${a.year}).`)), ['Scholarships', 'Competitions', 'Prizes won']);
  add('site', 'site:interests', '/#interests-title', 'About', 'Away from the keyboard', `${source.interests.join(', ')}.`, ['Interests', 'Hobbies']);
  add('site', 'site:contact', '/#contact', 'Contact', '', join([`Email: ${site.email}.`, ...source.links.filter((l) => l.id !== 'mail').map((l) => `${l.label}: ${l.href}`)]));

  const journeyIds = new Map<string, number>();
  const journeyLine = (entry: JourneyEntry) => `${entry.title}, ${entry.organisation}, ${entry.place}, ${entry.period}`;
  for (const entry of journey) {
    const base = slug(entry.organisation);
    const count = (journeyIds.get(base) ?? 0) + 1;
    journeyIds.set(base, count);
    const related = entry.projects.map(titleOf).filter((t): t is string => Boolean(t));
    add(
      'journey',
      `journey:${base}${count > 1 ? `-${count}` : ''}`,
      JOURNEY_URL,
      'Journey',
      entry.organisation,
      join([`${journeyLine(entry)} (${entry.kind === 'work' ? 'Experience' : 'Education'}).`, ...entry.points]),
      related,
    );
  }

  const publicationLines: string[] = [];
  for (const publication of source.publications) {
    const document = documents.find((d) => d.id === publication.document);
    if (!document) throw new Error(`[chat] publication "${publication.document}" has no document in any project`);
    const kind = KIND_LABEL[document.kind] ?? document.kind;
    add(
      'publication',
      `pub:${document.id}`,
      '/#research',
      'Research',
      document.title,
      join([`${kind}: ${sentence(document.title)}`, `Authors: ${publication.authors}.`, `${publication.venue}, ${publication.year}.`, document.original && sentence(document.original.label)]),
      [document.project.title, kind],
    );
    publicationLines.push(`${kind}: ${document.title} (${publication.venue}, ${publication.year})`);
  }

  for (const project of projects) chunks.push(...projectChunks(project));

  for (const fact of factFiles) {
    chunks.push({
      id: `fact:${fact.id}`,
      kind: 'fact',
      url: fact.url ?? `/ask/#${fact.id}`,
      title: fact.question,
      heading: '',
      tags: [],
      asks: [fact.question, ...fact.asks],
      text: toPlain(fact.body),
      ...(fact.triggers.length ? { triggers: fact.triggers } : {}),
      ...(fact.sensitive ? { sensitive: true } : {}),
    });
  }

  const projectLine = (p: KbProject) => `${p.title} (${p.organisation}, ${p.year}): ${p.tagline}`;
  add('rollup', 'rollup:projects', '/#work', 'All projects', '', projects.map(projectLine).join('\n'));
  for (const topic of [...new Set(projects.flatMap((p) => p.topics))].sort()) {
    const tagged = projects.filter((p) => p.topics.includes(topic));
    if (tagged.length < 2) continue;
    const lines = tagged.map((p) => `${p.title}: ${p.tagline}`);
    add('rollup', `rollup:topic:${slug(topic)}`, `/?topic=${encodeURIComponent(topic)}#work`, 'Projects', topic, [`Projects tagged ${topic}:`, ...lines].join('\n'));
  }
  add('rollup', 'rollup:publications', '/#research', 'Research', 'Publications', publicationLines.join('\n'), ['Published', 'Papers', 'Patents', 'Posters']);
  add('rollup', 'rollup:education', JOURNEY_URL, 'Journey', 'Education', journey.filter((e) => e.kind === 'education').map(journeyLine).join('\n'));
  add('rollup', 'rollup:experience', JOURNEY_URL, 'Journey', 'Experience', journey.filter((e) => e.kind === 'work').map(journeyLine).join('\n'), ['Internships', 'Employment']);
  add('rollup', JOURNEY_ROLLUP, JOURNEY_URL, 'Journey', 'Timeline', journey.map((e) => `${e.period}: ${e.title}, ${e.organisation}, ${e.place}`).join('\n'), ['Career', 'Chronology']);
  return chunks;
}

export async function hashChunks(chunks: Chunk[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(chunks)));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildKb(source: KbSource, built: string, embedding: Kb['embedding'] = null): Promise<Kb> {
  const chunks = buildChunks(source);
  return { v: 1, hash: await hashChunks(chunks), built, embedding, chunks };
}

/** Same pattern in the guard: a run of digits long enough to be a phone number. */
export const PHONE = /(?<![\w/.-])\+?\d[\d ()-]{7,}\d(?![\w/])/;
export const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PRIVATE_PATH = /(?<![\w/])(?:CV|ETH|MIPT|Amgen|VirtaMed|me|docs|dist)\/[\w.-]/;
const MEDIA_FILE = /\S+\.(?:mov|mp4|pdf)\b/gi;
/** Long digit runs that are known to be public. */
const ALLOWED_NUMBERS = /WO2023186262A1|\b(?:19|20)\d{2}\b/g;

/** What is wrong with a piece of text that is about to be published, or nothing. */
export function privacyProblems(value: string, email: string = siteData.email): string[] {
  const problems: string[] = [];
  if (PRIVATE_PATH.test(value)) problems.push('a path into a private folder');
  if ((value.match(MEDIA_FILE) ?? []).some((file) => !/^(?:https:\/\/[\w.-]+)?\/papers\//.test(file.replace(/^[("']+/, '')))) problems.push('a media or PDF file outside /papers/');
  if (/ethicon/i.test(value)) problems.push('the word "ethicon"');
  if (PHONE.test(value.replace(ALLOWED_NUMBERS, 'x'))) problems.push('something that looks like a phone number');
  if ((value.match(EMAIL) ?? []).some((address) => address.toLowerCase() !== email.toLowerCase())) problems.push('an email address other than the site’s');
  if ((value.match(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi) ?? []).some((url) => !url.startsWith('https://'))) problems.push('a URL that is not https://');
  return problems;
}

/**
 * Throws if the knowledge base holds anything that must not be published.
 * Runs in the build, in the tests and on the built file.
 */
export function assertPublic(kb: Pick<Kb, 'chunks'>, email: string = siteData.email): void {
  const ids = new Set<string>();
  for (const chunk of kb.chunks) {
    const fail = (problem: string) => {
      throw new Error(`[chat] chunk "${chunk.id}" contains ${problem}`);
    };
    if (ids.has(chunk.id)) fail('an id that is already used');
    ids.add(chunk.id);
    if (!chunk.text.trim()) fail('no text');
    if (!/^\/(?!\/)/.test(chunk.url)) fail(`a URL that is not root-relative (${chunk.url})`);
    if (words(chunk.text).length > CHUNK_WORDS_MAX) fail(`more than ${CHUNK_WORDS_MAX} words`);
    const all = [chunk.url, chunk.title, chunk.heading, chunk.text, ...chunk.tags, ...chunk.asks, ...(chunk.triggers ?? [])].join('\n');
    if (/undefined|\[object/.test(all)) fail('"undefined" or "[object"');
    for (const problem of privacyProblems(all, email)) fail(problem);
  }
}
