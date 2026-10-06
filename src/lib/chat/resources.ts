/** Public attachments and a small, explicit conversational fallback when no model is available. */
import type { Chunk } from './kb.ts';
import { matchProjects, projectAliases, projectText } from './project-names.ts';

export interface Resource {
  id: string;
  kind: 'cv' | 'video' | 'project' | 'demo' | 'code' | 'document' | 'profile';
  title: string;
  url: string;
  description?: string;
  /** Project slug or display title; never a path to private source files. */
  project?: string;
  poster?: string;
  download?: boolean;
}

const KINDS = new Set<Resource['kind']>(['cv', 'video', 'project', 'demo', 'code', 'document', 'profile']);
const HOSTS = new Set([
  'demtsev.com', 'www.demtsev.com', 'github.com', 'daniil-777.github.io',
  'linkedin.com', 'www.linkedin.com', 'scholar.google.com', 'arxiv.org',
  'patents.google.com', 'cadd.ethz.ch', 'fx-regime-radar.fly.dev',
  'doi.org', 'openaccess.thecvf.com',
]);
const cleanText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

function publicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (!(value.startsWith('/') && !value.startsWith('//')) && !value.startsWith('https://')) return false;
  // Check the original path before URL() normalises dot segments; encoded traversal is equally unsafe.
  let path = value.startsWith('/') ? value.split(/[?#]/)[0] : value.replace(/^https:\/\/[^/]+/, '').split(/[?#]/)[0];
  try {
    for (let n = 0; n < 4; n++) {
      if (path.includes('\\') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return false;
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
    if (/[\u0000-\u0020\u007f\\]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path) || /%(?:25|2e|2f|5c)/i.test(path)) return false;
    const parsed = new URL(value, 'https://demtsev.com');
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Only registry metadata creates a link. Model-written URLs never enter this path. */
export function safeResource(value: unknown): value is Resource {
  if (typeof value !== 'object' || value === null) return false;
  const resource = value as Partial<Resource>;
  return cleanText(resource.id, 200) && KINDS.has(resource.kind as Resource['kind']) &&
    cleanText(resource.title, 240) && publicUrl(resource.url) &&
    (resource.description === undefined || cleanText(resource.description, 1500)) &&
    (resource.project === undefined || cleanText(resource.project, 240)) &&
    (resource.poster === undefined || publicUrl(resource.poster)) &&
    (resource.download === undefined || typeof resource.download === 'boolean');
}

const normal = projectText;
const contains = (question: string, phrase: string) => phrase.length > 2 && ` ${question} `.includes(` ${phrase} `);
const workSlug = (url: string) => {
  try { return new URL(url, 'https://demtsev.com').pathname.match(/^\/work\/([^/]+)(?:\/|$)/)?.[1]; }
  catch { return undefined; }
};

/** Resource-only requests may replace search snippets; explanations keep their answer. */
export function requestsResources(question: string): boolean {
  const q = normal(question);
  if (/\b(?:explain|why|how (?:does|do|is|are)|describe|analyse|analyze|tell me about)\b/.test(q)) return false;
  return /\b(?:show|watch|send|share|download|open|link|links|where can i (?:find|get)|can i (?:get|try)|try (?:it|the|his|your))\b/.test(q) ||
    /\b(?:try|where is (?:the )?(?:source|code))\b/.test(q) ||
    /^(?:and |also |what about |how about )?(?:his |your |the |its )?(?:cv|resume|video|videos|showreel|demo|github|paper|pdf|linkedin|source code|source|code|repository|repo)\??$/.test(q) ||
    /(?:скача|покаж|пришли|видео|резюме|lebenslauf|télécharger|descargar|视频)/i.test(question);
}

/** Intent selects the attachment type; project context selects its subject. */
export function selectResources(question: string, resources: Resource[], sources: { url: string }[] = [], lastQuestion?: string, lastUrl?: string): Resource[] {
  const available = resources.filter(safeResource);
  const q = normal(question);
  const kinds = new Set<Resource['kind']>();
  if (/lebenslauf|résumé|резюме|currículum|curriculo/i.test(question)) kinds.add('cv');
  if (/видео|ролик|视频/i.test(question)) kinds.add('video');
  if (/демо|демонстрац/i.test(question)) kinds.add('demo');
  if (/стать[яи]|публикац/i.test(question)) kinds.add('document');
  if (/\b(?:cv|curriculum vitae|resume)\b/.test(q) && !/^resume (?:our|the|this|that|where)\b/.test(q)) kinds.add('cv');
  if (/\b(?:videos?|showreel|demo reel|clips?|footage)\b/.test(q)) kinds.add('video');
  if (/\b(?:demo|demos|live app|try it|try them)\b/.test(q) && !/\bdemo reel\b/.test(q) || (/\bapp\b/.test(q) && requestsResources(question))) kinds.add('demo');
  const github = /\b(?:github|git hub)\b/.test(q);
  if (github || /\b(?:source code|repositories|repository|repos?|code link)\b/.test(q) || (requestsResources(question) && /\b(?:code|source)\b/.test(q) && !/\bsource (?:data|of inspiration)\b/.test(q))) kinds.add('code');
  if (/\b(?:papers?|publications?|patent|posters?|documents?)\b/.test(q) || (!kinds.has('cv') && /\bpdfs?\b/.test(q))) kinds.add('document');
  if (/\b(?:linkedin|linked in|scholar|profiles?|social links)\b/.test(q) || github) kinds.add('profile');
  if (/\b(?:project|portfolio)\b/.test(q) && /\b(?:link|links|open|visit|show|share|send)\b/.test(q)) kinds.add('project');
  const groups = new Map<string, Set<string>>();
  const keyOf = (resource: Resource) => normal(resource.project ?? workSlug(resource.url) ?? '');
  for (const resource of available) {
    const key = keyOf(resource);
    if (!key) continue;
    const aliases = groups.get(key) ?? projectAliases(resource.project ?? workSlug(resource.url) ?? '');
    aliases.add(key);
    const slug = workSlug(resource.url);
    if (slug) aliases.add(normal(slug));
    if (resource.kind === 'project') aliases.add(normal(resource.title));
    groups.set(key, aliases);
  }
  const named = (text: string) => matchProjects(text, groups);
  let projects = named(question);
  if (!kinds.size && projects.length && requestsResources(question)) kinds.add(/\btry\b/.test(q) ? 'demo' : 'project');
  const continues = /^(?:and|also|what about|how about)\b|\b(?:it|its|that|the video|the demo|the github|the paper)\b/.test(q);
  const codeRequested = /\b(?:source|code|repositories|repository|repos?)\b/.test(q);
  const personalProfile = kinds.has('profile') && (/\b(?:his|your|daniil|emtsev|profiles?)\b/.test(q) || (!projects.length && !continues && !codeRequested));
  // A request for the whole portfolio or a showreel stands on its own.
  const broad = (personalProfile && !projects.length) || /\b(?:all|showreel|demo reel|your work|his work|whole portfolio|entire portfolio|his research|his papers|research papers|publications)\b/.test(q);
  const projectForUrl = (url: string) => {
    try {
      const address = new URL(url, 'https://demtsev.com');
      return available.find(resource => {
        const known = new URL(resource.url, 'https://demtsev.com');
        return keyOf(resource) && known.origin === address.origin && known.pathname === address.pathname;
      });
    } catch { return undefined; }
  };
  if (!projects.length && !broad) {
    const previous = lastUrl && projectForUrl(lastUrl);
    if (continues && previous) projects = [keyOf(previous)];
    if (!projects.length) projects = [...groups].filter(([, aliases]) => sources.some((source) => {
      const project = projectForUrl(source.url);
      return project !== undefined && aliases.has(keyOf(project));
    })).map(([key]) => key);
    if (!projects.length && lastQuestion) projects = named(lastQuestion);
  }
  if (!kinds.size && projects.length && /\b(?:open|visit|try)\b/.test(q)) kinds.add(/\btry\b/.test(q) ? 'demo' : 'project');
  if (!kinds.size) return [];
  const wanted = new Set(projects);
  // A bare GitHub request means his profile. Named-project follow-ups mean that project's code.
  if (github && (personalProfile || !wanted.size) && !codeRequested) kinds.delete('code');
  const profile = (resource: Resource) => {
    const label = normal(`${resource.title} ${resource.url}`);
    const linkedin = /\b(?:linkedin|linked in)\b/.test(q), scholar = /\bscholar\b/.test(q);
    return !(github || linkedin || scholar) || (github && /\bgithub\b/.test(label)) || (linkedin && /\blinkedin\b/.test(label)) || (scholar && /\bscholar\b/.test(label));
  };
  const priority: Resource['kind'][] = ['cv', 'video', 'demo', 'code', 'document', 'profile', 'project'];
  const matching = available.filter((resource) => {
    if (!kinds.has(resource.kind)) return false;
    if (resource.kind === 'document' && /\bpatent\b/.test(q) && !/\b(?:papers?|publications?|documents?)\b/.test(q) && !/patent/i.test(`${resource.id} ${resource.url} ${resource.description}`)) return false;
    if (resource.kind === 'cv') return true;
    if (resource.kind === 'profile') return (!wanted.size || personalProfile) && profile(resource);
    return !wanted.size || wanted.has(keyOf(resource));
  });
  const seen = new Set<string>();
  return matching.sort((a, b) => {
    const type = priority.indexOf(a.kind) - priority.indexOf(b.kind);
    if (type) return type;
    if (!wanted.size && a.kind === 'video') return Number(/showreel/i.test(`${b.id} ${b.title}`)) - Number(/showreel/i.test(`${a.id} ${a.title}`));
    return 0;
  }).filter((resource) => {
    if (seen.has(resource.url)) return false;
    seen.add(resource.url);
    return true;
  }).slice(0, 4);
}

export interface ConversationalReply { text: string[]; cites: string[]; followUps?: string[] }

/** No live feeds are available to the local model. Never turn current-data requests into guesses. */
export function offlineReply(question: string): ConversationalReply | undefined {
  if (!/\b(?:weather (?:in|today|tomorrow)|(?:latest|today.s|current) (?:news|prices?|exchange rates?|stock|president)|(?:stock|share|bitcoin|crypto) price|current (?:ceo|version)|who is (?:the )?(?:current )?president)\b/i.test(question)) return undefined;
  return { text: ['This local assistant has no live weather, news, prices or current-status feed. Please check a current source for that information. I can explain the underlying concepts or help explore the published portfolio.'], cites: [], followUps: ['What does Daniil do at VirtaMed?', 'Show me his CV'] };
}

const engineeringLeadership = (q: string) => /\b(?:head of (?:software )?engineering|cto|chief technology officer|engineering manager|technical lead|tech lead)\b/.test(q);
const hiring = (q: string) => /\b(?:hir(?:e|ing)|recruit(?:ing)?|job (?:offer|opportunity)|career opportunity)\b/.test(q) ||
  /\b(?:fit|suitable|qualified|candidate|match)\b.{0,70}\b(?:role|position|team|job|company)\b/.test(q) ||
  /\b(?:role|position|team|job)\b.{0,70}\b(?:fit|suitable|qualified|candidate|match)\b/.test(q) ||
  /\b(?:can|could|would|should)\b.{0,25}\b(?:you|u|he|him|daniil)\b.{0,35}\b(?:join|work)\b.{0,25}\b(?:team|company|us|as)\b/.test(q) ||
  (/\b(?:can|could|would|should)\b.{0,25}\b(?:you|u|he|him|daniil)\b.{0,35}\b(?:be|become|lead|serve)\b/.test(q) && engineeringLeadership(q));

/** Explicit intents only: ordinary factual questions keep the existing quotation pipeline. */
export function conversationalFallback(question: string, chunks: Chunk[], lastQuestion?: string): ConversationalReply | undefined {
  const q = normal(question);
  const byId = new Map(chunks.filter((chunk) => !chunk.sensitive).map((chunk) => [chunk.id, chunk]));
  const intro = byId.get('site:intro');
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|what can you do|how can you help)(?: there| daniil| assistant| ai)?$/.test(q)) {
    return { text: ['Hello! You can ask about Daniil’s experience, projects, research, or a role you’re considering. You can also ask for his résumé, demos, or videos.'], cites: intro ? [intro.id] : [], followUps: ['What does Daniil do at VirtaMed?', 'Show me videos of his work'] };
  }
  const continues = /^(?:and|also|what about|how about|would that|could that|why|tell me more)\b/.test(q);
  const employment = hiring(q) || (continues && lastQuestion !== undefined && hiring(normal(lastQuestion)));
  if (employment) {
    const engineering = byId.get('journey:virtamed');
    if (engineeringLeadership(q) && engineering && /\bMLOps\b/.test(engineering.text) && /\b(?:supervising|supervision|mentoring)\b/i.test(engineering.text) && /\b(?:browser|real-time)\b/i.test(engineering.text)) {
      const title = q.match(/\b(?:head of (?:software )?engineering|cto|chief technology officer|engineering manager|technical lead|tech lead)\b/)![0];
      return {
        text: [
          `Yes—Daniil looks like a credible candidate for a hands-on ${title === 'cto' ? 'CTO' : title} role, especially in an AI-focused team. His work covers real-time applications, deployed machine-learning systems and MLOps, and he teaches AI and supervises students. That gives him relevant technical depth and mentoring experience to build on.`,
          'For a larger engineering organisation, the discussion should also cover hiring, people management and responsibility across multiple teams. The right fit depends on the scope of the role.',
        ],
        cites: [engineering.id],
        followUps: ['What does Daniil do at VirtaMed?', 'Show me his CV'],
      };
    }
    const role = byId.get('fact:current-role') ?? byId.get('journey:virtamed') ?? intro;
    const technical = role && /\b(?:AI Research Engineer|Machine Learning Research Engineer|AI research engineer)\b/i.test(role.text);
    const cited: string[] = technical ? [role.id] : [];
    const paragraphs: string[] = [];
    if (technical) paragraphs.push('Daniil’s documented background is in AI research and machine-learning engineering.');
    const finance = /\b(?:(?:financial|finance) (?:manager|management|director)|chief financial officer|cfo|accountant|accounting|financial controller|portfolio manager)\b/.test(q) ||
      (continues && lastQuestion !== undefined && /\b(?:financial|finance) (?:manager|management|director)\b/.test(normal(lastQuestion)));
    const fx = byId.get('project:fx-regime-radar');
    if (finance && fx && /\b(?:currency|market regime|EUR\/USD)\b/i.test(fx.text)) {
      paragraphs.push('FX Regime Radar is his currency-market regime and risk analysis project. That suggests transferable analytical and software skills for finance.');
      cited.push(fx.id);
    }
    if (finance) {
      const published = chunks.filter((chunk) => !chunk.sensitive).map((chunk) => normal(chunk.text)).join(' ');
      const gaps = ['accounting', 'budgeting', 'financial reporting', 'finance-team management'].filter((skill) => !contains(published, normal(skill)));
      if (gaps.length) {
        const list = gaps.length > 1 ? `${gaps.slice(0, -1).join(', ')}, or ${gaps.at(-1)}` : gaps[0];
        paragraphs.push(`The portfolio does not establish ${list} experience.`);
      }
      paragraphs.push('It cannot confirm his suitability for a financial manager position.');
    }
    else paragraphs.push('Fit depends on the responsibilities of the role and the skills your team needs. The site does not confirm his availability or make a hiring commitment.');
    const contact = byId.get('fact:contact') ?? byId.get('site:contact');
    paragraphs.push(contact ? 'Share the job description with Daniil by email to discuss the fit and his availability.' : 'Discuss the job description, requirements, and availability directly with Daniil.');
    if (contact) cited.push(contact.id);
    return { text: [paragraphs.join(' ')], cites: [...new Set(cited)], followUps: finance && fx ? ['What is FX Regime Radar?', 'What does Daniil do at VirtaMed?'] : ['What does Daniil do at VirtaMed?', 'Which projects run AI in the browser?'] };
  }
  if (/\b(?:capital of|weather (?:in|today|tomorrow)|recipe for|who (?:is|was) the president|write (?:me )?(?:a |an )?(?:poem|essay|story|code)|solve (?:this |the )?(?:equation|math problem))\b/.test(q) && !/\b(?:daniil|emtsev|project|portfolio)\b/.test(q)) {
    return { text: ['This assistant is grounded in Daniil’s portfolio. For a general question, use a general-purpose assistant; here you can ask about his experience, projects, research, or a role you’re considering.'], cites: intro ? [intro.id] : [], followUps: ['Which projects run AI in the browser?', 'What has he published?'] };
  }
  return undefined;
}
