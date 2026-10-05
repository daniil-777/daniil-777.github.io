import type { APIRoute } from 'astro';
import { site } from '../data/site';
import { getProjects, projectHref } from '../lib/projects';

export const GET: APIRoute = async () => {
  const projects = await getProjects();
  const paths = ['/', ...projects.map((project) => projectHref(project)), '/ask/', '/smart-watch/'];
  const urls = paths.map((path) => `  <url><loc>${new URL(path, site.url).href}</loc></url>`).join('\n');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
