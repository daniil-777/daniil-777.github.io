/**
 * The controlled vocabulary behind the catalog filters.
 * Add a topic here first, then use it in a project's frontmatter.
 */

export const CATEGORY_IDS = ['surgical-ai', 'independent', 'research'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const CATEGORIES: Record<CategoryId, { label: string; short: string; blurb: string }> = {
  'surgical-ai': {
    label: 'Surgical AI',
    short: 'VirtaMed',
    blurb: 'Real-time AI for surgical simulators, built at VirtaMed.',
  },
  independent: {
    label: 'Independent',
    short: 'Side projects',
    blurb: 'AI that runs in the browser, built in my own time.',
  },
  research: {
    label: 'Research',
    short: 'ETH · MIPT',
    blurb: 'Papers, a patent and theses from ETH Zurich and MIPT.',
  },
};

export const TOPICS = [
  'Computer Vision',
  'Generative AI',
  'LLM & VLM',
  '3D',
  'Reinforcement Learning',
  'Real-time',
  'In-browser AI',
  'Medical',
  'Simulation',
  'Synthetic data',
  'Finance',
  'MLOps',
  'Drug discovery',
  'Deep learning theory',
  'Publication',
  'Patent',
] as const;
export type Topic = (typeof TOPICS)[number];

export const LINK_KINDS = ['live', 'code', 'site'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Documents are previewed on the site itself; see `documents` in src/content.config.ts. */
export const DOCUMENT_KINDS = ['paper', 'patent', 'poster'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
