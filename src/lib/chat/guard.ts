/**
 * The check every model-written block passes before it is shown: its numbers,
 * years, names and a list of grave or private claims must occur in the chunks
 * it cites. Deterministic and pure, so the same function guards cloud and
 * on-device answers. It checks words, not meaning: a false sentence built
 * only from words of its source ("He left VirtaMed") still passes.
 */
import { site } from '../../data/site.ts';
import { EMAIL, PHONE, type Chunk } from './kb.ts';
import { displayTitle, looksForeign, words } from './text.ts';

export const ANSWER_WORDS_MAX = 160;
export const ALLOWED_NAMES = [site.name, site.name.split(' ')[0]];
export const ABSTENTIONS = ['I don’t know that', 'I can only answer questions about Daniil'];

export interface GuardState {
  /** Chunks cited by earlier blocks of the same answer. */
  cited: Chunk[];
  words: number;
}
export const newGuardState = (): GuardState => ({ cited: [], words: 0 });

export type GuardResult = { ok: true } | { ok: false; reason: string };

const apostrophes = (text: string) => text.replace(/[’‘`]/g, "'");

export function isAbstention(text: string): boolean {
  const start = apostrophes(text.trim());
  return [
    "I don't know that. The site doesn't cover it.",
    'I can only answer questions about Daniil and his work on this site.',
  ].some((abstention) => start === abstention);
}

const IDENTIFIER = /\b[A-Z]{2}\d{6,}[A-Z]?\d?\b/g;
const SEPARATOR = String.raw`\s*(?:-|→|->|\bto\b)\s*`;

/** Counts written as words. "One" is left out: it is mostly a pronoun. */
const NUMBER_WORDS: Record<string, string> = {
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100', thousand: '1000',
};
const NUMBER_WORD = new RegExp(String.raw`\b(?:${Object.keys(NUMBER_WORDS).join('|')})\b`, 'g');

/**
 * Lower case, compatibility forms folded, every dash a hyphen, "1,024" as
 * "1024", "0,5" as "0.5", "four" as "4". A plain space never joins two
 * numbers: "in 2022 150 trainees" stays two numbers.
 */
function canonical(text: string): string {
  return apostrophes(text.normalize('NFKD'))
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/(\d)[,\u00a0\u2009\u202f](?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(NUMBER_WORD, (word) => NUMBER_WORDS[word]);
}

interface Facts {
  numbers: Set<string>;
  percents: Set<string>;
  identifiers: Set<string>;
  emails: Set<string>;
}

/** Every number that stands by itself: "9 patents", "60%", "four years"; not the digit in "3D" or "v2". */
function facts(text: string): Facts {
  const identifiers = new Set((text.match(IDENTIFIER) ?? []).map((id) => id.toLowerCase()));
  const emails = new Set((text.match(EMAIL) ?? []).map((address) => address.toLowerCase()));
  const rest = canonical(text.replace(IDENTIFIER, ' ').replace(EMAIL, ' '));
  const numbers = new Set<string>();
  const percents = new Set<string>();
  for (const match of rest.matchAll(/(?<![\p{L}\d.])\d+(?:\.\d+)?(?![\p{L}\d])/gu)) {
    const value = match[0];
    const after = rest.slice(match.index + value.length);
    // In "60 → 90%" and "60% to 90%" both ends are percentages.
    if (/^\s*%/.test(after) || new RegExp(`^${SEPARATOR}\\d+(?:\\.\\d+)?\\s*%`).test(after)) percents.add(value);
    numbers.add(value);
  }
  return { numbers, percents, identifiers, emails };
}

/** The numbers, percentages, identifiers and emails a block states: what must be backed by a source. */
export function extractHardFacts(text: string): string[] {
  const found = facts(text);
  return [...new Set([...found.numbers, ...[...found.percents].map((p) => `${p}%`), ...found.identifiers, ...found.emails])];
}

const CAPITALISED = /^[A-Z][\p{L}\p{N}'-]*$/u;

/** Runs of capitalised words, e.g. "Google DeepMind" or "Tesla". A run opening a sentence is flagged. */
function names(text: string): { run: string[]; opensSentence: boolean }[] {
  const runs: { run: string[]; opensSentence: boolean }[] = [];
  let run: string[] = [];
  let opens = true;
  let sentenceStart = true;
  const flush = () => {
    if (run.length >= 1) runs.push({ run, opensSentence: opens });
    run = [];
  };
  for (const raw of apostrophes(text).split(/\s+/).filter(Boolean)) {
    const word = raw.replace(/^[("“]+/, '').replace(/[)"”.,;:!?]+$/, '');
    const possessive = /'s$/.test(word);
    const bare = word.replace(/'s$/, '').replace(/-(?:focused|driven|based|enabled|powered|related|oriented)$/i, '');
    // Assistant contractions and common technical adjectives are not new personal names.
    if (/^I(?:'m|'ve|'d|'ll)?$/.test(bare)) { flush(); sentenceStart = false; continue; }
    if (CAPITALISED.test(bare)) {
      if (run.length === 0) opens = sentenceStart;
      run.push(bare);
    } else {
      flush();
    }
    if (possessive || /[.,;:!?)"”]$/.test(raw)) flush();
    sentenceStart = /[.!?]["”)]*$/.test(raw);
  }
  flush();
  return runs;
}

const plain = (text: string) => ` ${canonical(text).replace(/'s\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Is the name in the sources: as a phrase, or at least every word of it? */
function nameKnown(run: string[], haystack: string): boolean {
  if (haystack.includes(plain(run.join(' ')))) return true;
  return run.every((word) => haystack.includes(plain(word)));
}

/**
 * A capitalised word or run of words that the sources do not contain. The
 * word that opens a sentence is capitalised anyway and is not counted. Single
 * words are only checked when the answer is in English (`single`): German
 * capitalises every noun.
 */
function unsupportedName(text: string, haystack: string, single: boolean): string | undefined {
  const allowed = plain(ALLOWED_NAMES.join(' '));
  for (const { run, opensSentence } of names(text)) {
    const rest = opensSentence ? run.slice(1) : run;
    if (rest.length === 0 || (rest.length === 1 && !single && run.length === 1)) continue;
    if (nameKnown(rest, `${haystack}${allowed}`) || (run.length >= 2 && nameKnown(run, `${haystack}${allowed}`))) continue;
    return run.join(' ');
  }
  return undefined;
}

/**
 * Words that state something grave or private about a person. A block may use
 * one only if a chunk it cites uses it too; being in the question is not
 * enough, or "Was he fired?" would license "He was fired."
 */
const CLAIMS =
  /\b(?:fired|dismissed|sacked|laid off|resigned|misconduct|arrested|convicted|criminal|lawsuit|sued|ph\.?d|doctorate|granted|citizen|citizenship|nationality|passport|visa|work permit|married|divorced|wife|husband|girlfriend|boyfriend|children|years old|born|salary|earns|religion|religious|diagnosed|illness|disabled)\b/gi;

/**
 * Checks one block of a generated answer against the chunks it cites.
 * On success `state` is updated, so later blocks may lean on these chunks too.
 */
export function guardBlock(text: string, chunks: Chunk[], question: string, state: GuardState): GuardResult {
  const fail = (reason: string): GuardResult => ({ ok: false, reason });
  const total = state.words + words(text).length;
  if (total > ANSWER_WORDS_MAX) return fail(`longer than ${ANSWER_WORDS_MAX} words`);
  const pass = (): GuardResult => {
    state.words = total;
    for (const chunk of chunks) if (!state.cited.includes(chunk)) state.cited.push(chunk);
    return { ok: true };
  };
  if (isAbstention(text)) return pass();

  if (/https?:\/\/|\bwww\./i.test(text)) return fail('a URL');
  const stated = facts(text);
  if ([...stated.emails].some((address) => address !== site.email.toLowerCase())) return fail('an email address other than the site’s');
  if (PHONE.test(text.replace(IDENTIFIER, 'x').replace(/\b(?:19|20)\d{2}\b/g, 'x'))) return fail('something that looks like a phone number');
  if (/\b(?:I|I'm|I've|[Mm]y|[Mm]e|[Mm]ine)\b/.test(apostrophes(text).replace(/"[^"]*"|“[^”]*”/g, ' '))) return fail('first person');

  const cited = [...chunks, ...state.cited].map((chunk) => `${displayTitle(chunk)}\n${chunk.tags.join('\n')}\n${chunk.text}`).join('\n');
  const claim = (apostrophes(text).match(CLAIMS) ?? []).find((word) => !plain(cited).includes(plain(word)));
  if (claim) return fail(`"${claim}" is not in the cited sources`);

  const known = facts(`${cited}\n${question}`);
  const hard = [
    ...[...stated.numbers].filter((n) => !known.numbers.has(n)),
    ...[...stated.percents].filter((p) => !known.percents.has(p)).map((p) => `${p}%`),
    ...[...stated.identifiers].filter((id) => !known.identifiers.has(id)),
    ...[...stated.emails].filter((address) => !known.emails.has(address)),
  ];
  const english = !looksForeign(question);
  const name = unsupportedName(text, plain(`${cited}\n${question}`), english);
  if (chunks.length === 0) {
    if (extractHardFacts(text).length > 0) return fail('a fact without a citation');
    if (unsupportedName(text, ' ', english)) return fail('a name without a citation');
    return pass();
  }
  if (hard.length > 0) return fail(`not in the cited sources: ${hard.join(', ')}`);
  if (name) return fail(`a name that is not in the cited sources: ${name}`);
  return pass();
}

/** A hosted conversation can explain transferable skills and general concepts without a word-for-word match. */
export function guardConversationBlock(text: string, chunks: Chunk[], question: string, state: GuardState): GuardResult {
  const fail = (reason: string): GuardResult => ({ ok: false, reason });
  const total = state.words + words(text).length;
  if (total > 600) return fail('answer too long');
  if (/https?:\/\/|\bwww\./i.test(text)) return fail('unverified URL');
  const stated = facts(text);
  if ([...stated.emails].some((address) => address !== site.email.toLowerCase())) return fail('unverified email');
  if (PHONE.test(text.replace(IDENTIFIER, 'x').replace(/\b(?:19|20)\d{2}\b/g, 'x'))) return fail('private phone number');
  if (/\bI (?:work(?:ed)?|studied|graduated|joined|built|published|hold)\b|\bmy (?:degree|employer|salary|career)\b/i.test(text)) return fail('impersonating Daniil');

  const sources = [...chunks, ...state.cited];
  const cited = sources.map((chunk) => `${displayTitle(chunk)}\n${chunk.text}`).join('\n');
  const negative = /(?<!\p{L})(?:not (?:documented|listed|established|specified|confirmed)|(?:isn't|aren't|wasn't|weren't) (?:documented|listed|established|specified|confirmed)|does not (?:document|mention|establish|list|show|specify)|doesn't (?:document|mention|establish|list|show|specify)|no (?:evidence|information)|cannot confirm|can't confirm|cannot verify|don't know|do not know|nicht (?:dokumentiert|aufgef[uü]hrt|bekannt|belegt)|kann .{0,50}nicht best[aä]tigen|keine (?:Angaben|Informationen|Belege)|pas (?:document[eé]e?s?|indiqu[eé]e?s?|mentionn[eé]e?s?)|ne (?:peux|peut) pas (?:confirmer|v[eé]rifier)|aucune (?:information|preuve)|не (?:указан[аоы]?|документирован[аоы]?|известн[аоы]?|могу подтвердить)|нет (?:информации|данных|подтверждения))(?!\p{L})/iu;
  const clauses = text.split(/\n+|(?<=[.!?;])\s+|\s+(?:but|however|yet|although|whereas|while)\s+|\s+and\s+(?=(?:he|his|Daniil|is|was|has|holds)\b)|,\s*(?=(?:he|his|Daniil)\b)/i);
  const assertionPattern = /(?<!\p{L})(?:works|worked|joined|studied|graduated|holds?|earned|received|published|employed|employment|served|managed|built|developed|led|supervised|certified|licensed|qualified|has|had|is|was|arbeitet|arbeitete|studierte|travaille|travaillait|emploie|dipl[oô]m[eé]|работает|работал)(?!\p{L})/iu;
  const nonfactual = (clause: string) => /^[\s-]*(?:hi|hello|dear)\s+(?:Daniil(?: Emtsev)?)[,!]?\s*$/i.test(clause) ||
    (/\?\s*$/.test(clause) && /^\s*(?:what|which|who|where|when|why|how|would|could|can|do|does|did|are|is|will)\b/i.test(clause)) ||
    (/^\s*I can help\s+(?:you\s+)?(?:assess|compare|explore|evaluate|explain|find|draft|write|summari[sz]e)\b/i.test(clause) && !facts(clause).numbers.size && !/\b(?:because|since|given that|as)\s+(?:he|Daniil)\b|\b(?:who|whose)\b/i.test(clause)) ||
    (/^\s*(?:that|this|it) would help (?:clarify|assess|evaluate|compare|determine)\b/i.test(clause) && !assertionPattern.test(clause) && !facts(clause).numbers.size);
  // An uncertainty statement does not license an affirmative claim in another clause.
  const unlisted = /^\s*no\s+[^.!?;]{1,100}\s+(?:(?:is|was|are|were)\s+)?(?:listed|documented|mentioned|established|specified)\b/i;
  const affirmativeClauses = clauses.filter((clause) => !negative.test(apostrophes(clause)) && !unlisted.test(clause) && !nonfactual(clause));
  const affirmative = affirmativeClauses.join('. ');
  const foreignPerson = /(?<!\p{L})(?:er|ihm|ihn|él|lui|il|son|sa|ses|он|его|ему)(?!\p{L})/iu;
  const subjectless = /^(?:(?:previously|formerly)\s+)?(?:employed|worked|graduated|certified|licensed)\b/i;
  const personal = /(?<!\p{L})(?:Daniil|Emtsev|Даниил|Емцев|he|his|him)(?!\p{L})/iu.test(text) || subjectless.test(text) ||
    (foreignPerson.test(text) && (foreignPerson.test(question) || /Daniil|Emtsev|Даниил|\b(?:he|his|him|you|u)\b/i.test(question)));
  if (personal && affirmative.trim() && !chunks.length && !isAbstention(text)) return fail('personal facts without a source');
  if (personal) {
    const known = facts(cited);
    // A visitor's proposed team size is context, not a claim about a team Daniil managed.
    const scenarioNumbers = facts(question).numbers;
    const figuresText = affirmativeClauses.map((clause) => clause.replace(/^(\s*For\s+(?:a\s+)?team of\s+)(\d+)(\s+(?:engineers|developers|people|members)\b)/i,
      (whole, prefix: string, n: string, suffix: string) => scenarioNumbers.has(n) ? `${prefix}N${suffix}` : whole)).join('. ');
    const personalFigures = facts(figuresText);
    if ([...personalFigures.numbers].some((n) => !known.numbers.has(n)) || [...personalFigures.percents].some((p) => !known.percents.has(p)) || [...personalFigures.identifiers].some((id) => !known.identifiers.has(id))) return fail('personal figure not supported by sources');
    for (const clause of affirmativeClauses) {
      if (!assertionPattern.test(clause)) continue;
      // A proposed role is a generic job label, not a claimed past title or new employer.
      const checked = clause.replace(/\b(?:CTO|chief technology officer|(?:head|director|vp|vice president) of (?:software )?engineering|(?:technical|tech) lead|engineering manager)\b/gi, (title: string, offset: number) => {
        const before = clause.slice(0, offset).slice(-140);
        const qualifiers = String.raw`(?:an?\s+)?(?:(?:hands-on|strong|good|credible|potential|promising)\s+){0,3}`;
        const prospective = new RegExp(String.raw`\b(?:(?:candidate|fit|suited)\s+for\s+|(?:could|would|can|might)\s+(?:be|become|serve as)\s+)${qualifiers}$`, 'i').test(before);
        return prospective && !/\b(?:already|currently|previously|formerly|experience as|title is)\b/i.test(before) ? title.toLowerCase() : title;
      });
      if (unsupportedName(checked, plain(cited), !looksForeign(question))) return fail('personal name not supported by sources');
    }
    if ((apostrophes(affirmative).match(CLAIMS) ?? []).some((claim) => !plain(cited).includes(plain(claim)))) return fail('unsupported private claim');
    for (const credential of affirmative.match(/\b(?:certified|licensed)\s+[\p{L} -]{1,60}/giu) ?? []) {
      if (!plain(cited).includes(plain(credential.replace(/\b(?:and|with|who|at)\b.*$/i, '')))) return fail('unsupported certification');
    }
  }
  state.words = total;
  for (const chunk of chunks) if (!state.cited.includes(chunk)) state.cited.push(chunk);
  return { ok: true };
}
