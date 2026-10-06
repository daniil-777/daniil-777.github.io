/** Book-owned local inference; shares only the existing worker transport and asset config. */
import { LOCAL_LLM } from '../../data/chat.ts';
import type { Generator, GenEvent } from '../chat/types.ts';
import { loadModel, type LocalWorker, type Progress } from '../../scripts/chat/semantic.ts';
import type { FromWorker } from './local.worker.ts';
import { BOOK_LOCAL_RULES, buildBookLocalPrompt } from './local-prompt.ts';
import { bookLocalEvents } from './local-response.ts';

const BUILTIN_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};
/** Includes the selected q4 weights, tokenizer and matching same-origin runtime. */
export const BOOK_LOCAL_DOWNLOAD_BYTES = 885_000_000;
/** Extra capabilities are local to this adapter and do not change shared chat types. */
export interface BookGenerator extends Generator { citesSources: true; timeoutMs: number }
export interface BookDeviceOffer { builtin: boolean; webgpu: false | 'q4' }
type Gpu = { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };

export async function probeBookDevice(signal: AbortSignal): Promise<BookDeviceOffer> {
  signal.throwIfAborted();
  let builtin = false;
  try { builtin = typeof LanguageModel !== 'undefined' && await LanguageModel.availability(BUILTIN_OPTIONS) === 'available'; }
  catch { /* Browser does not expose an already installed model. */ }
  signal.throwIfAborted();
  if (builtin) return { builtin: true, webgpu: false };
  const nav = navigator as Navigator & { gpu?: Gpu; deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
  if (nav.connection?.saveData || /^(?:slow-)?2g$|^3g$/.test(nav.connection?.effectiveType ?? '') || (nav.deviceMemory !== undefined && nav.deviceMemory < 8)) return { builtin, webgpu: false };
  try {
    const adapter = await nav.gpu?.requestAdapter();
    const { quota, usage } = await nav.storage.estimate();
    signal.throwIfAborted();
    // Float32 activations keep the book independent of half-precision shader quality.
    if (adapter && quota !== undefined && quota - (usage ?? 0) >= 2 * BOOK_LOCAL_DOWNLOAD_BYTES) return { builtin, webgpu: 'q4' };
  } catch { signal.throwIfAborted(); }
  return { builtin, webgpu: false };
}

export function createBookBuiltin(): { generator: BookGenerator; dispose(): void } {
  let session: LanguageModelSession | undefined;
  let disposed = false;
  return {
    dispose() { disposed = true; session?.destroy(); session = undefined; },
    generator: {
      id: 'builtin', conversational: true, citesSources: true, timeoutMs: 90_000,
      async *generate({ question, chunks }, signal) {
        signal.throwIfAborted();
        if (disposed || typeof LanguageModel === 'undefined' || await LanguageModel.availability(BUILTIN_OPTIONS) !== 'available') throw new Error('Local language model is no longer available');
        signal.throwIfAborted();
        const current = await LanguageModel.create({ ...BUILTIN_OPTIONS, initialPrompts: [{ role: 'system', content: BOOK_LOCAL_RULES }] });
        session = current;
        let reader: ReadableStreamDefaultReader<string> | undefined;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          void reader?.cancel().catch(() => {});
          if (session === current) { current.destroy(); session = undefined; }
        };
        const pieces = async function* () {
          try {
            signal.throwIfAborted();
            if (disposed) throw new DOMException('Book model disposed', 'AbortError');
            reader = current.promptStreaming(buildBookLocalPrompt(question, chunks), { signal }).getReader();
            for (;;) {
              const next = await reader.read();
              if (next.done) return;
              yield next.value;
            }
          } finally { release(); }
        };
        try { yield* bookLocalEvents(pieces()); } finally { release(); }
      },
    },
  };
}

export interface BookWebgpu {
  generator: BookGenerator;
  load(progress: Progress, signal: AbortSignal): Promise<void>;
  dispose(): void;
}
function startBookWorker(): LocalWorker {
  const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
  const handlers = new Set<Parameters<LocalWorker['listen']>[0]>();
  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => handlers.forEach(handler => handler(event.data)));
  worker.addEventListener('error', event => handlers.forEach(handler => handler({ type: 'error', message: event.message || 'Book worker failed to start' })));
  return {
    send: message => worker.postMessage(message),
    listen(handler) { handlers.add(handler); return () => { handlers.delete(handler); }; },
    terminate() { handlers.clear(); worker.terminate(); },
  };
}
/** Injectable transport supports focused lifecycle tests without downloading a model. */
export function createBookWebgpu(factory: () => LocalWorker = startBookWorker): BookWebgpu {
  let worker: LocalWorker | undefined, loading: Promise<void> | undefined;
  let loadingControl: AbortController | undefined;
  let asked = 0;
  const active = new Set<() => void>();
  const dispose = () => {
    loadingControl?.abort(); loadingControl = undefined;
    for (const cancel of active) cancel();
    worker?.terminate(); worker = undefined; loading = undefined;
  };
  // Bind the existing worker protocol in both checkouts. Production ignores the optional request ID on stop.
  const send = (from: LocalWorker, message: { type: 'stop'; id: number } | { type: 'generate'; id: number; system: string; prompt: string; maxNewTokens?: number }) => from.send(message as Parameters<LocalWorker['send']>[0]);
  async function* pieces(from: LocalWorker, system: string, prompt: string, signal: AbortSignal): AsyncGenerator<string> {
    signal.throwIfAborted();
    const id = ++asked, queue: (string | Error | null)[] = [];
    let wake = () => {}, stopped = false;
    const unlisten = from.listen(reply => {
      if (reply.type === 'token' && reply.id === id) queue.push(reply.text);
      else if (reply.type === 'end' && reply.id === id) queue.push(null);
      else if (reply.type === 'error' && (reply.id === undefined || reply.id === id)) queue.push(new Error(reply.message));
      else return;
      wake();
    });
    const cancel = () => {
      if (stopped) return;
      stopped = true;
      try { send(from, { type: 'stop', id }); } catch { /* Worker may already have terminated. */ }
      queue.push(new DOMException('Book generation cancelled', 'AbortError')); wake();
    };
    active.add(cancel); signal.addEventListener('abort', cancel, { once: true });
    try {
      send(from, { type: 'generate', id, system, prompt, maxNewTokens: 96 });
      for (;;) {
        while (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
        signal.throwIfAborted();
        const item = queue.shift()!;
        if (item === null) return;
        if (item instanceof Error) throw item;
        yield item;
      }
    } finally { unlisten(); active.delete(cancel); signal.removeEventListener('abort', cancel); }
  }
  async function start(progress: Progress, signal: AbortSignal) {
    signal.throwIfAborted();
    const from = factory(); worker = from;
    try {
      await loadModel(from, { type: 'llm-load', dtype: LOCAL_LLM.dtype.fallback }, progress, signal);
      signal.throwIfAborted();
      const quality = new AbortController(), cancel = () => quality.abort();
      signal.addEventListener('abort', cancel, { once: true });
      const timer = window.setTimeout(cancel, 20_000);
      try {
        let text = '';
        for await (const part of pieces(from, 'Explain clearly in English.', 'Explain overfitting in one short sentence.', quality.signal)) text += part;
        if (!/train|unseen|generaliz/i.test(text) || text.trim().split(/\s+/).length < 8) throw new Error('Local book model failed its quality check');
      } finally { window.clearTimeout(timer); signal.removeEventListener('abort', cancel); }
      signal.throwIfAborted();
    } catch (error) { from.terminate(); if (worker === from) worker = undefined; throw error; }
  }
  function load(progress: Progress, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Book model load cancelled', 'AbortError'));
    if (loading) return loading;
    const control = loadingControl = new AbortController(), cancel = () => control.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const current = start(progress, control.signal).catch(error => { if (loading === current) loading = undefined; throw error; })
      .finally(() => { signal.removeEventListener('abort', cancel); if (loadingControl === control) loadingControl = undefined; });
    loading = current; return loading;
  }
  return {
    load, dispose,
    generator: {
      id: 'webgpu', conversational: true, citesSources: true, timeoutMs: 90_000,
      async *generate({ question, chunks }, signal): AsyncGenerator<GenEvent> {
        signal.throwIfAborted(); yield { type: 'status' };
        await load(() => {}, signal);
        if (!worker) throw new Error('Local book model is not loaded');
        yield* bookLocalEvents(pieces(worker, BOOK_LOCAL_RULES, buildBookLocalPrompt(question, chunks), signal));
      },
    },
  };
}
