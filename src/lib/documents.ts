import type { IconName } from '../components/Icon.astro';
import manifestJson from '../data/documents.json';
import educationJson from '../data/education-documents.json';
import type { DocumentKind } from '../data/taxonomy';
import { getProjects, type Project } from './projects';

export interface DocumentImage {
  src: string;
  width: number;
  height: number;
}

interface ManifestEntry {
  pdf: string;
  thumb: DocumentImage;
  /** The same first page, smaller, for the places that show it at thumbnail size. */
  thumbSmall?: DocumentImage;
  pages: DocumentImage[];
}

export interface ResolvedDocument extends ManifestEntry {
  id: string;
  kind: DocumentKind;
  title: string;
  /** Id of the project that declares the document. */
  project: string;
  original?: { label: string; href: string };
}

const manifest = manifestJson as unknown as Record<string, ManifestEntry>;

/** How each kind of document is named on buttons and labels. */
export const DOCUMENT_KIND: Record<DocumentKind, { label: string; action: string; icon: IconName }> = {
  paper: { label: 'Paper', action: 'Read the paper', icon: 'doc' },
  patent: { label: 'Patent', action: 'Read the patent', icon: 'award' },
  poster: { label: 'Poster', action: 'View the poster', icon: 'doc' },
  diploma: { label: 'Diploma', action: 'View diploma', icon: 'award' },
};

/**
 * Joins a project's `documents` with the files produced by `npm run docs`.
 * A document that has not been rendered yet is skipped with a warning, so a
 * new project can be written before its preview exists.
 */
export function resolveDocuments(project: Project): ResolvedDocument[] {
  const documents: ResolvedDocument[] = [];
  // `?? []`: a content store synced before the field existed has no `documents` at all.
  for (const { id, kind, title, original } of project.data.documents ?? []) {
    const entry = manifest[id];
    if (!entry) {
      console.warn(`[docs] "${id}" (${project.id}) has not been rendered. Run: npm run docs`);
      continue;
    }
    documents.push({ id, kind, title, original, project: project.id, pdf: entry.pdf, thumb: entry.thumb, thumbSmall: entry.thumbSmall, pages: entry.pages });
  }
  return documents;
}

/** Every document on the site. */
export async function getDocuments(): Promise<ResolvedDocument[]> {
  const education = educationJson.flatMap(({ id, kind, title }) => {
    const entry = manifest[id];
    return entry ? [{ ...entry, id, kind: kind as DocumentKind, title, project: 'education' }] : [];
  });
  return [...(await getProjects()).flatMap(resolveDocuments), ...education];
}

/** `srcset` of a document's thumbnail: both sizes, so a phone fetches the small one. */
export function thumbSrcset({ thumb, thumbSmall }: ResolvedDocument): string | undefined {
  return thumbSmall ? `${thumbSmall.src} ${thumbSmall.width}w, ${thumb.src} ${thumb.width}w` : undefined;
}

/** "16 pages" */
export function pageCount(document: ResolvedDocument): string {
  const count = document.pages.length;
  return `${count} ${count === 1 ? 'page' : 'pages'}`;
}
