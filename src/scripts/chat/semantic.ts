/**
 * "Smarter search": the optional semantic tier. The vectors of every chunk
 * were computed at build time (vectors.bin); here a small model in a worker
 * embeds the question. About 30 MB, downloaded only after the visitor agrees.
 */
import { EMBED, decodeVectors, vectorsMismatch, type Vectors } from '../../lib/chat/embed.ts';
import type { Kb } from '../../lib/chat/kb.ts';
import type { FromWorker, ToWorker } from './local.worker.ts';

/** A download that reports nothing for this long is given up. */
export const LOAD_STALL_MS = 30_000;
/** A question whose embedding takes longer is answered by keywords alone. */
export const QUERY_MS = 400;

export type Progress = (loaded: number, total: number) => void;

export interface Semantic {
  vectors: Vectors;
  /** The question's embedding, or nothing if it did not arrive in time. */
  embed(question: string): Promise<Float32Array | undefined>;
  dispose(): void;
}

export interface LocalWorker {
  send(message: ToWorker): void;
  /** Returns a function that stops listening. */
  listen(handler: (message: FromWorker) => void): () => void;
  terminate(): void;
}

export function startWorker(): LocalWorker {
  const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
  const handlers = new Set<(message: FromWorker) => void>();
  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => handlers.forEach((handler) => handler(event.data)));
  // A worker that fails to start (blocked script, no module workers) says so only here.
  worker.addEventListener('error', (event) => handlers.forEach((handler) => handler({ type: 'error', message: event.message || 'the worker failed to start' })));
  return {
    send: (message) => worker.postMessage(message),
    listen(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    terminate: () => worker.terminate(),
  };
}

/** Sends the load message and waits for the model. Rejects on an error, a stalled download, or `signal`. */
export function loadModel(worker: LocalWorker, message: ToWorker, onProgress: Progress, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    let stall = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stall);
      unlisten();
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(new DOMException('cancelled', 'AbortError'));
    const watch = () => {
      window.clearTimeout(stall);
      stall = window.setTimeout(() => finish(new Error('the download stalled')), LOAD_STALL_MS);
    };
    const unlisten = worker.listen((reply) => {
      if (reply.type === 'progress') {
        watch();
        onProgress(reply.loaded, reply.total);
      } else if (reply.type === 'ready') finish();
      else if (reply.type === 'error') finish(new Error(reply.message));
    });
    signal.addEventListener('abort', cancel);
    watch();
    try { worker.send(message); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

/** Fetches and checks the vectors, then loads the model. Throws if either cannot be used with this knowledge base. */
export async function loadSemantic(kb: Kb, onProgress: Progress, signal: AbortSignal): Promise<Semantic> {
  const response = await fetch('/chat/vectors.bin', { signal });
  if (!response.ok) throw new Error(`vectors.bin: HTTP ${response.status}`);
  const vectors = decodeVectors(new Uint8Array(await response.arrayBuffer()));
  const mismatch = vectorsMismatch(vectors, kb);
  if (mismatch) throw new Error(mismatch);

  const worker = startWorker();
  try {
    await loadModel(worker, { type: 'embed-load' }, onProgress, signal);
  } catch (error) {
    worker.terminate();
    throw error;
  }

  let sent = 0;
  const waiting = new Map<number, (vector: Float32Array | undefined) => void>();
  worker.listen((reply) => {
    if (reply.type !== 'vector' && reply.type !== 'error') return;
    if (reply.id === undefined) return;
    waiting.get(reply.id)?.(reply.type === 'vector' && reply.vector.length === EMBED.dim ? reply.vector : undefined);
    waiting.delete(reply.id);
  });

  return {
    vectors,
    embed(question) {
      const id = ++sent;
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => waiting.get(id)?.(undefined), QUERY_MS);
        waiting.set(id, (vector) => {
          window.clearTimeout(timer);
          waiting.delete(id);
          resolve(vector);
        });
        worker.send({ type: 'embed', id, text: EMBED.queryPrefix + question });
      });
    },
    dispose: () => worker.terminate(),
  };
}
