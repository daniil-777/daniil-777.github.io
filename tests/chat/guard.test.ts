import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { site } from '../../src/data/site.ts';
import { ANSWER_WORDS_MAX, extractHardFacts, guardBlock, guardConversationBlock, isAbstention, newGuardState } from '../../src/lib/chat/guard.ts';
import type { Chunk } from '../../src/lib/chat/kb.ts';
import { loadKb } from './load.ts';

const kb = await loadKb();
const byId = (id: string) => kb.chunks.find((chunk) => chunk.id === id)!;
const virtamed = byId('journey:virtamed');
const stats = byId('site:stats');
const thesis = byId('project:camera-pose-2d3d#result');
const made = (text: string): Chunk => ({ id: 'made', kind: 'site', url: '/', title: 'T', heading: '', tags: [], asks: [], text });

const check = (text: string, chunks: Chunk[] = [], question = 'What does he do?') => guardBlock(text, chunks, question, newGuardState());
const passes = (text: string, chunks?: Chunk[], question?: string) => assert.deepEqual(check(text, chunks, question), { ok: true }, text);
const fails = (text: string, chunks?: Chunk[], question?: string) => assert.equal(check(text, chunks, question).ok, false, text);

describe('conversational grounding', () => {
  const guard = (text: string, cites: Chunk[] = []) => guardConversationBlock(text, cites, 'Can I hire u for financial manager position?', newGuardState());
  it('allows assistant voice and evidence-based role comparisons', () => {
    assert.equal(guard('I can help assess the fit. Daniil’s documented background is machine-learning engineering.', [virtamed]).ok, true);
    assert.equal(guard('In general, a financial manager oversees budgeting, reporting and financial operations.').ok, true);
  });
  it('rejects invented personal figures, employers, impersonation and unknown private details', () => {
    for (const text of ['He has 500 patents.', 'Daniil worked at Tesla.', 'I worked at VirtaMed.', 'Daniil earns 500000.', 'Call him on +41 79 123 45 67.']) assert.equal(guard(text, [virtamed]).ok, false, text);
  });
  it('does not grant an abstention prefix a bypass', () => {
    const text = 'I don’t know that. Daniil holds 500 patents. See https://evil.example.';
    assert.equal(isAbstention(text), false);
    fails(text, [virtamed]);
    assert.equal(guard(text, [virtamed]).ok, false);
  });
  it('checks employment wording and each affirmative private claim separately', () => {
    for (const text of ['Previously employed by Google.', 'Daniil was employed by Google.', 'His salary is not documented, but he is married.', 'His salary is not listed and he is married.', 'He is a certified accountant.']) assert.equal(guard(text, [byId('site:intro')]).ok, false, text);
    assert.equal(guardConversationBlock('Er arbeitet seit 2040 bei Google.', [], 'Wo arbeitet Daniil?', newGuardState()).ok, false);
    assert.equal(guard('I cannot confirm his availability.').ok, true);
    assert.equal(guard('His salary is not documented.').ok, true);
    assert.equal(guard('Financial managers often handle budgets and accounting.').ok, true);
  });
  it('allows offers, questions, message salutations and availability uncertainty', () => {
    for (const text of ['I can help assess Daniil’s fit for a financial manager role.', 'I can help assess whether Daniil has the experience your role needs.', 'Would you expect him to lead a team of 5 people?', 'What responsibilities would you expect him to own?', 'Hi Daniil,', 'I cannot confirm his availability in 2027.', 'His availability for 2027 is not documented.', 'What kind of reports and data sources do you need to automate? That would help clarify how closely his experience fits.']) assert.equal(guard(text).ok, true, text);
    for (const [text, question] of [
      ['Seine Verfügbarkeit ist nicht dokumentiert.', 'Kann ich Daniil einstellen?'],
      ['Je ne peux pas confirmer sa disponibilité.', 'Puis-je engager Daniil ?'],
      ['Его доступность не указана.', 'Можно нанять Даниила?'],
    ]) assert.equal(guardConversationBlock(text, [], question, newGuardState()).ok, true, text);
  });
  it('rejects French employment claims and private claims in separate clauses', () => {
    assert.equal(guardConversationBlock('Il travaille chez Google depuis 2040.', [], 'Où travaille Daniil ?', newGuardState()).ok, false);
    for (const join of [', although ', ', while ', ', whereas ', ', ']) assert.equal(guard(`His salary is not documented${join}he is married.`, [byId('site:intro')]).ok, false, join);
    assert.equal(guard('I can help assess Daniil’s fit, he works at Tesla.').ok, false);
    assert.equal(guard('Hi Daniil,\nHe has 500 patents.').ok, false);
  });
  it('keeps sentence boundaries when filtering uncertainty clauses from live replies', () => {
    const reply = 'You can contact Daniil to discuss the role, but I can’t confirm his availability or speak for him. His portfolio documents finance-related technical work: he built FX Regime Radar, an educational tool that analyzes currency-market regimes and risk—not price direction. That demonstrates quantitative and software skills, but it does not establish experience in financial management, accounting, budgeting, or investment advice.';
    assert.equal(guard(reply, [byId('project:fx-regime-radar'), byId('project:fx-regime-radar#built-so-it-can-be-checked')]).ok, true);
    assert.equal(guard('I can help assess his fit because he works at Tesla.').ok, false);
  });
  it('allows natural prospective leadership assessments while checking historical titles and employers', () => {
    for (const text of [
      'Yes—he looks like a credible candidate for a hands-on Head of Software Engineering role in an AI-focused team. He has built real-time applications and MLOps systems.',
      'Daniil is a credible candidate for CTO. He has teaching and student-supervision experience.',
      'For a larger engineering organisation, I’d also discuss hiring and people management before assessing him.',
      'His listed role is Machine Learning Research Engineer at VirtaMed; the portfolio doesn’t list a previous Head of Software Engineering title.',
      'No Head of Software Engineering role is listed. Daniil’s documented role is Machine Learning Research Engineer at VirtaMed, where he has built real-time applications and deployed ML systems.',
    ]) assert.equal(guardConversationBlock(text, [virtamed], 'Can he be Head of Software Engineering?', newGuardState()).ok, true, text);
    for (const text of ['He was Head of Software Engineering at VirtaMed.', 'He worked at Google as CTO.', 'Daniil is a certified Head of Software Engineering.', 'He has built Tesla-based systems.', 'No Head of Software Engineering role is listed, but he worked at Google.', 'He has experience as Head of Software Engineering, making him a strong candidate.', 'Yes, he is already CTO, a good fit for this role.']) assert.equal(guard(text, [virtamed]).ok, false, text);
    const scenario = 'What about leading a team of 100 engineers?';
    assert.equal(guardConversationBlock('For a team of 100 engineers, his readiness would depend on the management scope.', [virtamed], scenario, newGuardState()).ok, true);
    for (const text of ['He has managed a team of 100 engineers.', 'For a team of 200 engineers, his readiness would depend on the management scope.', 'For a team of 100 engineers, he has 500 patents.']) assert.equal(guardConversationBlock(text, [virtamed], scenario, newGuardState()).ok, false, text);
  });
});

describe('guard: must reject', () => {
  it('a year the source does not state', () => fails('He joined VirtaMed in 2020.', [virtamed]));
  it('a percentage the source does not state', () => fails('Detection accuracy rose to 95%.', [virtamed]));
  it('a degree and a year with nothing cited', () => fails('He holds a PhD from ETH Zurich awarded in 2023.'));
  it('an employer the site never names', () => fails('He previously worked at Google DeepMind.', [virtamed]));
  it('an uncited sentence with a year', () => fails('He has worked there since 2022.'));
  it('an uncited sentence with a name', () => fails('He was supervised by Luc Van Gool.'));
  it('a phone number', () => fails('Call him on +41 79 123 45 67.', [virtamed]));
  it('a link', () => {
    fails('For details see https://example.com.', [virtamed]);
    fails('It is on www.example.com.', [virtamed]);
  });
  it('first person', () => {
    fails('I built the AI Proctor.', [byId('project:ai-proctor')]);
    fails('The proctor is my main project.', [byId('project:ai-proctor')]);
  });
  it('an email address that is not the site’s', () => fails('Write to someone.else@example.com.', [byId('site:contact')]));
  it('a number that only resembles a cited one', () => fails('He has 40 years of experience.', [stats]));
  it('a single-digit percentage that the source has only as a count', () => fails('Accuracy improved by 5%.', [byId('project:laparoscopic-skills-trainer')]));
  it('an identifier that is not in the source', () => fails('The application is WO2020123456A1.', [thesis]));
  it(`an answer longer than ${ANSWER_WORDS_MAX} words`, () => {
    const state = newGuardState();
    const block = `${Array.from({ length: 100 }, () => 'word').join(' ')}.`;
    assert.equal(guardBlock(block, [virtamed], 'q', state).ok, true);
    assert.equal(guardBlock(block, [virtamed], 'q', state).ok, false);
  });
});

describe('guard: must reject what earlier passed', () => {
  const fact = (id: string) => byId(`fact:${id}`);
  const intro = byId('site:intro');
  const cases: [string, string, Chunk][] = [
    ['a dismissal the source does not state', 'Daniil was fired from VirtaMed for misconduct.', fact('current-role')],
    ['single-digit counts', 'Daniil holds 5 granted patents and has published 9 papers.', byId('rollup:publications')],
    ['an age as a word, a marriage and a citizenship', 'Daniil is thirty years old, married, and a Russian citizen.', byId('site:facts')],
    ['a grant the source does not state', 'Daniil holds a granted patent, WO2023186262A1.', byId('pub:camera-pose-patent')],
    ['a degree the source does not state', 'Daniil has a PhD from ETH Zurich.', fact('education')],
    ['an employer that is only part of another name in the source', 'Daniil worked at Google before VirtaMed.', fact('contact')],
    ['two single-word employers', 'Before VirtaMed he worked at Google and at Tesla.', intro],
    ['a university as a single word', 'He holds a PhD from Stanford.', intro],
    ['a count and a duration', 'He has 9 patents and spent 7 years at Nvidia.', intro],
    ['a marriage and a place', 'Daniil is married and lives in Oerlikon.', intro],
  ];
  for (const [name, text, source] of cases) it(name, () => fails(text, [source], 'What about Daniil?'));

  it('a claim word that is only in the question', () => {
    fails('Yes, he was fired from VirtaMed.', [fact('current-role')], 'Was he fired from VirtaMed?');
    fails('The patent was granted.', [byId('pub:camera-pose-patent')], 'Was the patent granted?');
  });
  it('a phone number, even one the visitor typed', () => fails('His number is 079 555 01 23.', [virtamed], 'Is his number 079 555 01 23?'));
  it('another email address, even one the visitor typed', () => fails('Write to someone.else@example.com.', [byId('site:contact')], 'Is his address someone.else@example.com?'));
  it('a name of which only one word is in the source', () => fails('He was supervised by Prof. Luc Van Damme.', [thesis]));
  it('two numbers that a thousands separator would join', () => {
    const source = made('In 2022 it had 150 trainees.');
    passes('In 2022 150 trainees used it.', [source]);
    fails('It had 2022150 trainees.', [source]);
  });
});

describe('guard: what it cannot see', () => {
  // The guard compares words with the cited text. It does not understand sentences.
  it('passes a false sentence built only from words of its source', () => passes('Daniil left VirtaMed in 2022.', [made('Daniil joined VirtaMed in 2022 and never left.')]));
  it('does not check single capitalised words in an answer to a question in another language', () =>
    passes('Er arbeitet als Ingenieur bei VirtaMed in Zurich.', [virtamed], 'Wo arbeitet er und was macht er?'));
});

describe('guard: must pass', () => {
  it('a claim word that the cited fact uses itself', () => {
    passes('The site lists it as an application and does not say that a patent has been granted.', [byId('fact:patent')], 'Was the patent granted?');
    passes('The site does not mention a PhD; it lists an MSc from ETH Zurich.', [byId('fact:phd')], 'Does he have a PhD?');
  });
  it('a count the source gives in words or digits', () => {
    const experience = made('He has worked there for more than four years.');
    passes('He has worked there for more than four years.', [experience]);
    passes('He has 4 years of experience there.', [experience]);
    passes('The site lists one patent filing.', [stats]);
  });
  it('the site says nothing about another employer, named in the question', () => passes('The site does not mention Google as an employer.', [byId('fact:employers')], 'Why did he leave Google?'));
  it('a faithful paraphrase in the third person', () => {
    passes('Daniil is a Machine Learning Research Engineer at VirtaMed in Zurich, where he has worked from 2022 until now.', [virtamed]);
    passes('He raised the accuracy of anatomy detection in ultrasound from 60% to 90%.', [virtamed]);
  });
  it('"60% to 90%" against a source that says "60 → 90%"', () => passes('Accuracy went from 60% to 90%.', [made('60 → 90%: accuracy detecting anatomy in ultrasound.')]));
  it('"2022 – now" against "2022 - now"', () => passes('He has been there 2022 – now.', [made('VirtaMed, 2022 - now.')]));
  it('"1,024" against "1024" and a decimal comma', () => passes('It has 1,024 units and scored 0,5.', [made('A layer of 1024 units scored 0.5.')]));
  it('the abstention sentences', () => {
    passes('I don\'t know that. The site doesn\'t cover it.');
    passes('I don’t know that. The site doesn’t cover it.');
    passes('I can only answer questions about Daniil and his work on this site.');
  });
  it('an uncited connective sentence', () => passes('Here is what the site says about that.'));
  it('an uncited sentence that only names Daniil', () => passes('Daniil Emtsev describes this on the site.'));
  it('names and figures from the cited chunk', () => passes('The thesis was supervised by Prof. Luc Van Gool and advised by Dr. Danda Pani Paudel; it was graded 5.75 out of 6.', [thesis]));
  it('the patent application number', () => passes('The international patent application is WO2023186262A1.', [byId('pub:camera-pose-patent')]));
  it('a number that is in the question', () => passes('The site does not mention 2030.', [virtamed], 'What will he do in 2030?'));
  it('the site’s own email address', () => passes(`He can be reached at ${site.email}.`, [byId('site:contact')]));
  it('a quoted first-person phrase', () => passes('The site describes "AI proctors that coach while you operate", in his words "my own" projects.', [made('I build AI proctors that coach while you operate, and my own projects.')]));
  it('a fact supported by a chunk cited in an earlier block', () => {
    const state = newGuardState();
    assert.equal(guardBlock('He works at VirtaMed.', [virtamed], 'q', state).ok, true);
    assert.equal(guardBlock('He has been there since 2022.', [stats], 'q', state).ok, true);
    assert.equal(state.cited.length, 2);
  });
});

describe('guard helpers', () => {
  it('recognises an abstention only at the start', () => {
    assert.ok(isAbstention('  I don’t know that. The site doesn’t cover it.'));
    assert.ok(isAbstention('I can only answer questions about Daniil and his work on this site.'));
    assert.ok(!isAbstention('He said: I don’t know that.'));
  });

  it('extracts the facts a block states', () => {
    assert.deepEqual(extractHardFacts('In 2022 accuracy rose from 60% to 90% (0.5 better), see WO2023186262A1, 3 times.').sort(), ['0.5', '2022', '3', '60', '60%', '90', '90%', 'wo2023186262a1'].sort());
    assert.deepEqual(extractHardFacts('He works on 3D and 6D pose.'), []);
  });
});
