/** Reviewed aliases identify published projects; longest exact spans win. */
export const projectText = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SHORT_NAMES: Record<string, string[]> = {
  'universal-ai-proctor': ['cueveris'],
  'astro-pilot': ['spaceship', 'spacecraft'],
  'laparoscopic-skills-trainer': ['laparoscopic trainer', 'lap trainer'],
  'dynamic-plane-onet': ['dynamic plane', 'dynamic planes', 'occupancy networks'],
  'camera-pose-2d3d': ['camera pose', '6d camera pose'],
  'loss-landscape-barcodes': ['barcodes', 'loss landscape', 'loss landscapes'],
  'de-novo-drug-design': ['drug design', 'de novo drug design'],
  'alzheimers-gan': ['alzheimers', 'alzheimer', 'brain mri'],
  'fx-regime-radar': ['regime radar'],
};
export function projectAliases(slug: string, title?: string): Set<string> {
  return new Set([slug, title ?? '', ...(SHORT_NAMES[slug] ?? [])].map(projectText).filter(Boolean));
}
const TOPICAL = new Set(['spaceship', 'spacecraft', 'barcodes', 'loss landscape', 'loss landscapes', 'drug design', 'de novo drug design', 'alzheimers', 'alzheimer', 'brain mri', 'camera pose', '6d camera pose', 'occupancy networks']);
export function matchProjects(question: string, groups: Map<string, Set<string>>, allowTopical = true): string[] {
  const q = ` ${projectText(question)} `;
  const owners = new Map<string, Set<string>>();
  for (const [key, aliases] of groups) for (const alias of aliases) {
    const keys = owners.get(alias) ?? new Set<string>(); keys.add(key); owners.set(alias, keys);
  }
  const spans: { key: string; start: number; end: number }[] = [];
  for (const [alias, keys] of owners) {
    if (keys.size !== 1 || (!allowTopical && TOPICAL.has(alias))) continue;
    let start = q.indexOf(` ${alias} `);
    while (start >= 0) {
      spans.push({ key: [...keys][0], start, end: start + alias.length + 1 });
      start = q.indexOf(` ${alias} `, start + 1);
    }
  }
  const kept: typeof spans = [];
  for (const span of spans.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (!kept.some(other => span.start < other.end && span.end > other.start)) kept.push(span);
  }
  return [...new Set(kept.sort((a, b) => a.start - b.start).map(span => span.key))];
}
