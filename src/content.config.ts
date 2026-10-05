import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORY_IDS, DOCUMENT_KINDS, LINK_KINDS, TOPICS } from './data/taxonomy';

/**
 * One Markdown file in `src/content/projects/` = one project in the catalog.
 * The frontmatter below is everything the site needs; the Markdown body is the
 * long-form write-up shown on the project page.
 */
const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** Short claim shown under the title. */
      tagline: z.string(),
      /** One or two sentences for cards, search and link previews. */
      summary: z.string(),
      category: z.enum(CATEGORY_IDS),
      /** Display string, e.g. "2022 – now". */
      year: z.string(),
      /** Used for ordering only (newest first). */
      sortDate: z.coerce.date(),
      organisation: z.string(),
      role: z.string().optional(),
      /** Featured projects get the large tiles at the top of the home page. */
      featured: z.boolean().default(false),
      /** Lower numbers come first among featured projects. */
      order: z.number().default(100),
      /** Filter chips. Must come from TOPICS in src/data/taxonomy.ts. */
      topics: z.array(z.enum(TOPICS)).min(1),
      /** Free-form technology keywords: shown on the project page, matched by search. */
      stack: z.array(z.string()).default([]),
      highlights: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
      /** `href` is an absolute URL, or a root-relative path to a file in `public/`. */
      links: z
        .array(
          z.object({
            label: z.string(),
            href: z.string().regex(/^(https:\/\/|\/(?!\/))\S+$/),
            kind: z.enum(LINK_KINDS),
          }),
        )
        .default([]),
      /**
       * Papers, patents and posters, previewed page by page on the site. This is
       * the only place a document is declared; `npm run docs` renders it.
       */
      documents: z
        .array(
          z.object({
            /** Unique across the site; names the generated files. */
            id: z.string().regex(/^[a-z0-9-]+$/),
            kind: z.enum(DOCUMENT_KINDS),
            title: z.string(),
            /** The PDF, relative to the repository root. Only read by `npm run docs`. */
            source: z.string().regex(/\.pdf$/),
            /** File name under `public/papers/`. Defaults to `<id>.pdf`. */
            file: z.string().regex(/^[a-z0-9-]+\.pdf$/).optional(),
            /** Where the document was first published, e.g. its arXiv page. */
            original: z.object({ label: z.string(), href: z.string().regex(/^https:\/\/\S+$/) }).optional(),
          }),
        )
        .default([]),
      /** Card image for projects without a video. */
      cover: image().optional(),
      /** `contain` keeps diagrams and figures uncropped on a paper-coloured tile. */
      coverFit: z.enum(['cover', 'contain']).default('cover'),
      videos: z
        .array(
          z.object({
            /** Unique across the site; names the generated files and the Mux mapping. */
            id: z.string().regex(/^[a-z0-9-]+$/),
            title: z.string(),
            caption: z.string().optional(),
            /** Raw recording, relative to the repository root. Only read by `npm run media`. */
            source: z.string(),
            /** Second used for the poster frame. */
            posterAt: z.number().default(1),
            /** Second where the short silent hover preview starts. */
            previewAt: z.number().default(0),
            /** Open playback at a selected demo moment; the full recording remains seekable. */
            startAt: z.number().nonnegative().optional(),
            /** Set to false to strip the audio track when transcoding. */
            audio: z.boolean().default(true),
            /** Pixels of the source recording to cut from each edge, e.g. a browser's address bar. */
            crop: z
              .object({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() })
              .partial()
              .optional(),
          }),
        )
        .default([]),
      gallery: z
        .array(z.object({ src: image(), alt: z.string(), caption: z.string().optional() }))
        .default([]),
      /** Optional before/after slider. */
      compare: z
        .object({
          before: image(),
          after: image(),
          beforeLabel: z.string(),
          afterLabel: z.string(),
          caption: z.string().optional(),
        })
        .optional(),
    }),
});

/**
 * One Markdown file in `src/content/facts/` = one thing the "Ask AI" assistant
 * knows that no other page says: a fact or a frequently asked question. The
 * body is the answer, in plain third-person prose.
 */
const facts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/facts' }),
  schema: z.object({
    /** Shown on /ask/ and used as the title of the answer. */
    question: z.string().min(8),
    /** Other words visitors may use for the same question. */
    asks: z.array(z.string()).default([]),
    /** Whole phrases that force this answer, with no model call. */
    triggers: z.array(z.string().min(3)).default([]),
    /** A private topic: the body is the fixed reply. */
    sensitive: z.boolean().default(false),
    /** The page to cite. Defaults to `/ask/#<file name>`. */
    url: z.string().regex(/^\/\S*$/).optional(),
  }),
});

export const collections = { projects, facts };
