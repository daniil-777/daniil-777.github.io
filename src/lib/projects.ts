import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import { getCollection, type CollectionEntry } from 'astro:content';
import mediaJson from '../data/media.json';
import { CATEGORIES } from '../data/taxonomy';
import muxJson from '../data/mux.json';

export type Project = CollectionEntry<'projects'>;

interface MediaEntry {
  src: string;
  /** A 960px rendition for phones. Absent until `npm run media` has written it. */
  small?: string;
  preview: string;
  width: number;
  height: number;
  duration: number;
  audio: boolean;
  sig?: { full?: string; small?: string };
}

export interface ResolvedVideo extends MediaEntry {
  id: string;
  title: string;
  caption?: string;
  poster: ImageMetadata;
  /** Set once the video has been uploaded with `npm run mux`. */
  playbackId?: string;
  startAt?: number;
}

const media = mediaJson as Record<string, MediaEntry>;
const mux = muxJson as Record<string, string>;

const posterModules = import.meta.glob<{ default: ImageMetadata }>('../assets/posters/*.jpg', { eager: true });
const posters = Object.fromEntries(
  Object.entries(posterModules).map(([file, mod]) => [file.split('/').pop()!.replace('.jpg', ''), mod.default]),
);

export function poster(id: string): ImageMetadata | undefined {
  return posters[id];
}

/** Featured projects first, in their chosen order; then everything else, newest first. */
export async function getProjects(): Promise<Project[]> {
  const projects = await getCollection('projects');
  const rank = (project: Project) => (project.data.featured ? project.data.order : Number.MAX_SAFE_INTEGER);
  return projects.sort((a, b) => rank(a) - rank(b) || b.data.sortDate.getTime() - a.data.sortDate.getTime());
}

/**
 * Joins a project's `videos` with the files produced by `npm run media`.
 * A video that has not been transcoded yet is skipped with a warning, so a
 * new project can be written before its media exists.
 */
export function resolveVideos(project: Project): ResolvedVideo[] {
  const videos: ResolvedVideo[] = [];
  for (const video of project.data.videos) {
    const entry = media[video.id];
    const image = posters[video.id];
    if (!entry || !image) {
      console.warn(`[media] "${video.id}" (${project.id}) has no transcoded files. Run: npm run media`);
      continue;
    }
    videos.push({
      ...entry,
      src: entry.sig?.full ? `${entry.src}?v=${entry.sig.full}` : entry.src,
      small: entry.small && entry.sig?.small ? `${entry.small}?v=${entry.sig.small}` : entry.small,
      id: video.id, title: video.title, caption: video.caption, poster: image,
      playbackId: mux[video.id], startAt: video.startAt,
    });
  }
  return videos;
}

/** The image that represents a project on cards: its first video's poster, or its cover. */
export function projectCover(project: Project): { image: ImageMetadata; fit: 'cover' | 'contain' } | undefined {
  const [video] = resolveVideos(project);
  if (video) return { image: video.poster, fit: 'cover' };
  if (project.data.cover) return { image: project.data.cover, fit: project.data.coverFit };
  return undefined;
}

/** What the browser needs to play a video; serialised into `data-video` attributes. */
export async function videoPayload(video: ResolvedVideo) {
  const image = await getImage({ src: video.poster, width: Math.min(video.poster.width, 1600), format: 'webp' });
  return {
    id: video.id,
    title: video.title,
    src: video.src,
    small: video.small,
    poster: image.src,
    ratio: Math.round((video.width / video.height) * 1000) / 1000,
    playbackId: video.playbackId,
    startAt: video.startAt,
  };
}

/** "Surgical AI · VirtaMed", or just "Independent project" where the two would repeat each other. */
export function projectContext(project: Project): string {
  const { category, organisation } = project.data;
  return category === 'independent' ? organisation : `${CATEGORIES[category].label} · ${organisation}`;
}

export function projectHref(project: Project | string): string {
  return `/work/${typeof project === 'string' ? project : project.id}/`;
}

/** 103.2 → "1:43" */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
