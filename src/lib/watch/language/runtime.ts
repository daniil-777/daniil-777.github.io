import type { GenerationRequest, LanguageCommand, LanguageEvent, ModelManifest } from './protocol.ts';
import { ByteBpeTokenizer, type ByteBpeData } from './tokenizer.ts';
import { checkedAsset, validateManifest } from './model.ts';
import type * as Ort from 'onnxruntime-web';

/** A single cached-decoder graph handles prefill and token steps; no duplicate weight session. */
export class LocalLanguageRuntime {
  private ort?: typeof Ort;
  private session?: Ort.InferenceSession;
  private tokenizer?: ByteBpeTokenizer;
  private revision = 0;
  private activeId?: string;
  private manifest?: ModelManifest;
  private loadController?: AbortController;
  private loadingId?: string;
  private emit: (event: LanguageEvent) => void;
  constructor(emit: (event: LanguageEvent) => void) { this.emit = emit; }
  async load(requestId: string, manifestUrl: string): Promise<void> {
    const revision = ++this.revision;
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller; this.loadingId = requestId;
    await this.releaseSession();
    this.emit({ type: 'status', requestId, status: 'loading' });
    const url = new URL(manifestUrl, location.href);
    if (url.origin !== location.origin) throw new Error('Manifest must be same origin');
    const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw new Error('Language manifest unavailable');
    const manifest = validateManifest(await response.json());
    this.manifest = manifest;
    if (!manifest.trained || manifest.releaseStatus !== 'released' || manifest.quality.releasePassed !== true || !manifest.model || !manifest.tokenizer) {
      this.emit({ type: 'status', requestId, status: 'unavailable', detail: manifest.reason ?? 'Local model has not passed its release gates.' }); return;
    }
    const [model, tokenizer] = await Promise.all([
      checkedAsset(new URL(manifest.model.url, url), manifest.model.sha256, manifest.model.bytes, controller.signal),
      checkedAsset(new URL(manifest.tokenizer.url, url), manifest.tokenizer.sha256, manifest.tokenizer.bytes, controller.signal),
    ]);
    if (revision !== this.revision) return;
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1; // Works without cross-origin isolation or SharedArrayBuffer.
    ort.env.wasm.proxy = false; // Already inside our own dedicated worker.
    ort.env.wasm.initTimeout = 30000;
    const assets = manifest.runtimeAssets;
    if (!assets || assets.length !== 2) throw new Error('Verified WASM runtime assets are required');
    const mjs = assets.find(a => a.url.endsWith('.mjs'));
    const wasm = assets.find(a => a.url.endsWith('.wasm'));
    if (!mjs || !wasm) throw new Error('Incomplete WASM runtime assets');
    const [mjsBytes, wasmBytes] = await Promise.all([
      checkedAsset(new URL(mjs.url, url), mjs.sha256, mjs.bytes, controller.signal),
      checkedAsset(new URL(wasm.url, url), wasm.sha256, wasm.bytes, controller.signal),
    ]);
    if (revision !== this.revision) return;
    // 1.23.0's Emscripten module constructs a URL relative to import.meta.url even
    // with wasmBinary supplied; blob module URLs fail that constructor. Verify
    // its immutable same-origin file, then import that exact versioned URL.
    void mjsBytes;
    ort.env.wasm.wasmPaths = { mjs: new URL(mjs.url, url).href };
    ort.env.wasm.wasmBinary = wasmBytes;
    let session: Ort.InferenceSession;
    try { session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); }
    finally { ort.env.wasm.wasmBinary = undefined; }
    if (revision !== this.revision) { await session.release(); return; }
    this.ort = ort; this.session = session;
    this.tokenizer = new ByteBpeTokenizer(JSON.parse(new TextDecoder().decode(tokenizer)) as ByteBpeData);
    this.emit({ type: 'status', requestId, status: 'ready' });
  }
  cancel(requestId: string): void {
    if (this.activeId === requestId) { ++this.revision; this.activeId = undefined; }
    if (this.loadingId === requestId) { ++this.revision; this.loadController?.abort(); this.loadingId = undefined; }
  }
  async generate(request: GenerationRequest): Promise<void> {
    const { session, ort, tokenizer } = this;
    if (!session || !ort || !tokenizer) throw new Error(this.manifest?.reason ?? 'Local language model unavailable');
    const revision = ++this.revision;
    this.activeId = request.requestId;
    const max = Math.min(64, Math.max(1, Math.floor(request.maxNewTokens)));
    const { ids } = tokenizer.prompt(request);
    let input = ids;
    let position = 0;
    let past: Ort.Tensor = new ort.Tensor('float32', new Float32Array(0), [4, 2, 1, 2, 0, 32]);
    const outputIds: number[] = [];
    const start = performance.now();
    let firstTokenMs = 0, finishReason: 'eos' | 'limit' = 'limit';
    try {
      for (let step = 0; step < max; step++) {
        if (revision !== this.revision) { this.emit({ type: 'cancelled', requestId: request.requestId }); return; }
        const tokens = new ort.Tensor('int64', BigInt64Array.from(input, BigInt), [1, input.length]);
        const positions = new ort.Tensor('int64', BigInt64Array.from(input, (_, i) => BigInt(position + i)), [1, input.length]);
        const mask = new ort.Tensor('float32', new Float32Array(position + input.length).fill(1), [1, position + input.length]);
        const result = await session.run({ input_ids: tokens, position_ids: positions, attention_mask: mask, past });
        tokens.dispose(); positions.dispose(); mask.dispose(); past.dispose();
        past = result.present;
        const logits = result.logits.data as Float32Array;
        const offset = logits.length - 4096;
        let token = 0, best = -Infinity;
        for (let i = 0; i < 4096; i++) if (i === 2 || i >= 9) {
          if (logits[offset + i] > best) { best = logits[offset + i]; token = i; }
        }
        result.logits.dispose();
        if (!step) firstTokenMs = performance.now() - start;
        if (revision !== this.revision) { this.emit({ type: 'cancelled', requestId: request.requestId }); return; }
        if (token === tokenizer.eos) { finishReason = 'eos'; break; }
        outputIds.push(token);
        this.emit({ type: 'token', requestId: request.requestId, tokenId: token, tokenText: tokenizer.decode([token]) });
        position += input.length; input = [token];
        // Yield so mode switching and cancellation are serviced between tokens.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      this.emit({ type: 'complete', requestId: request.requestId, text: tokenizer.decode(outputIds), tokens: outputIds.length, firstTokenMs, totalMs: performance.now() - start, finishReason });
    } finally { past.dispose(); if (this.activeId === request.requestId) this.activeId = undefined; }
  }
  private async releaseSession(): Promise<void> {
    const session = this.session; this.session = undefined; this.tokenizer = undefined;
    if (session) await session.release();
  }
  async dispose(requestId: string): Promise<void> { ++this.revision; this.loadController?.abort(); this.activeId = undefined; await this.releaseSession(); this.emit({ type: 'status', requestId, status: 'disposed' }); }
}

type CompleteEvent = Extract<LanguageEvent, { type: 'complete' }>;
type StatusEvent = Extract<LanguageEvent, { type: 'status' }>;
/** Lazy browser facade. Constructing this object performs no download or model initialization. */
export class WatchLanguageClient {
  private worker?: Worker;
  private sequence = 0;
  private activeId?: string;
  private pending = new Map<string, { resolve: (event: LanguageEvent) => void; reject: (error: Error) => void }>();
  private state: StatusEvent['status'] = 'unavailable';
  private onEvent: (event: LanguageEvent) => void;
  constructor(onEvent: (event: LanguageEvent) => void = () => {}) { this.onEvent = onEvent; }
  get status(): StatusEvent['status'] { return this.state; }
  async init(manifestUrl = '/watch/language/manifest.json'): Promise<StatusEvent> {
    for (const id of this.pending.keys()) this.cancel(id);
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'chronos-language' });
      this.worker.addEventListener('message', (event: MessageEvent<LanguageEvent>) => this.receive(event.data));
      this.worker.addEventListener('error', () => { for (const entry of this.pending.values()) entry.reject(new Error('Language worker failed')); this.pending.clear(); this.state = 'unavailable'; });
    }
    this.cancel();
    const requestId = `load-${++this.sequence}`;
    return await this.send({ type: 'load', requestId, manifestUrl }, requestId) as StatusEvent;
  }
  async generate(request: GenerationRequest): Promise<CompleteEvent> {
    if (!this.worker || this.state !== 'ready') throw new Error('A released local model is unavailable.');
    this.cancel();
    this.activeId = request.requestId;
    return await this.send({ type: 'generate', request }, request.requestId) as CompleteEvent;
  }
  cancel(requestId = this.activeId): void {
    if (!requestId) return;
    this.worker?.postMessage({ type: 'cancel', requestId } satisfies LanguageCommand);
    this.pending.get(requestId)?.reject(new Error('Language generation cancelled'));
    this.pending.delete(requestId);
    if (this.activeId === requestId) this.activeId = undefined;
  }
  async dispose(): Promise<void> {
    for (const id of this.pending.keys()) this.cancel(id);
    const worker = this.worker;
    if (!worker) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const requestId = `dispose-${++this.sequence}`;
      await Promise.race([this.send({ type: 'dispose', requestId }, requestId), new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
    } finally {
      if (timer) clearTimeout(timer);
      worker.terminate(); this.worker = undefined; this.state = 'disposed';
      for (const entry of this.pending.values()) entry.reject(new Error('Language worker disposed'));
      this.pending.clear();
    }
  }
  private send(command: LanguageCommand, requestId: string): Promise<LanguageEvent> {
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject }); this.worker?.postMessage(command);
    });
  }
  private receive(event: LanguageEvent): void {
    if (event.type === 'status') this.state = event.status;
    const entry = this.pending.get(event.requestId);
    if (!entry) return; // Stale mode/generation events cannot update the caller.
    this.onEvent(event);
    if (event.type === 'error' || event.type === 'cancelled') {
      entry.reject(new Error(event.type === 'error' ? event.message : 'Language generation cancelled'));
      this.pending.delete(event.requestId);
    } else if (event.type === 'complete' || event.type === 'status' && event.status !== 'loading') {
      entry.resolve(event); this.pending.delete(event.requestId);
      if (this.activeId === event.requestId) this.activeId = undefined;
    }
  }
}
