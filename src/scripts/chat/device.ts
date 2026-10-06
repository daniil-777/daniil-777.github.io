/**
 * "On this device": answers written by a model in the visitor's browser.
 * Tier A is the browser's own model (no download); tier B is a downloadable
 * model on WebGPU. Loaded only when `DEVICE_MODE` in src/data/chat.ts allows
 * it. Compatibility and model quality are checked before accepting a download.
 */
import { LOCAL_LLM } from '../../data/chat.ts';
import type { Capabilities } from '../../lib/chat/modes.ts';
import { LOCAL_RULES, buildLocalPrompt, localRulesFor } from '../../lib/chat/prompt.ts';
import { parseLocalBlock, splitLocalParagraphs } from '../../lib/chat/local-response.ts';
import type { GenEvent, Generator } from '../../lib/chat/types.ts';
import { ChatError } from './pipeline.ts';
import { loadModel, startWorker, type LocalWorker, type Progress } from './semantic.ts';

/** The same for `availability()` and `create()`, or the browser may answer for a different model. */
const BUILTIN_OPTIONS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
/** The worker and its model are released this long after the dialog closes. */
export const IDLE_MS = 180_000;

type Variant = keyof typeof LOCAL_LLM.bytes;
type Gpu = { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };

/** Adds what only the browser can say (and only asynchronously) to the capabilities. */
export async function probe(base: Capabilities): Promise<Capabilities> {
  const caps = { ...base };
  try {
    // Never `create()` unless the model is already there: it would start a multi-gigabyte download.
    if (typeof LanguageModel !== 'undefined') caps.builtinAvailable = (await LanguageModel.availability(BUILTIN_OPTIONS)) === 'available';
  } catch {
    /* no built-in model */
  }
  try {
    const adapter = await (navigator as Navigator & { gpu?: Gpu }).gpu?.requestAdapter();
    caps.gpuAdapter = !!adapter;
    caps.shaderF16 = adapter?.features.has('shader-f16') === true;
    const { quota, usage } = await navigator.storage.estimate();
    if (quota !== undefined) caps.quotaFree = quota - (usage ?? 0);
  } catch {
    /* no WebGPU, or storage cannot be measured: the downloadable model is not offered */
  }
  return caps;
}

/** Text arriving in pieces becomes one block per finished sentence; every block leans on all supplied chunks. */
async function* blocks(pieces: AsyncIterable<string>): AsyncGenerator<GenEvent> {
  let text = '';
  yield { type: 'status' };
  for await (const piece of pieces) {
    text += piece;
    yield { type: 'delta', text: piece };
    const parts = splitLocalParagraphs(text);
    for (const raw of parts.complete) {
      const block = parseLocalBlock(raw);
      if (block.text) yield { type: 'block', ...block };
    }
    text = parts.rest;
  }
  if (text.trim()) yield { type: 'block', ...parseLocalBlock(text) };
  yield { type: 'done', stop: 'end_turn' };
}

async function* guarded(source: AsyncIterable<GenEvent>, signal: AbortSignal): AsyncGenerator<GenEvent> {
  try {
    yield* source;
  } catch (error) {
    // Stop is not a failure of the model.
    throw signal.aborted ? error : new ChatError('device');
  }
}

/** Tier A. One base session holds the rules; every question gets a clone, so no question sees another. */
export function createBuiltin(): Generator {
  let base: Promise<LanguageModelSession> | undefined;
  async function* pieces(prompt: string, signal: AbortSignal): AsyncGenerator<string> {
    if (signal.aborted) throw new DOMException('stopped', 'AbortError');
    if (typeof LanguageModel === 'undefined') throw new Error('no built-in model');
    if (!base) {
      // A previous capability probe can become stale after the browser evicts its model.
      // Recheck before create(), which otherwise starts a download without consent.
      base = (async () => {
        if ((await LanguageModel.availability(BUILTIN_OPTIONS)) !== 'available') throw new Error('built-in model is no longer available');
        if (signal.aborted) throw new DOMException('stopped', 'AbortError');
        return LanguageModel.create({ ...BUILTIN_OPTIONS, initialPrompts: [{ role: 'system', content: LOCAL_RULES }] });
      })().catch(error => { base = undefined; throw error; });
    }
    const session = await (await base).clone();
    const reader = session.promptStreaming(prompt, { signal }).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      session.destroy();
    }
  }
  return {
    id: 'builtin',
    conversational: true,
    citesSources: true,
    timeoutMs: 90_000,
    generate: ({ question, chunks, history, locale }, signal) => guarded(blocks(pieces(localRulesFor(question, chunks, history) + '\n' + buildLocalPrompt(question, chunks, { history, locale }), signal)), signal),
  };
}

export interface WebgpuModel {
  generator: Generator;
  /** Downloads (or reads from the browser's cache) and tests the model. */
  load(onProgress: Progress, signal: AbortSignal): Promise<void>;
  dispose(): void;
  opened(): void;
}

/** Tier B. `variant` is what `offerModes` found this device able to run. */
export function createWebgpu(variant: Variant, dialog: HTMLDialogElement): WebgpuModel {
  let worker: LocalWorker | undefined;
  let loading: Promise<void> | undefined;
  let loadingControl: AbortController | undefined;
  let asked = 0;
  let idle = 0;
  const active = new Set<() => void>();

  const opened = () => { window.clearTimeout(idle); idle = 0; };
  const dispose = () => {
    opened();
    loadingControl?.abort();
    loadingControl = undefined;
    for (const stop of active) stop();
    worker?.terminate();
    worker = undefined;
    loading = undefined;
  };
  window.addEventListener('pagehide', dispose);
  dialog.addEventListener('close', () => { opened(); idle = window.setTimeout(dispose, IDLE_MS); });

  /** Tokens of one answer, as they arrive from the worker. */
  async function* pieces(system: string, prompt: string, signal: AbortSignal, maxNewTokens?: number, from = worker): AsyncGenerator<string> {
    if (signal.aborted) throw new DOMException('stopped', 'AbortError');
    if (!from) throw new Error('the model is not loaded');
    const id = ++asked;
    const queue: (string | Error | null)[] = [];
    let wake = () => {};
    const unlisten = from.listen((reply) => {
      if (reply.type === 'token' && reply.id === id) queue.push(reply.text);
      else if (reply.type === 'end' && reply.id === id) queue.push(null);
      else if (reply.type === 'error' && (reply.id === undefined || reply.id === id)) queue.push(new Error(reply.message));
      else return;
      wake();
    });
    const stop = () => {
      try { from.send({ type: 'stop', id }); } catch { /* the worker may already be gone */ }
      queue.push(new DOMException('stopped', 'AbortError'));
      wake();
    };
    active.add(stop);
    signal.addEventListener('abort', stop);
    try {
      from.send({ type: 'generate', id, system, prompt, maxNewTokens });
      for (;;) {
        while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const item = queue.shift()!;
        if (item === null) return;
        if (item instanceof Error) throw item;
        yield item;
      }
    } finally {
      unlisten();
      active.delete(stop);
      signal.removeEventListener('abort', stop);
    }
  }

  async function selfTest(signal: AbortSignal, from: LocalWorker) {
    const probe = new AbortController(), abort = () => probe.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = window.setTimeout(abort, 20_000);
    try {
      let text = '';
      for await (const piece of pieces('You are a helpful assistant. Answer in English.', 'Explain overfitting in one short sentence.', probe.signal, 96, from)) text += piece;
      if (!/train|unseen|generaliz/i.test(text) || text.trim().split(/\s+/).length < 8) throw new Error('the model failed its quality probe');
    } finally { window.clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }

  async function start(dtype: string, onProgress: Progress, signal: AbortSignal) {
    const from = startWorker();
    worker = from;
    try {
      await loadModel(from, { type: 'llm-load', dtype }, onProgress, signal);
      await selfTest(signal, from);
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    } catch (error) {
      from.terminate();
      if (worker === from) {
        worker = undefined;
        if (!signal.aborted) await removeModel().catch(() => {});
      }
      throw error;
    }
  }

  function load(onProgress: Progress, signal: AbortSignal): Promise<void> {
    opened();
    if (signal.aborted) return Promise.reject(new DOMException('cancelled', 'AbortError'));
    if (loading) return loading;
    const control = loadingControl = new AbortController(), cancel = () => control.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const current = start(LOCAL_LLM.dtype[variant === 'q4f16' ? 'f16' : 'fallback'], onProgress, control.signal)
      // Half-precision shaders are the usual reason a model that loads still writes nonsense.
      .catch((error) => {
        if (loading === current) loading = undefined;
        throw error;
      }).finally(() => { signal.removeEventListener('abort', cancel); if (loadingControl === control) loadingControl = undefined; });
    loading = current;
    return loading;
  }

  return {
    load,
    dispose,
    opened,
    generator: {
      id: 'webgpu',
      conversational: true,
      citesSources: true,
      timeoutMs: 90_000,
      generate({ question, chunks, history, locale }, signal) {
        const run = async function* (): AsyncGenerator<GenEvent> {
          yield { type: 'status' };
          // After an idle release the model comes back from the browser's cache.
          await load(() => {}, signal);
          yield* blocks(pieces(localRulesFor(question, chunks, history), buildLocalPrompt(question, chunks, { history, locale }), signal));
        };
        return guarded(run(), signal);
      },
    },
  };
}

/** Deletes the downloaded model from the browser's cache. */
export async function removeModel(): Promise<void> {
  const cache = await caches.open('transformers-cache');
  for (const request of await cache.keys()) if (request.url.includes(LOCAL_LLM.id)) await cache.delete(request);
}
