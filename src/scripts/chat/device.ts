/**
 * "On this device": answers written by a model in the visitor's browser.
 * Tier A is the browser's own model (no download); tier B is a downloadable
 * model on WebGPU. Loaded only when `DEVICE_MODE` in src/data/chat.ts allows
 * it, and that ships as `off`: nothing here has been verified in a browser.
 */
import { LOCAL_LLM } from '../../data/chat.ts';
import type { Capabilities } from '../../lib/chat/modes.ts';
import { LOCAL_RULES, buildLocalPrompt } from '../../lib/chat/prompt.ts';
import { sentences } from '../../lib/chat/text.ts';
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
async function* blocks(pieces: AsyncIterable<string>, cites: string[]): AsyncGenerator<GenEvent> {
  let text = '';
  yield { type: 'status' };
  for await (const piece of pieces) {
    text += piece;
    const parts = sentences(text);
    while (parts.length > 1) yield { type: 'block', text: parts.shift()!, cites };
    text = parts[0] ?? '';
  }
  if (text.trim()) yield { type: 'block', text: text.trim(), cites };
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
    if (typeof LanguageModel === 'undefined') throw new Error('no built-in model');
    base ??= LanguageModel.create({ ...BUILTIN_OPTIONS, initialPrompts: [{ role: 'system', content: LOCAL_RULES }] });
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
    generate: ({ question, chunks }, signal) => guarded(blocks(pieces(buildLocalPrompt(question, chunks), signal), chunks.map((chunk) => chunk.id)), signal),
  };
}

export interface WebgpuModel {
  generator: Generator;
  /** Downloads (or reads from the browser's cache) and tests the model. */
  load(onProgress: Progress, signal: AbortSignal): Promise<void>;
  dispose(): void;
}

/** Tier B. `variant` is what `offerModes` found this device able to run. */
export function createWebgpu(variant: Variant, dialog: HTMLDialogElement): WebgpuModel {
  let worker: LocalWorker | undefined;
  let loading: Promise<void> | undefined;
  let asked = 0;
  let idle = 0;

  const dispose = () => {
    worker?.terminate();
    worker = undefined;
    loading = undefined;
  };
  window.addEventListener('pagehide', dispose);
  dialog.addEventListener('close', () => (idle = window.setTimeout(dispose, IDLE_MS)));

  /** Tokens of one answer, as they arrive from the worker. */
  async function* pieces(system: string, prompt: string, signal: AbortSignal): AsyncGenerator<string> {
    const from = worker;
    if (!from) throw new Error('the model is not loaded');
    const id = ++asked;
    const queue: (string | Error | null)[] = [];
    let wake = () => {};
    const unlisten = from.listen((reply) => {
      if (reply.type === 'token' && reply.id === id) queue.push(reply.text);
      else if (reply.type === 'end' && reply.id === id) queue.push(null);
      else if (reply.type === 'error') queue.push(new Error(reply.message));
      else return;
      wake();
    });
    const stop = () => {
      from.send({ type: 'stop' });
      queue.push(new DOMException('stopped', 'AbortError'));
      wake();
    };
    signal.addEventListener('abort', stop);
    from.send({ type: 'generate', id, system, prompt });
    try {
      for (;;) {
        while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const item = queue.shift()!;
        if (item === null) return;
        if (item instanceof Error) throw item;
        yield item;
      }
    } finally {
      unlisten();
      signal.removeEventListener('abort', stop);
    }
  }

  async function selfTest(signal: AbortSignal) {
    let text = '';
    for await (const piece of pieces('', 'Reply with the single word OK.', signal)) text += piece;
    if (!/\bOK\b/i.test(text)) throw new Error('the model failed its self-test');
  }

  async function start(dtype: string, onProgress: Progress, signal: AbortSignal) {
    worker = startWorker();
    try {
      await loadModel(worker, { type: 'llm-load', dtype }, onProgress, signal);
      await selfTest(signal);
    } catch (error) {
      worker?.terminate();
      worker = undefined;
      throw error;
    }
  }

  function load(onProgress: Progress, signal: AbortSignal): Promise<void> {
    window.clearTimeout(idle);
    loading ??= start(LOCAL_LLM.dtype[variant === 'q4f16' ? 'f16' : 'fallback'], onProgress, signal)
      // Half-precision shaders are the usual reason a model that loads still writes nonsense.
      .catch((error) => (variant === 'q4f16' && !signal.aborted ? start(LOCAL_LLM.dtype.fallback, onProgress, signal) : Promise.reject(error)))
      .catch((error) => {
        loading = undefined;
        throw error;
      });
    return loading;
  }

  return {
    load,
    dispose,
    generator: {
      id: 'webgpu',
      generate({ question, chunks }, signal) {
        const run = async function* (): AsyncGenerator<GenEvent> {
          // After an idle release the model comes back from the browser's cache.
          await load(() => {}, signal);
          yield* blocks(pieces(LOCAL_RULES, buildLocalPrompt(question, chunks), signal), chunks.map((chunk) => chunk.id));
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
