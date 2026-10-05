/**
 * Settings and wording of the "Ask AI" assistant. Edit the text here.
 * The knowledge itself comes from site.ts, the projects and src/content/facts.
 */

/** Longest question a visitor can send, in characters. */
export const INPUT_MAX = 2000;

export const SUGGESTED = [
  'Would Daniil be a good fit for my team?',
  'Show me his CV',
  'Show me videos of his AI projects',
  'What does Daniil do at VirtaMed?',
];

/**
 * Answers written by a model on the visitor's device. `off` until the
 * evaluation in the README passes; `builtin` allows only the browser's own
 * model, `all` also the downloadable one.
 */
export const DEVICE_MODE: 'off' | 'builtin' | 'all' = 'off';

export const LOCAL_LLM = {
  id: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
  revision: '10f72e70abf67ac0fd7ebf15bc5854726891d864',
  dtype: { f16: 'q4f16', fallback: 'q4' },
  bytes: { q4f16: 760_300_000, q4: 850_100_000 },
} as const;

export const COPY = {
  title: 'Ask about Daniil',
  disclosure: 'Explore Daniil’s experience, compare a role, or ask for his CV, project demos and papers. Personal facts are grounded in this portfolio.',
  placeholder: 'Ask a question or describe a role…',
  /** On a phone the long one does not fit the field. */
  placeholderShort: 'Ask a question…',
  send: 'Send',
  stop: 'Stop',
  modesLegend: 'Answer with',
  modes: {
    quotes: { option: 'Portfolio search', label: 'From the portfolio' },
    cloud: { option: 'AI conversation', label: 'AI assistant · grounded in the portfolio' },
    device: { option: 'On this device', label: 'Generated on your device' },
  },
  writing: 'Writing an answer…',
  cutShort: '(answer cut short)',
  stopped: 'Stopped',
  howItWorks: 'How this works',
  emailLink: 'Email Daniil',
  status: {
    searching: 'Searching the site',
    ready: (sources: number) => `Answer ready, ${sources} ${sources === 1 ? 'source' : 'sources'}`,
    stopped: 'Stopped',
    notCovered: 'Not covered on this site',
    fresh: 'New chat',
    fallback: 'Showing passages from the site instead',
  },
  lead: {
    none: 'The portfolio doesn’t document that yet. You can ask about Daniil’s experience, describe a role, or request his CV and project demos.',
    list: 'From the site:',
    quote: 'Here is what the site says:',
    closest: 'I couldn’t find a direct answer. These are the closest passages on the site:',
    mentions: 'The site does not answer that with a yes or a no. These passages mention it:',
    closestAfter: 'Not what you were looking for? Email Daniil.',
    englishOnly: 'Portfolio search works best in English.',
    englishOnlyCloud: 'AI conversation can reply in your language.',
  },
  notice: {
    cloudFailed: 'The AI service is temporarily unavailable. Here is what the portfolio supports; you can try again.',
    cloudBusy: 'The AI service is busy. Here is what the portfolio supports; please try again shortly.',
    budget: 'Daily limit reached',
    unverified: 'The AI answer could not be verified against the site. Showing passages instead.',
    semanticFailed: 'Smarter search could not be loaded. Keyword search is still active.',
    deviceFailed: 'The on-device model could not run here.',
  },
  semantic: {
    offer: 'Smarter search (downloads about 30 MB)',
    consent:
      'Smarter search downloads a 23 MB language model and its runtime (about 30 MB in total) from huggingface.co and cdn.jsdelivr.net. It then runs on your device and is cached by your browser.',
    accept: 'Download',
    decline: 'Not now',
  },
  device: {
    consent:
      'Download a 760 MB model from huggingface.co (runtime from cdn.jsdelivr.net) to write answers on this device. Stored in this browser; you can remove it at any time.',
    accept: 'Download',
    decline: 'Cancel',
    remove: 'Remove downloaded model',
  },
};
