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

export type ToWorker =
  | { type: 'embed-load' }
  | { type: 'embed'; id: number; text: string }
  | { type: 'llm-load'; dtype: string }
  | { type: 'generate'; id: number; system: string; prompt: string }
  | { type: 'stop' };

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

async function generate(id: number, system: string, prompt: string) {
  if (!llm) throw new Error('the model is not loaded');
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
  await llm.model.generate({ ...(inputs as object), max_new_tokens: 200, do_sample: false, repetition_penalty: 1.05, streamer, stopping_criteria: stopper });
  post({ type: 'end', id });
}

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
      const source = { revision: LOCAL_LLM.revision };
      const tokenizer = await AutoTokenizer.from_pretrained(LOCAL_LLM.id, source);
      const model = await AutoModelForCausalLM.from_pretrained(LOCAL_LLM.id, { ...source, dtype: data.dtype as 'q4', device: 'webgpu', progress_callback: progress });
      llm = { tokenizer, model };
      post({ type: 'ready' });
    } else if (data.type === 'generate') {
      await generate(data.id, data.system, data.prompt);
    } else if (data.type === 'stop') {
      stopper.interrupt();
    }
  } catch (error) {
    post({ type: 'error', id: 'id' in data ? data.id : undefined, message: reason(error) });
  }
};
