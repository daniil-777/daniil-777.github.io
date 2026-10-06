/** Source-bound recruiter answers and reproducible question families. No invented biography. */
import { matchTrigger } from './retrieve.ts';
import { normalise, words } from './text.ts';
import type { Chunk } from './kb.ts';
import { scopedPortfolioOwner } from './intent.ts';

export interface RecruiterCard {
  id: string;
  intent: string;
  questions: string[];
  answer: string;
  sourceIds: string[];
  status: 'documented' | 'assessment' | 'unknown';
}

const key = (value: string) => normalise(value).replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
const take = (value: string, max = 300) => words(value).slice(0, max).join(' ') + (words(value).length > max ? '…' : '');
const prefixes = ['', 'As a recruiter: ', 'For an interview: ', 'For a hiring manager: ', 'For a technical screen: ',
  'From the public profile: ', 'For our engineering team: ', 'For our AI team: ', 'For a candidate review: ',
  'For an initial conversation: ', 'For a role discussion: ', 'For a recruiter briefing: ', 'For my interview notes: ',
  'For a project discussion: ', 'For a skills assessment: ', 'For an evidence review: ', 'For a candidate introduction: ',
  'For a professional summary: ', 'For a technical interview: ', 'For a research interview: ', 'For a collaboration: ',
  'For a portfolio review: ', 'For our recruiting team: ', 'For our ML team: ', 'For the interview panel: ',
  'For a follow-up discussion: ', 'For a hiring decision: ', 'For a CV review: ', 'For a project walkthrough: ', 'For our team lead: '];
const suffixes = ['', ' Use the public portfolio.', ' Include the evidence.', ' Cite the sources.',
  ' Explain with supporting details.', ' Distinguish facts from assessment.', ' Include relevant context.',
  ' Keep names and figures accurate.', ' Give a structured explanation.', ' Summarize the strongest evidence.',
  ' Explain what is documented.', ' Mention anything that needs confirming.'];

export function thirdPerson(value: string): string {
  return value.replace(/https?:\/\/\S+/g, '').replace(/(?:GitHub|Demo|Code|Live|Paper):\s*(?=[.!]|$)/g, '').replace(/\bI[’']m\b/g, 'Daniil is').replace(/\bI[’']ve\b/g, 'Daniil has')
    .replace(/\bI am\b/g, 'Daniil is').replace(/\bI (build|work|use|teach|focus|develop|create|design|lead|supervise|combine)\b/g, (_, verb: string) => `Daniil ${verb === 'teach' ? 'teaches' : verb === 'focus' ? 'focuses' : verb + 's'}`)
    .replace(/\bI have\b/g, 'Daniil has').replace(/\bI\b/g, 'Daniil').replace(/\b[Mm]y\b/g, 'Daniil’s');
}

/** Expansion stays offline. Variants share evidence and must not be counted as independent facts. */
export function* questionVariants(card: RecruiterCard): Generator<string> {
  const seen = new Set<string>();
  for (const question of card.questions) for (const prefix of prefixes) for (const suffix of suffixes) {
    const q = `${prefix}${question}${suffix}`;
    if (!seen.has(key(q))) { seen.add(key(q)); yield q; }
  }
}

export function buildRecruiterCards(chunks: Chunk[]): RecruiterCard[] {
  const cards: RecruiterCard[] = [];
  const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const add = (id: string, intent: string, questions: string[], ids: string[], answer?: string, status: RecruiterCard['status'] = 'documented') => {
    const sources = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    if (!sources.length || sources.length !== ids.length) return;
    cards.push({ id, intent, questions: [...new Set(questions)], sourceIds: sources.map(c => c.id), status,
      answer: thirdPerson(answer ?? sources.map(c => take(c.text)).join('\n\n')) });
  };

  add('profile', 'profile', ['Tell me about Daniil', 'Introduce Daniil to a recruiter', 'Give me his professional summary', 'What is his background?'], ['site:intro', 'journey:virtamed']);
  add('current-role', 'employment', ['What does Daniil do at VirtaMed?', 'What is his current role?', 'Where does he work now?', 'Summarize his current responsibilities'], ['fact:current-role']);
  add('education', 'education', ['Where did he study?', 'What degrees does Daniil hold?', 'Tell me about his education', 'What is his academic background?'], ['fact:education']);
  add('skills', 'skills', ['What programming languages does he use?', 'What is his technical stack?', 'Which tools does Daniil work with?', 'Summarize his technical skills'], ['site:skills']);
  add('career', 'chronology', ['Walk me through his career', 'What is his career timeline?', 'What jobs has he held?', 'Summarize his work history'], ['rollup:experience']);
  add('research', 'publications', ['What has Daniil published?', 'What are his research publications?', 'Which papers did he coauthor?', 'List his publications'], ['rollup:publications']);
  add('languages', 'languages', ['Which spoken languages does he know?', 'What languages does Daniil speak?'], ['fact:languages']);
  add('impact', 'impact', ['What measurable impact has he delivered?', 'What are his strongest results?', 'Give examples of his technical impact'], ['project:ultrasound-anatomy-detection', 'project:pixel-morph']);
  add('deployment', 'production', ['Could he own an ML feature from prototype through production?', 'Does he have experience deploying machine learning?', 'What is his MLOps experience?', 'Can he turn ML research into a deployed product?'], ['journey:virtamed', 'project:laparoscopic-skills-trainer'],
    'His VirtaMed work covers real-time applications, deployed ML systems and MLOps. That is relevant evidence for taking an ML feature toward production. The exact ownership, team scope and production requirements of a new role should be discussed in an interview.\n\n' + (byId.get('journey:virtamed')?.text ?? ''), 'assessment');
  add('mentoring', 'leadership', ['Has he mentored students?', 'Does he teach AI?', 'What evidence supports his mentoring ability?', 'What is his teaching experience?'], ['journey:virtamed', 'journey:moscow-institute-of-physics-and-technology']);
  add('leadership', 'role-fit', ['Can he be a head of software engineering?', 'Why choose him as an engineering leader?', 'Would he be a good technical lead?', 'Could he lead an AI engineering team?'], ['journey:virtamed', 'site:skills'],
    'Daniil looks like a credible candidate for a hands-on technical leadership role in an AI-focused team. His documented delivery of real-time applications, deployed ML systems and MLOps, together with AI teaching and student supervision, supports that assessment. A past head-of-engineering title, responsibility for hiring and budgets, and management of a large engineering organisation are not documented; those are interview topics.', 'assessment');
  add('patent-status', 'patent', ['Is his patent already granted?', 'Does Daniil have a granted patent?', 'What is the status of his patent?', 'Tell me about his patent application'], ['fact:patent']);
  add('availability', 'hiring-logistics', ['When can he start?', 'What is his notice period?', 'Can he start Monday?', 'Is he available for a new job?'], ['fact:contact'],
    'His start date, notice period and current availability are not documented in the public profile. Contact Daniil through the public contact section to discuss the role and timing.', 'unknown');
  add('management-scope', 'leadership-scope', ['Has he managed 100 engineers?', 'What size teams has he managed?', 'Has he managed engineering managers?', 'Has he been a head of engineering before?'], ['journey:virtamed'],
    'The public profile lists Machine Learning Research Engineer at VirtaMed, with technical delivery, AI teaching and student supervision. It does not list a past head-of-engineering title, team-management headcount, hiring budgets or managing managers. These should be confirmed directly.', 'unknown');

  for (const chunk of chunks) {
    if (chunk.sensitive || chunk.kind === 'document') continue;
    if (chunk.kind === 'project') {
      const title = chunk.title;
      add(`${chunk.id}:overview`, 'project-overview', [`What is ${title}?`, `Summarize ${title}`, `Explain Daniil's work on ${title}`, `What problem does ${title} address?`, `Tell me about the ${title} project`], [chunk.id]);
      const stack = chunk.text.match(/Stack: [\s\S]*?(?=\. (?:[A-Z]|\d)|$)/)?.[0];
      if (stack) add(`${chunk.id}:stack`, 'project-tools', [`What is the stack of ${title}?`, `Which technologies were used for ${title}?`, `What tools did he use in ${title}?`], [chunk.id], stack);
    } else if (chunk.kind === 'section') {
      add(chunk.id, 'project-detail', [`Explain ${chunk.heading} in ${chunk.title}`, `What does ${chunk.heading} mean for ${chunk.title}?`, `Tell me more about ${chunk.title}: ${chunk.heading}`], [chunk.id], take(chunk.text));
    } else if (chunk.kind === 'fact' && chunk.id !== 'fact:how-it-works') {
      const natural = chunk.asks.filter(q => /^(?:what|where|when|how|who|which|why|does|did|has|is|was|can|could|would|tell|show|give|list|explain|summarize)\b/i.test(q) && q.split(/\s+/).length >= 4);
      add(chunk.id, 'personal-fact', [chunk.title, ...natural], [chunk.id]);
    } else if (chunk.kind === 'journey') {
      add(chunk.id, 'experience-detail', [`Describe his experience at ${chunk.heading}`, `What did Daniil do at ${chunk.heading}?`, `Tell me about his time at ${chunk.heading}`], [chunk.id]);
    }
  }
  return cards;
}

/** Exact phrase-family matching avoids turning vague similarity into a fabricated direct answer. */
export function createRecruiterLookup(chunks: Chunk[]) {
  const cards = buildRecruiterCards(chunks);
  const lookup = new Map<string, RecruiterCard>();
  for (const card of cards) for (const q of card.questions) if (!lookup.has(key(q))) lookup.set(key(q), card);
  return { cards, match(question: string): RecruiterCard | undefined {
    if (matchTrigger(question, chunks)?.sensitive) return undefined;
    let bare = question.trim();
    const prefix = prefixes.find(prefix => prefix && bare.toLowerCase().startsWith(prefix.toLowerCase()));
    if (prefix) bare = bare.slice(prefix.length);
    const suffix = suffixes.find(suffix => suffix && bare.toLowerCase().endsWith(suffix.toLowerCase()));
    if (suffix) bare = bare.slice(0, -suffix.length);
    const exact = lookup.get(key(bare));
    if (exact || !scopedPortfolioOwner(question)) return exact;
    // An owner's education query must not pick papers that merely share a year.
    const topic = /\b(?:graduat\w*|stud(?:y|ied|ies)|degrees?|education|academic|school|university|college)\b/i.test(question) ? 'education' :
      /\b(?:where\b.{0,50}\bwork|current role|employer|responsibilities)\b/i.test(question) ? 'current-role' :
      /\b(?:background|professional summary|introduce)\b/i.test(question) ? 'profile' : undefined;
    const card = cards.find(card => card.id === topic);
    if (!card) return undefined;
    return /^\s*(?:did|does|is|was|has|had)\b/i.test(question) ? { ...card,
      answer: 'Here is the documented information relevant to that question. Any additional claims would need separate confirmation:\n\n' + card.answer } : card;
  } };
}
