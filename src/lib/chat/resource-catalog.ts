/** Build the chat's public attachment catalog from the same projects and manifests as the site. */
import { getImage } from 'astro:assets';
import { links } from '../../data/site';
import { getProjects, projectHref, resolveVideos } from '../projects';
import { resolveDocuments } from '../documents';
import type { Resource } from './resources';

export async function getChatResources(): Promise<Resource[]> {
  const resources: Resource[] = [
    { id: 'cv', kind: 'cv', title: 'Daniil Emtsev · CV', url: '/docs/daniil-emtsev-cv.pdf', description: 'Two-page CV with experience, education, skills and selected projects.', download: true },
    { id: 'showreel', kind: 'video', title: 'Portfolio showreel', url: '/media/showreel-small.mp4', description: 'A short tour of the projects.' },
  ];
  for (const project of await getProjects()) {
    resources.push({ id: `project:${project.id}`, kind: 'project', title: project.data.title, url: projectHref(project), description: project.data.tagline, project: project.id });
    for (const video of resolveVideos(project)) {
      const poster = await getImage({ src: video.poster, width: Math.min(video.poster.width, 640), format: 'webp' });
      resources.push({ id: `video:${video.id}`, kind: 'video', title: video.title, url: video.small ?? video.src, description: video.caption, poster: poster.src, project: project.id });
    }
    for (const doc of resolveDocuments(project)) {
      resources.push({ id: `document:${doc.id}`, kind: 'document', title: doc.title, url: doc.pdf, description: `${doc.kind} · ${doc.pages.length} pages`, project: project.id, download: true });
    }
    for (const [index, link] of project.data.links.entries()) {
      if (link.kind !== 'code' && link.kind !== 'live') continue;
      resources.push({ id: `link:${project.id}:${index}`, kind: link.kind === 'code' ? 'code' : 'demo', title: `${project.data.title} · ${link.label}`, url: link.href, project: project.id });
    }
  }
  for (const link of links.filter((link) => link.id !== 'mail')) {
    resources.push({ id: `profile:${link.id}`, kind: 'profile', title: link.label, url: link.href, description: link.handle });
  }
  return resources;
}
