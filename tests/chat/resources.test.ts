import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Chunk } from '../../src/lib/chat/kb.ts';
import { conversationalFallback, requestsResources, safeResource, selectResources, type Resource } from '../../src/lib/chat/resources.ts';

const resources: Resource[] = [
  { id: 'cv', kind: 'cv', title: 'Daniil Emtsev CV', url: '/documents/daniil-emtsev-cv.pdf', download: true },
  { id: 'showreel', kind: 'video', title: 'Portfolio showreel', url: '/media/showreel.mp4', poster: '/media/showreel.jpg' },
  { id: 'astro', kind: 'project', title: 'Astro Pilot', url: '/work/astro-pilot/', project: 'astro-pilot' },
  { id: 'astro-video', kind: 'video', title: 'Flight demonstration', url: '/work/astro-pilot/#videos-title', project: 'astro-pilot' },
  { id: 'astro-demo', kind: 'demo', title: 'Open Astro Pilot', url: 'https://daniil-777.github.io/astro-pilot/', project: 'astro-pilot' },
  { id: 'astro-code', kind: 'code', title: 'Astro Pilot source', url: 'https://github.com/daniil-777/astro-pilot', project: 'astro-pilot' },
  { id: 'pixel', kind: 'project', title: 'Pixel Morph', url: '/work/pixel-morph/', project: 'pixel-morph' },
  { id: 'pixel-video', kind: 'video', title: 'Pixel Morph demonstration', url: '/work/pixel-morph/#videos-title', project: 'pixel-morph' },
  { id: 'pixel-code', kind: 'code', title: 'Pixel Morph source', url: 'https://github.com/daniil-777/pixel-morph', project: 'pixel-morph' },
  { id: 'dynamic', kind: 'project', title: 'Dynamic Plane Convolutional Occupancy Networks', url: '/work/dynamic-plane-onet/', project: 'dynamic-plane-onet' },
  { id: 'dynamic-paper', kind: 'document', title: 'Dynamic Plane paper', url: 'https://arxiv.org/abs/2012.03871', project: 'dynamic-plane-onet' },
  { id: 'poster', kind: 'document', title: 'Research poster', url: '/documents/poster.pdf', project: 'astro-pilot' },
  { id: 'github', kind: 'profile', title: 'GitHub', url: 'https://github.com/daniil-777' },
  { id: 'linkedin', kind: 'profile', title: 'LinkedIn', url: 'https://www.linkedin.com/in/emtsevdaniil/' },
];
const ids = (question: string, sources: { url: string }[] = [], previous?: string) => selectResources(question, resources, sources, previous).map((resource) => resource.id);

describe('public resource validation', () => {
  it('accepts root-relative files and known public HTTPS origins', () => {
    assert.ok(resources.every(safeResource));
    assert.ok(safeResource({ ...resources[0], url: 'https://demtsev.com/documents/cv.pdf' }));
    assert.ok(safeResource({ ...resources[4], url: 'https://fx-regime-radar.fly.dev/' }));
  });
  it('rejects dangerous, deceptive, and private-path URLs', () => {
    for (const url of ['//evil.example/a', 'javascript:alert(1)', 'data:text/html,x', 'http://github.com/daniil-777', 'https://github.com.evil.example/a', 'https://github.com@evil.example/a', 'https://user:secret@github.com/a', 'https://github.com:8080/a', '/work/../CV/private.pdf', '/work/%2e%2e/CV/private.pdf', '/work/%252e%252e/CV/private.pdf', '/work/%2e%2e%2fCV/private.pdf', '/\\evil.example/a', '/%5cevil.example/a', '/%00evil', ' https://github.com/a', '/bad%escape']) {
      assert.equal(safeResource({ ...resources[0], url }), false, url);
    }
  });
  it('checks optional fields and never selects an unsafe registry entry', () => {
    assert.equal(safeResource({ ...resources[1], poster: 'javascript:alert(1)' }), false);
    assert.equal(safeResource({ ...resources[0], download: 'secret' }), false);
    assert.equal(safeResource({ ...resources[0], title: '' }), false);
    const mixed = [...resources, { ...resources[0], id: 'bad', url: '//evil.example/cv' }];
    assert.deepEqual(selectResources('Send your CV', mixed).map((resource) => resource.id), ['cv']);
  });
});

describe('resource intent and conversation context', () => {
  it('shares the CV even after a project discussion', () => {
    for (const question of ['Send me your CV', 'Can I download his résumé?', 'Share the curriculum vitae', 'Can I download your CV as PDF?', 'Покажи резюме', 'Send his Lebenslauf']) assert.deepEqual(ids(question, [{ url: '/work/astro-pilot/' }], 'Tell me about Pixel Morph'), ['cv']);
    assert.deepEqual(ids('Send your CV and research papers'), ['cv', 'dynamic-paper', 'poster']);
    assert.deepEqual(ids('Resume our discussion'), []);
  });
  it('keeps explanations while recognizing explicit resource requests', () => {
    for (const q of ['Show me the CV', 'And its video?', 'Where can I find the paper?', 'Can I download your CV as PDF?']) assert.ok(requestsResources(q), q);
    for (const q of ['How does AI Proctor analyse surgical video?', 'Explain the Dynamic Plane paper', 'Tell me about his demo', 'Why did he use video?']) assert.equal(requestsResources(q), false, q);
  });
  it('shows videos without mixing in a poster or document', () => {
    assert.deepEqual(ids('Show me videos of your work'), ['showreel', 'astro-video', 'pixel-video']);
    assert.deepEqual(ids('Show the Astro Pilot video'), ['astro-video']);
    assert.ok(selectResources('Show me all videos', resources).every((resource) => resource.kind === 'video'));
  });
  it('uses the currently named project before sources and the previous question', () => {
    assert.deepEqual(ids('Show the Pixel Morph video', [{ url: '/work/astro-pilot/#the-pilot' }], 'What is Astro Pilot?'), ['pixel-video']);
    assert.deepEqual(ids('Show me the video', [{ url: '/work/astro-pilot/#the-pilot' }], 'What is Pixel Morph?'), ['astro-video']);
    assert.deepEqual(ids('And its video?', [], 'What is Astro Pilot?'), ['astro-video']);
    assert.deepEqual(ids('Show all videos', [{ url: '/work/astro-pilot/' }], 'What is Astro Pilot?'), ['showreel', 'astro-video', 'pixel-video']);
    const followup = (q: string) => selectResources(q, resources, [{ url: '/work/pixel-morph/' }], 'And its video?', '/work/astro-pilot/').map((resource) => resource.id);
    assert.deepEqual(followup('And the GitHub?'), ['astro-code']);
    assert.deepEqual(followup('Can I try its demo?'), ['astro-demo']);
    assert.deepEqual(followup('Show the Pixel Morph video'), ['pixel-video']);
    assert.deepEqual(followup('Show all videos'), ['showreel', 'astro-video', 'pixel-video']);
  });
  it('links relevant source code, demos, research documents, and profiles', () => {
    assert.deepEqual(ids('And the GitHub?', [], 'What is Astro Pilot?'), ['astro-code']);
    assert.deepEqual(ids('Show his GitHub'), ['github']);
    assert.deepEqual(ids('Can I try its demo?', [{ url: '/work/astro-pilot/' }]), ['astro-demo']);
    assert.deepEqual(ids('Send the paper', [], 'Explain Dynamic Plane Convolutional Occupancy Networks'), ['dynamic-paper']);
    assert.deepEqual(ids('Share his LinkedIn profile'), ['linkedin']);
    assert.deepEqual(ids('Send the Astro Pilot project link'), ['astro']);
  });
  it('caps and deduplicates attachments and leaves ordinary questions alone', () => {
    const many = [...resources, ...Array.from({ length: 6 }, (_, n): Resource => ({ id: `extra-${n}`, kind: 'video', title: `Video ${n}`, url: `/media/video-${n}.mp4` })), { ...resources[1], id: 'duplicate-showreel' }];
    const picked = selectResources('Show all videos', many);
    assert.equal(picked.length, 4);
    assert.equal(new Set(picked.map((resource) => resource.url)).size, 4);
    assert.deepEqual(ids('What did he build at VirtaMed?'), []);
  });
});

const chunk = (id: string, text: string, sensitive = false): Chunk => ({ id, kind: id.startsWith('project:') ? 'project' : 'fact', title: 'Daniil', heading: '', url: '/#about', tags: [], asks: [], text, sensitive });
const chunks = [
  chunk('site:intro', 'Daniil Emtsev is an AI Research Engineer in Zurich.'),
  chunk('fact:current-role', 'Daniil is a Machine Learning Research Engineer at VirtaMed in Zurich (2022 – now).'),
  chunk('project:fx-regime-radar', 'FX Regime Radar is a daily currency-market pipeline that names the market regime and forecasts the risk that it changes. It never predicts price direction.'),
  chunk('fact:contact', 'You can reach Daniil by email.'),
];

describe('transparent conversational fallback', () => {
  it('compares the financial manager opening with documented technical work and unestablished qualifications', () => {
    const reply = conversationalFallback('Can I hire u for financial manager position?', chunks)!;
    const text = reply.text.join(' ');
    assert.match(text, /AI research and machine-learning engineering/);
    assert.match(text, /FX Regime Radar/);
    assert.match(text, /transferable analytical and software skills/);
    assert.match(text, /does not establish accounting, budgeting, financial reporting/);
    assert.match(text, /cannot confirm his suitability/);
    assert.match(text, /availability/);
    assert.deepEqual(reply.cites, ['fact:current-role', 'project:fx-regime-radar', 'fact:contact']);
    assert.ok(reply.cites.every((id) => chunks.some((source) => source.id === id && !source.sensitive)));
    assert.doesNotMatch(text, /qualified financial manager|available immediately|will accept|price direction predictions/i);
  });
  it('answers team-fit questions while leaving unknown requirements open', () => {
    const reply = conversationalFallback('What makes you a good fit for our team?', chunks)!;
    assert.match(reply.text.join(' '), /responsibilities of the role/);
    assert.match(reply.text.join(' '), /does not confirm his availability/);
    assert.equal(reply.cites.includes('project:fx-regime-radar'), false);
    assert.match(conversationalFallback('What about a financial manager?', chunks, 'Can I hire him?')!.text.join(' '), /financial manager/);
  });
  it('assesses prospective engineering leadership from delivery and mentoring evidence', () => {
    const experience = chunk('journey:virtamed', 'Daniil builds real-time browser applications with deployed machine-learning systems and end-to-end MLOps. Teaching AI and supervising students.');
    const question = 'Can he be a head of software engineering?';
    const reply = conversationalFallback(question, [...chunks, experience])!;
    assert.match(reply.text[0], /^Yes—/);
    assert.match(reply.text[0], /candidate/);
    assert.match(reply.text[0], /mentoring experience/);
    assert.deepEqual(reply.cites, ['journey:virtamed']);
    assert.doesNotMatch(reply.text.join(' '), /has been a head|managed multiple teams|available immediately/i);
    assert.doesNotMatch(conversationalFallback(question, chunks)!.text.join(' '), /^Yes—/);
    assert.equal(conversationalFallback('Has he already been a head of software engineering?', [...chunks, experience]), undefined);
  });
  it('does not invent a technical background or cite unavailable or sensitive sources', () => {
    const reply = conversationalFallback('Can I hire him as a financial manager?', [chunk('fact:current-role', 'Private background', true)])!;
    assert.deepEqual(reply.cites, []);
    assert.doesNotMatch(reply.text.join(' '), /AI research|FX Regime Radar/);
  });
  it('does not label a skill undocumented when later portfolio content states it', () => {
    const updated = [...chunks, chunk('fact:accounting', 'Daniil has professional accounting experience.')];
    assert.doesNotMatch(conversationalFallback('Can I hire him as a financial manager?', updated)!.text.join(' '), /does not establish accounting/);
  });
  it('responds to greetings and clear general questions with the assistant’s scope', () => {
    assert.match(conversationalFallback('Hello!', chunks)!.text.join(' '), /experience, projects, research/);
    assert.match(conversationalFallback('What is the capital of France?', chunks)!.text.join(' '), /general-purpose assistant/);
    assert.doesNotMatch(conversationalFallback('What is the weather in Zurich today?', chunks)!.text.join(' '), /sunny|rain|degrees/i);
    assert.match(conversationalFallback('Can you write me a poem?', chunks)!.text.join(' '), /general-purpose assistant/);
  });
  it('preserves factual, private, and ambiguous questions for the existing pipeline', () => {
    for (const question of ['What did he build at VirtaMed?', 'What is his phone number?', 'How does camera pose estimate position?', 'Can you do that?', 'What salary would he get?', 'What is its stack?', 'Tell me about his publications']) assert.equal(conversationalFallback(question, chunks), undefined, question);
  });
});
