/**
 * Models that run on the visitor's device, off the main thread. The only
 * browser file that imports transformers.js, so nothing of it is downloaded
 * until a visitor asks for "Smarter search" or "On this device".
 *
 * Two roles: `embed` turns a question into a vector (wasm), `generate` writes
 * an answer with a small language model (WebGPU).
 */
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, TextStreamer } from '@huggingface/transformers';
import * as transformers from '@huggingface/transformers';
import { LOCAL_LLM } from '../../data/chat.ts';
import { createEmbedder, type Embedder, type Transformers } from '../../lib/chat/embed.ts';

// The matching runtime is served locally; no CDN scripts or blob module factories.
transformers.env.backends.onnx.wasm!.wasmPaths = {
  mjs: '/chat/runtime/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: '/chat/runtime/ort-wasm-simd-threaded.asyncify.wasm',
};
transformers.env.backends.onnx.wasm!.numThreads = 1;
transformers.env.useWasmCache = false;

export type ToWorker =
  | { type: 'embed-load' }
  | { type: 'embed'; id: number; text: string }
  | { type: 'llm-load'; dtype: string }
  | { type: 'generate'; id: number; system: string; prompt: string; maxNewTokens?: number }
  | { type: 'stop'; id: number };

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'vector'; id: number; vector: Float32Array }
  | { type: 'token'; id: number; text: string }
  | { type: 'end'; id: number }
  | { type: 'error'; id?: number; message: string };

const scope = self as unknown as { postMessage(message: FromWorker, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent<ToWorker>) => void) | null };
const post = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Bytes over all files of the model, so one bar can show the whole download. */
const files = new Map<string, { loaded: number; total: number }>();
function progress(info: { status: string; file?: string; loaded?: number; total?: number }) {
  if (info.status !== 'progress' || !info.file || !info.total) return;
  files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
  let loaded = 0;
  let total = 0;
  for (const file of files.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  post({ type: 'progress', loaded, total });
}

let embedder: Embedder | undefined;
type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
let llm: { tokenizer: Tokenizer; model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>> } | undefined;
const stopper = new InterruptableStoppingCriteria();
let currentId: number | undefined;
const canceled = new Set<number>();
const pending = new Set<number>();

async function generate(id: number, system: string, prompt: string, maxNewTokens = 1024) {
  if (!llm) throw new Error('the model is not loaded');
  if (canceled.delete(id)) { post({ type: 'end', id }); return; }
  currentId = id;
  stopper.reset();
  const inputs = llm.tokenizer.apply_chat_template(
    [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    { add_generation_prompt: true, return_dict: true },
  );
  const streamer = new TextStreamer(llm.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (text: string) => post({ type: 'token', id, text }) });
  // Greedy decoding: the same passages give the same answer.
  await llm.model.generate({ ...(inputs as object), max_new_tokens: Math.min(1024, Math.max(1, maxNewTokens)), do_sample: false, repetition_penalty: 1.05, streamer, stopping_criteria: stopper });
  post({ type: 'end', id });
  currentId = undefined;
}

let generating = Promise.resolve();
scope.onmessage = async ({ data }) => {
  try {
    if (data.type === 'embed-load') {
      embedder = await createEmbedder(transformers as unknown as Transformers, { device: 'wasm', progress_callback: progress });
      // The first run compiles the graph; do it now, not inside the visitor's first question.
      await embedder.embed('warm up');
      post({ type: 'ready' });
    } else if (data.type === 'embed') {
      if (!embedder) throw new Error('the model is not loaded');
      const vector = await embedder.embed(data.text);
      post({ type: 'vector', id: data.id, vector }, [vector.buffer]);
    } else if (data.type === 'llm-load') {
      files.clear();
      const source = { revision: LOCAL_LLM.revision };
      const tokenizer = await AutoTokenizer.from_pretrained(LOCAL_LLM.id, source);
      const model = await AutoModelForCausalLM.from_pretrained(LOCAL_LLM.id, { ...source, dtype: data.dtype as 'q4', device: 'webgpu', progress_callback: progress });
      llm = { tokenizer, model };
      post({ type: 'ready' });
    } else if (data.type === 'generate') {
      pending.add(data.id);
      const run = generating.then(() => generate(data.id, data.system, data.prompt, data.maxNewTokens)).finally(() => {
        pending.delete(data.id); canceled.delete(data.id); if (currentId === data.id) currentId = undefined;
      });
      generating = run.catch(() => {});
      await run;
    } else if (data.type === 'stop') {
      if (currentId === data.id) stopper.interrupt();
      else if (pending.has(data.id)) canceled.add(data.id);
    }
  } catch (error) {
    post({ type: 'error', id: 'id' in data ? data.id : undefined, message: reason(error) });
  }
};
