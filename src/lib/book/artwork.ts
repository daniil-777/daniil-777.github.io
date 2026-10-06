import { CONTOUR_KINDS, generateContour, loadContourModel, type ContourKind, type ContourModel, type ContourPoint } from './contour.ts';
import type { BookTopic } from './model.ts';
import { t } from '../../i18n/client.ts';

export interface BookArt { path: string; accent: string; kind: ContourKind; seed: number }
let loaded: Promise<ContourModel> | undefined;
const kinds: Record<BookTopic, readonly ContourKind[]> = {
  ai: ['shell', 'flower', 'butterfly', 'moon', 'cloud', 'feather', 'lotus', 'ginkgo'],
  profile: ['mountain', 'leaf', 'fern', 'ginkgo', 'swan', 'acorn', 'pebble', 'feather'],
  wellbeing: CONTOUR_KINDS,
};
const captions: Record<ContourKind, string> = {
  leaf: 'Leaves', wave: 'Waves', mountain: 'Mountains', flower: 'Blossoms',
  lotus: 'Lotus', shell: 'Seashells', butterfly: 'Butterflies', moon: 'Crescent moon',
  cloud: 'Clouds', koi: 'Koi', swan: 'Swans', fern: 'Ferns', ginkgo: 'Ginkgo',
  feather: 'Feathers', acorn: 'Acorns', pebble: 'Pebbles',
};

/** Smooth only the learned points; no procedural contour is substituted. */
export function contourPath(points: ContourPoint[], closed: boolean): string {
  if (points.length < 4 || points.some(p => !Array.isArray(p) || p.length !== 2 || Array.from(p).some(value => !Number.isFinite(value) || Math.abs(value) > 1))) throw new Error('Invalid generated contour');
  const p = points.map(([x, y]) => [100 + 85 * x, 100 + 85 * y]);
  if (closed) p[p.length - 1] = [...p[0]];
  const n = p.length;
  const point = (index: number) => closed ? p[((index % (n - 1)) + n - 1) % (n - 1)] : p[Math.min(n - 1, Math.max(0, index))];
  const number = (v: number) => v.toFixed(2);
  let d = `M${number(p[0][0])},${number(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [a, b, c, e] = [point(i - 1), point(i), point(i + 1), point(i + 2)];
    const cp1 = b.map((v, axis) => v + (c[axis] - a[axis]) / 6);
    const cp2 = c.map((v, axis) => v - (e[axis] - b[axis]) / 6);
    d += `C${cp1.map(number).join(',')} ${cp2.map(number).join(',')} ${c.map(number).join(',')}`;
  }
  return d + (closed ? 'Z' : '');
}
export async function generateBookArt(mode: BookTopic, seed: number, signal: AbortSignal): Promise<BookArt> {
  // The shared 209 KB weights load on book selection, never with the homepage.
  loaded ??= loadContourModel().catch(error => { loaded = undefined; throw error; });
  const model = await loaded;
  signal.throwIfAborted();
  const family = kinds[mode].filter(kind => model.metadata.shapes.includes(kind));
  const kind = family[Math.abs(seed) % family.length];
  const main = await generateContour(model, kind, seed, signal);
  const accent = await generateContour(model, kind, seed + 7919, signal);
  return { path: contourPath(main.points, main.closed), accent: contourPath(accent.points, accent.closed), kind, seed };
}
export function applyBookArt(page: HTMLElement, art: BookArt) {
  const svg = page.querySelector<SVGSVGElement>('[data-book-artwork]');
  if (!svg) return;
  svg.dataset.contourSeed = String(art.seed);
  svg.dataset.contourKind = art.kind;
  svg.querySelector('[data-book-contour]')?.setAttribute('d', art.path);
  svg.querySelector('[data-book-contour-accent]')?.setAttribute('d', art.accent);
  const label = page.querySelector('[data-book-art-caption]');
  if (label) label.textContent = t(captions[art.kind]);
}
