/** Regenerate the public CV from canonical public portfolio facts. */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { site, hero, links, facts, journey, skills, awards, publications } from '../src/data/site.ts';

const projects = readdirSync(new URL('../src/content/projects/', import.meta.url)).filter((file) => file.endsWith('.md')).map((file) => {
  const content = readFileSync(new URL(`../src/content/projects/${file}`, import.meta.url), 'utf8');
  const data = parse(content.match(/^---\n([\s\S]*?)\n---/)[1]);
  return { id: file.replace(/\.md$/, ''), title: data.title, summary: data.summary, year: data.year, documents: (data.documents ?? []).map(({ id, title }) => ({ id, title })) };
});
const result = spawnSync(process.env.CV_PYTHON || 'python3', ['scripts/generate-public-cv.py', 'public/docs/daniil-emtsev-cv.pdf'], {
  input: JSON.stringify({ site, hero, links, facts, journey, skills, awards, publications, projects }), encoding: 'utf8',
});
if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? result.stderr);
  console.error('Install scripts/requirements-cv.txt and set CV_PYTHON to that environment’s Python.');
  process.exit(1);
}
process.stdout.write(result.stdout);
