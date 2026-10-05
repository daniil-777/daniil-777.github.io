/**
 * Checks the built site in build/: npm run check:build (after `npm run build`)
 *
 *   - eager homepage downloads stay inside the original chat budget and the
 *     separately bounded architecture launcher and seven-language catalogs;
 *   - nothing of the chat or its models is loaded eagerly;
 *   - kb.json is public-only and every source it cites exists;
 *   - vectors.bin belongs to kb.json;
 *   - no private path, client name or phone number anywhere in build/.
 *
 *   --record   write the current sizes of the home page as the new baseline
 *   --vectors  fail, instead of warn, when the site was built without vectors (used before a deploy)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { decodeVectors, vectorsMismatch } from '../src/lib/chat/embed.ts';
import { assertPublic, privacyProblems } from '../src/lib/chat/kb.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const budgetFile = path.join(root, 'scripts/chat-budget.json');
/** Bytes of gzip the chat may add for a visitor who never opens it. */
const ALLOWANCE = { html: 900, css: 400, js: 600 };
const architectureBudget = JSON.parse(readFileSync(path.join(root, 'scripts/architecture-budget.json'), 'utf8'));
const localizationBudget = JSON.parse(readFileSync(path.join(root, 'scripts/i18n-budget.json'), 'utf8'));
const BINARY_MAX = 1024 * 1024;

const problems = [];
const warnings = [];
const gzip = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const inBuild = (url) => path.join(build, decodeURIComponent(url.split(/[?#]/)[0]));

if (!existsSync(path.join(build, 'index.html'))) {
  console.error('build/index.html is missing. Run: npm run build');
  process.exit(1);
}

/** The scripts a page loads without any interaction: its script tags, modulepreloads, and their static imports. */
function eagerScripts(html) {
  const found = new Set();
  const visit = (url) => {
    if (found.has(url) || !existsSync(inBuild(url))) return;
    found.add(url);
    const code = readFileSync(inBuild(url), 'utf8');
    for (const match of code.matchAll(/(?:^|[;}\s])import\s*(?:[\w${},*\s]+from\s*)?["']([^"']+)["']/g)) visit(path.posix.join(path.posix.dirname(url), match[1]));
  };
  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) visit(match[1]);
  for (const match of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) visit(match[1]);
  return [...found];
}

const home = readFileSync(path.join(build, 'index.html'), 'utf8');
const hasArchitecture = home.includes('data-architecture');
const hasLocalization = home.includes('data-i18n-pack');
const styles = [...home.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((match) => match[1]);
const scripts = eagerScripts(home);
const sizes = {
  html: gzip(path.join(build, 'index.html')),
  css: styles.reduce((sum, url) => sum + gzip(inBuild(url)), 0),
  js: scripts.reduce((sum, url) => sum + gzip(inBuild(url)), 0),
};

if (process.argv.includes('--record')) {
  writeFileSync(budgetFile, `${JSON.stringify({ note: 'gzip -9 bytes of build/index.html and of the CSS and JS it loads eagerly', page: '/', ...sizes }, null, 2)}\n`);
  console.log(`Recorded the baseline: html ${sizes.html}, css ${sizes.css}, js ${sizes.js} bytes (gzip)`);
} else if (!existsSync(budgetFile)) {
  problems.push('scripts/chat-budget.json is missing. Record a baseline with: npm run check:build -- --record');
} else {
  const baseline = JSON.parse(readFileSync(budgetFile, 'utf8'));
  for (const kind of ['html', 'css', 'js']) {
    const growth = sizes[kind] - baseline[kind];
    const feature = hasArchitecture ? architectureBudget.allowance[kind] : 0;
    const localization = hasLocalization ? localizationBudget.allowance[kind] : 0;
    const allowance = ALLOWANCE[kind] + feature + localization;
    console.log(`${kind.padEnd(4)} ${String(sizes[kind]).padStart(6)} bytes gzip (baseline ${baseline[kind]}, ${growth >= 0 ? '+' : ''}${growth}, chat +${ALLOWANCE[kind]}, architecture +${feature}, localization +${localization})`);
    if (growth > allowance) problems.push(`eager ${kind} grew by ${growth} bytes gzip; the combined budget is ${allowance}`);
  }
}

// Nothing of the chat may load before it is opened.
const endpoint = process.env.PUBLIC_CHAT_ENDPOINT;
for (const url of scripts) {
  const code = readFileSync(inBuild(url), 'utf8');
  for (const word of ['onnxruntime', 'transformers', 'huggingface', 'tf-core', 'tf-backend', 'decoder.bin', 'anchors-0.bin', 'createModel', '"chunks":[', ...(endpoint ? [endpoint] : [])]) {
    if (code.includes(word)) problems.push(`eager script ${url} contains "${word}"`);
  }
}

const files = readdirSync(build, { recursive: true }).map(String).filter((file) => statSync(path.join(build, file)).isFile());
if (hasLocalization) {
  for (const file of files.filter((file) => file.endsWith('.html'))) {
    const html = readFileSync(path.join(build, file), 'utf8');
    const pack = html.match(/<script[^>]*data-i18n-pack[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (pack && gzipSync(pack, { level: 9 }).length > localizationBudget.pageCatalogMaxGzipBytes) problems.push(`${file}: language catalog exceeds its explicit budget`);
  }
}
if (hasArchitecture) {
  if (/<iframe[^>]+src=["'][^"']*architecture\//.test(home)) problems.push('architecture iframe loads eagerly');
  const activatedBytes = files.filter((file) => file.startsWith('architecture/')).reduce((sum, file) => sum + statSync(path.join(build, file)).size, 0);
  console.log(`architecture activated local files: ${activatedBytes} bytes (cap ${architectureBudget.activatedLocalMaxBytes}; external graphics runtime loads on visibility or Play)`);
  if (activatedBytes > architectureBudget.activatedLocalMaxBytes) problems.push('architecture activated local payload exceeds its explicit budget');
}
if (home.includes('data-live-preview="2d"')) {
  if (/<iframe[^>]+src=["'][^"']*drawings\//.test(home)) problems.push('drawing iframe loads eagerly');
  const drawingBytes = files.filter((file) => file.startsWith('drawings/')).reduce((sum, file) => sum + statSync(path.join(build, file)).size, 0);
  console.log(`drawing activated local files: ${drawingBytes} bytes (cap ${architectureBudget.drawingActivatedLocalMaxBytes}; shares the cached graphics runtime with the 3D preview)`);
  if (drawingBytes > architectureBudget.drawingActivatedLocalMaxBytes) problems.push('drawing activated local payload exceeds its explicit budget');
}
for (const file of files) {
  if (/\.(wasm|onnx)$/.test(file) && statSync(path.join(build, file)).size > BINARY_MAX) problems.push(`${file} is a model or runtime binary over 1 MB`);
}

// The knowledge base: public only, and every source resolves to a page and an element.
const kbFile = path.join(build, 'chat/kb.json');
if (!existsSync(kbFile)) {
  problems.push('build/chat/kb.json is missing');
} else {
  const kb = JSON.parse(readFileSync(kbFile, 'utf8'));
  try {
    assertPublic(kb);
  } catch (error) {
    problems.push(error.message);
  }
  const pages = new Map();
  for (const chunk of kb.chunks) {
    const [pathname, anchor] = chunk.url.split('#');
    const file = path.join(inBuild(pathname), 'index.html');
    if (!pages.has(file)) pages.set(file, existsSync(file) ? readFileSync(file, 'utf8') : null);
    const html = pages.get(file);
    if (html === null) problems.push(`${chunk.id}: page ${pathname.split('?')[0]} does not exist`);
    else if (anchor && !html.includes(`id="${anchor}"`)) problems.push(`${chunk.id}: no element with id "${anchor}" on ${pathname.split('?')[0]}`);
  }
  const vectorsFile = path.join(build, 'chat/vectors.bin');
  if (!existsSync(vectorsFile)) {
    problems.push('build/chat/vectors.bin is missing');
  } else {
    const vectors = decodeVectors(new Uint8Array(readFileSync(vectorsFile)));
    if (kb.embedding === null) {
      if (vectors.count !== 0) problems.push('kb.json says there are no vectors, but vectors.bin has some');
      (process.argv.includes('--vectors') ? problems : warnings).push('THE SITE WAS BUILT WITHOUT VECTORS: "Smarter search" will not be available. Was the embedding model unreachable?');
    } else {
      const mismatch = vectorsMismatch(vectors, kb);
      if (mismatch) problems.push(`vectors.bin: ${mismatch}`);
    }
  }
  console.log(`kb.json ${kb.chunks.length} chunks, ${gzip(kbFile)} bytes gzip; hash ${kb.hash}; vectors ${kb.embedding ? kb.embedding.count : 'none'}`);
}

// Nothing private anywhere in the text files of the build.
for (const file of files.filter((name) => /\.(html|json|xml|txt|js|css|svg)$/.test(name))) {
  const content = readFileSync(path.join(build, file), 'utf8');
  // Scripts and styles are full of long numbers; only prose and data are checked for phone numbers.
  const prose = /\.(js|css|svg)$/.test(file) ? null : content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
  // Minified third-party code is full of short path-like strings ("dist/", "me/"); there only the unmistakable names count.
  const found = new Set(prose === null ? [] : privacyProblems(content).filter((problem) => /private folder/.test(problem)));
  if (/ethicon/i.test(content)) found.add('the word "ethicon"');
  if (/(?<![\w/])(?:MIPT|Amgen|VirtaMed)\/[\w.-]/.test(content)) found.add('a path into a private folder');
  if (prose !== null && privacyProblems(prose).some((problem) => /phone/.test(problem))) found.add('something that looks like a phone number');
  for (const problem of found) problems.push(`build/${file} contains ${problem}`);
}

for (const warning of warnings) console.warn(`\nWARNING: ${warning}\n`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log('The build passes every check.');
