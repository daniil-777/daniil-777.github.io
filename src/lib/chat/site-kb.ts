/**
 * The Astro side of the knowledge base: reads the site data and the content
 * collections, builds the chunks and, where the model is available, their
 * embeddings. kb.json and vectors.bin both come from here, so they always agree.
 */
import { getCollection, render } from 'astro:content';
import { awards, bio, facts, hero, interests, journey, links, publications, site, skills, stats } from '../../data/site';
import { getProjects } from '../projects';
import { EMBED, VECTORS_HEADER, encodeVectors, quantise, type Embedder } from './embed';
import { createBuildEmbedder } from './embed-node';
import { assertPublic, buildKb, splitSections, toKbFact, toKbProject, type Kb } from './kb';
import { displayTitle } from './text';

async function build(): Promise<Kb> {
  const projects = await getProjects();
  for (const project of projects) {
    // The anchors in the knowledge base must be the ids Astro gives the headings.
    const expected = (await render(project)).headings.filter((h) => h.depth === 2).map((h) => h.slug);
    const computed = splitSections(project.body ?? '').sections.map((s) => s.anchor);
    if (expected.join() !== computed.join()) throw new Error(`[chat] ${project.id}: heading anchors [${computed}] differ from the page's [${expected}]`);
  }
  const factFiles = await getCollection('facts');
  const kb = await buildKb(
    {
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
      projects: projects.map((project) => toKbProject(project.id, project.data, project.body ?? '')),
      factFiles: factFiles.map((fact) => toKbFact(fact.id, fact.data, fact.body ?? '')),
    },
    new Date().toISOString().slice(0, 10),
  );
  assertPublic(kb);
  return kb;
}

let embedder: Promise<Embedder> | undefined;

async function embed(kb: Kb): Promise<Uint8Array> {
  try {
    embedder ??= createBuildEmbedder();
    const { embed: run } = await embedder;
    const rows: Int8Array[] = [];
    for (const chunk of kb.chunks) rows.push(quantise(await run(`${displayTitle(chunk)}. ${chunk.text}`)));
    return encodeVectors(kb.hash, rows);
  } catch (error) {
    embedder = undefined;
    console.warn(`[chat] WARNING: embedding model unavailable, building without vectors (${error instanceof Error ? error.message : error})`);
    return encodeVectors(kb.hash, []);
  }
}

let memo: { hash: string; vectors: Promise<Uint8Array> } | undefined;

/**
 * The knowledge base and its vectors. `kb.embedding` is null when the vectors
 * could not be built. The chunks are rebuilt on every call, so the dev server
 * follows edits; the vectors are computed once per version of the content.
 */
export async function getSiteKb(): Promise<{ kb: Kb; vectors: Uint8Array }> {
  const kb = await build();
  if (memo?.hash !== kb.hash) memo = { hash: kb.hash, vectors: embed(kb) };
  const vectors = await memo.vectors;
  const count = (vectors.length - VECTORS_HEADER) / EMBED.dim;
  const embedding = count ? { model: EMBED.model, revision: EMBED.revision, dtype: EMBED.dtype, dim: EMBED.dim, scale: EMBED.scale, count } : null;
  return { kb: { ...kb, embedding }, vectors };
}
