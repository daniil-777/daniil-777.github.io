/** Bounded evidence selection shared by browser and local backend. */
import { tokenise, type Index } from './bm25.ts';
import { topK, subjectTerms } from './retrieve.ts';
import { createRecruiterLookup, thirdPerson } from './recruiter.ts';
import { searchInContext, type Last } from '../../scripts/chat/pipeline.ts';
import type { Chunk } from './kb.ts';
import { matchProjects, projectAliases } from './project-names.ts';

/** Match full project names, preferring the longest name where titles overlap. */
function namedProjects(question: string, chunks: Chunk[]): Chunk[] {
  const projects = chunks.filter(c => c.kind === 'project');
  const groups = new Map(projects.map(c => [c.id, projectAliases(c.id.replace(/^project:/, ''), c.title)]));
  const scoped = /\b(?:his|your|Daniil|Emtsev|portfolio|project|candidate|applicant)\b/i.test(question);
  return matchProjects(question, groups, scoped).map(id => projects.find(c => c.id === id)!);
}

export function createRag(chunks: Chunk[], index: Index) {
  const recruiter = createRecruiterLookup(chunks);
  const subjects = subjectTerms(chunks);
  const byId = new Map(chunks.map(c => [c.id, c]));
  return { recruiter,
    detailed(question: string, last?: Last): { text: string[]; cites: string[] } | undefined {
      const long = /\b(?:in (?:more )?detail|detailed|in depth|walk me through|tell me more|expand|longer|compare|elaborate)\b/i.test(question);
      const result = /\b(?:results?|performance|accuracy|improve[ds]?|outcomes?|impact)\b/i.test(question);
      if (!long && !result) return undefined;
      let explicit = namedProjects(question, chunks);
      if (!explicit.length && result && /\b(?:Daniil|he|his|him)\b/i.test(question)) {
        const projects = chunks.filter(c => c.kind === 'project'), terms = new Set(tokenise(question));
        // Only unique title words identify a project; ambiguous terms do not.
        const anchored = projects.filter(project => tokenise(project.title).some(term => term.length > 4 && terms.has(term) && projects.filter(p => tokenise(p.title).includes(term)).length === 1));
        if (anchored.length === 1) explicit = anchored;
      }
      const named = explicit.length ? explicit : chunks.filter(c => c.kind === 'project' &&
        !!last?.url && c.url === last.url.split('#')[0] && /^(?:and|also|tell me more|expand|what about|explain|elaborate)/i.test(question));
      if (!named.length) return undefined;
      const selected = named.flatMap(project => {
        const sections = chunks.filter(c => c.kind === 'section' && c.title === project.title);
        const outcome = sections.find(c => /result|outcome/i.test(c.heading));
        if (result) return [outcome ?? project];
        return named.length > 1 ? [project, ...(outcome ? [outcome] : [])] : [project, ...sections.slice(0, 3)];
      }).slice(0, 5);
      return { text: selected.map(c => `${c.heading ? c.heading + ': ' : ''}${thirdPerson(c.text)}`), cites: selected.map(c => c.id) };
    },
    retrieve(question: string, last?: Last): Chunk[] {
    const card = recruiter.match(question);
    const { result } = searchInContext(index, question, last, subjects, chunks);
    const preferred = new Set(card?.sourceIds ?? []);
    // A comparison needs the overview of each named project, not five sections of one.
    for (const chunk of namedProjects(question, chunks)) preferred.add(chunk.id);
    const leadership = /\b(?:leadership|leader|technical lead|head of|cto|mentor|teaching|production|mlops)\b/i;
    if (leadership.test(question) || (/^\s*(?:what about|how about|and|but|could|would)\b/i.test(question) && leadership.test(last?.q ?? ''))) preferred.add('journey:virtamed');
    const selected = [...preferred].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    for (const i of topK(result.scores, 8)) if (!selected.some(c => c.id === chunks[i].id)) selected.push(chunks[i]);
    return selected.filter(c => !c.sensitive).slice(0, 8);
  } };
}
