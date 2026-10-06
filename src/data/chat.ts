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
export const DEVICE_MODE: 'off' | 'builtin' | 'all' = 'all';
/** OpenAI is the default; visitors can select local inference instead. */
export const CLOUD_ENABLED = true;

export const LOCAL_LLM = {
  id: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
  revision: '10f72e70abf67ac0fd7ebf15bc5854726891d864',
  dtype: { f16: 'q4f16', fallback: 'q4' },
  bytes: { q4f16: 768_000_000, q4: 854_000_000 },
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
    cloud: { option: 'OpenAI', label: 'OpenAI · grounded in the portfolio' },
    device: { option: 'Our local model', label: 'Our local model · on your device' },
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
    credits: 'OpenAI credits or billing limit reached. Switching to our local model.',
    localFallback: 'The AI usage limit was reached. Switching to our local model.',
    localUnavailable: 'Our local model cannot run on this device. Showing the public portfolio instead.',
    unverified: 'The AI answer could not be verified against the site. Showing passages instead.',
    semanticFailed: 'Smarter search could not be loaded. Keyword search is still active.',
    deviceFailed: 'The on-device model could not run here.',
  },
  semantic: {
    offer: 'Smarter search (downloads about 50 MB)',
    consent:
      'Smarter search downloads a 23 MB language model from huggingface.co and its runtime from this website (about 50 MB in total). It runs on your device and is cached by your browser. Questions stay here.',
    accept: 'Download',
    decline: 'Not now',
  },
  device: {
    unavailable: 'Requires a supported device with enough memory and storage',
    consent:
      'Download the local language model (about 885 MB including the runtime) from huggingface.co. It runs on this device, so questions stay here. Personal answers use public sources; rejected generation falls back to portfolio passages. The first load can take a few minutes. The model is cached in this browser and can be removed.',
    accept: 'Download',
    decline: 'Cancel',
    remove: 'Remove downloaded model',
  },
};
