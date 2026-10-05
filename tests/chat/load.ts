/**
 * Builds the knowledge base straight from the source files, without Astro,
 * the same way tests/content.test.ts reads the projects. Used by the tests
 * and by scripts/chat-eval.mjs.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { awards, bio, facts, hero, interests, journey, links, publications, site, skills, stats } from '../../src/data/site.ts';
import { buildKb, toKbFact, toKbProject, type Kb, type KbSource } from '../../src/lib/chat/kb.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function readCollection(name: string): { id: string; data: Record<string, unknown>; body: string }[] {
  const dir = path.join(root, 'src/content', name);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const match = readFileSync(path.join(dir, file), 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      assert.ok(match, `${name}/${file}: missing frontmatter`);
      return { id: file.replace(/\.md$/, ''), data: parse(match[1]) as Record<string, unknown>, body: match[2] };
    });
}

export function loadSource(): KbSource {
  return {
    site,
    hero,
    links,
    stats,
    bio,
    facts,
    journey,
    publications,
    awards,
    skills,
    interests,
    projects: readCollection('projects').map(({ id, data, body }) => toKbProject(id, data, body)),
    factFiles: readCollection('facts').map(({ id, data, body }) => toKbFact(id, data, body)),
  };
}

export function loadKb(built = '2026-01-01'): Promise<Kb> {
  return buildKb(loadSource(), built);
}
