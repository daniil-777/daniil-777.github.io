/**
 * Retrieval evaluation of the "Ask AI" assistant: npm run eval:chat
 *
 * Runs the golden questions (tests/chat/golden.ts) through keyword search, the
 * embedding model and the fused ranking, and prints hit@1/3/5 and MRR for each,
 * per kind of question. Then it asks every question the site must not answer
 * with "Smarter search" on, and checks that none is answered as if it could.
 * Downloads the 23 MB embedding model on first use, so it is not part of
 * `npm test`. Exits with 1 if the fused ranking misses a gate.
 *
 *   --bm25    keyword search only (no model, works offline)
 *   --misses  list every question the fused ranking misses at 5
 */
import { buildIndex, search } from '../src/lib/chat/bm25.ts';
import { createBuildEmbedder } from '../src/lib/chat/embed-node.ts';
import { EMBED, quantise } from '../src/lib/chat/embed.ts';
import { composeExtractive } from '../src/lib/chat/answer.ts';
import { DENSE_CLOSEST, DENSE_WEIGHT, denseScores, ranking, topK } from '../src/lib/chat/retrieve.ts';
import { displayTitle } from '../src/lib/chat/text.ts';
import { HEDGED, PRIVATE, UNANSWERABLE, allGolden, isHit } from '../tests/chat/golden.ts';
import { loadKb } from '../tests/chat/load.ts';
import { mkdir, writeFile } from 'node:fs/promises';

const GATE = { hit3: 0.92, hit5: 0.95 };
const HEDGES = ['none', 'closest', 'declined'];
const flags = new Set(process.argv.slice(2));
if (flags.has('--llm')) {
  console.error('Use npm run chat:device-qa for real browser generation evaluation.');
  process.exit(2);
}

const kb = await loadKb();
const index = buildIndex(kb.chunks);
const golden = allGolden(kb);
const ids = (scores, k) => topK(scores, k).map((i) => kb.chunks[i].id);

let embedder;
let matrix;
if (!flags.has('--bm25')) {
  const started = performance.now();
  embedder = await createBuildEmbedder();
  matrix = new Int8Array(kb.chunks.length * EMBED.dim);
  for (const [i, chunk] of kb.chunks.entries()) matrix.set(quantise(await embedder.embed(`${displayTitle(chunk)}. ${chunk.text}`)), i * EMBED.dim);
  console.log(`Embedded ${kb.chunks.length} chunks with ${EMBED.model} (${EMBED.dtype}) in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

const rankers = { bm25: [], dense: [], fused: [] };
let embedMs = 0;
for (const entry of golden) {
  const bm25 = search(index, entry.q).scores;
  rankers.bm25.push(ids(bm25, 10));
  if (!embedder) continue;
  const started = performance.now();
  const query = await embedder.embed(EMBED.queryPrefix + entry.q);
  embedMs += performance.now() - started;
  const dense = denseScores(query, matrix, kb.chunks.length, EMBED.dim);
  // Dense scores can be negative; rank them all.
  const order = [...dense.keys()].sort((a, b) => dense[b] - dense[a]).slice(0, 10);
  rankers.dense.push(order.map((i) => kb.chunks[i].id));
  rankers.fused.push(ids(ranking(search(index, entry.q), dense).scores, 10));
}

/** The quotes answer with the semantic tier on, as src/scripts/chat/main.ts composes it. */
async function fusedAnswer(q) {
  const result = search(index, q);
  const dense = denseScores(await embedder.embed(EMBED.queryPrefix + q), matrix, kb.chunks.length, EMBED.dim);
  const { scores, top, level } = ranking(result, dense);
  return composeExtractive(q, { top, scores, terms: result.terms, index }, level, kb);
}

function metrics(ranked, entries) {
  const rank = entries.map(({ entry, i }) => ranked[i].findIndex((id) => isHit([id], entry.accept)));
  const at = (k) => rank.filter((r) => r >= 0 && r < k).length / entries.length;
  return { n: entries.length, hit1: at(1), hit3: at(3), hit5: at(5), mrr: rank.reduce((sum, r) => sum + (r < 0 ? 0 : 1 / (r + 1)), 0) / entries.length };
}

const all = golden.map((entry, i) => ({ entry, i }));
const kinds = ['all', ...new Set(golden.map((entry) => entry.kind))];
const pct = (value) => `${(value * 100).toFixed(1)}%`.padStart(7);
console.log(`\n${golden.length} answerable questions, ${kb.chunks.length} chunks\n`);
console.log('ranker  kind          n   hit@1   hit@3   hit@5    MRR');
const results = {};
for (const [name, ranked] of Object.entries(rankers)) {
  if (!ranked.length) continue;
  for (const kind of kinds) {
    const m = metrics(ranked, kind === 'all' ? all : all.filter(({ entry }) => entry.kind === kind));
    if (kind === 'all') results[name] = m;
    console.log(`${name.padEnd(7)} ${kind.padEnd(11)} ${String(m.n).padStart(3)} ${pct(m.hit1)} ${pct(m.hit3)} ${pct(m.hit5)} ${m.mrr.toFixed(3).padStart(6)}`);
  }
}

if (embedder) {
  console.log(`\nQuery embedding: ${(embedMs / golden.length).toFixed(1)} ms on average (Node, ${EMBED.dtype})`);
  if (flags.has('--misses')) {
    for (const { entry, i } of all) {
      if (!isHit(rankers.fused[i].slice(0, 5), entry.accept)) console.log(`MISS  ${entry.q}\n      wanted ${entry.accept.join(', ')}\n      got    ${rankers.fused[i].slice(0, 5).join(', ')}`);
    }
  }
  // The semantic tier may change which passages are shown, never how surely they are worded.
  let plain = 0;
  for (const entry of golden) if (!HEDGES.includes((await fusedAnswer(entry.q)).kind)) plain += 1;
  console.log(`\nWith Smarter search (DENSE_WEIGHT ${DENSE_WEIGHT}, DENSE_CLOSEST ${DENSE_CLOSEST}): ${pct(plain / golden.length).trim()} of answerable questions answered without hedging`);
  const mustHedge = [
    ...UNANSWERABLE.map(({ q, kinds }) => ({ q, kinds })),
    ...HEDGED.map((q) => ({ q, kinds: HEDGES })),
    ...Object.values(PRIVATE).flatMap((questions) => questions.map((q) => ({ q, kinds: ['declined'] }))),
  ];
  const wrong = [];
  for (const { q, kinds } of mustHedge) {
    const answer = await fusedAnswer(q);
    if (!kinds.includes(answer.kind) || answer.passages.slice(1).some((p) => kb.chunks.find((chunk) => chunk.id === p.chunkId).sensitive)) wrong.push(`${answer.kind.padEnd(8)} ${q}  [${answer.passages.map((p) => p.chunkId).join(', ')}]`);
  }
  console.log(`Questions the site must not answer: ${mustHedge.length - wrong.length} of ${mustHedge.length} hedged or declined${wrong.length ? `\n  ${wrong.join('\n  ')}` : ''}`);

  const { hit3, hit5 } = results.fused;
  const passed = hit3 >= GATE.hit3 && hit5 >= GATE.hit5 && wrong.length === 0;
  console.log(`\nFused gate (hit@3 ≥ ${GATE.hit3}, hit@5 ≥ ${GATE.hit5}, nothing unanswerable answered): ${passed ? 'passed' : 'FAILED'}`);
  if (flags.has('--report')) {
    await mkdir('docs/ask-ai', { recursive: true });
    await writeFile('docs/ask-ai/retrieval-evaluation.json', `${JSON.stringify({
      v: 1, date: new Date().toISOString(), kb: kb.hash, chunks: kb.chunks.length,
      model: EMBED.model, dtype: EMBED.dtype, backend: 'Node CPU; cached local embedding model',
      results, queryEmbeddingMeanMs: Number((embedMs / golden.length).toFixed(2)),
      answerableWithoutHedging: plain, refusalChecks: mustHedge.length,
      refusalFailures: wrong, gate: GATE, passed,
      misses: all.filter(({ entry, i }) => !isHit(rankers.fused[i].slice(0, 5), entry.accept))
        .map(({ entry, i }) => ({ question: entry.q, expected: entry.accept, got: rankers.fused[i].slice(0, 5) })),
    }, null, 2)}\n`);
  }
  process.exit(passed ? 0 : 1);
}
