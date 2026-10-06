/** Consent and preparation shared by manual selection and OpenAI fallback. */
import { COPY, LOCAL_LLM } from '../../data/chat.ts';
import type { Kb } from '../../lib/chat/kb.ts';
import type { Offer } from '../../lib/chat/modes.ts';
import type { Generator } from '../../lib/chat/types.ts';
import type { Mode, View } from './view.ts';
import type { Progress, Semantic } from './semantic.ts';

interface Options {
  kb: Kb; dialog: HTMLDialogElement; view: View;
  offer(): Offer; mode(): Mode; select(mode: Mode): void; changed(): void; failed(): void; stop(): void;
  read(key: string): string | null; write(key: string, value: string): void;
}
export function createOptionalModels(options: Options) {
  const { kb, dialog, view, read, write } = options;
  let semantic: Semantic | undefined, semanticLoad: Promise<void> | undefined;
  let device: { generator: Generator } | undefined;
  let candidate: import('./device.ts').WebgpuModel | undefined;
  let preparing: Promise<Generator | undefined> | undefined;
  let cancelPreparation: (() => void) | undefined;
  const canSearch = () => options.offer().semantic && kb.embedding !== null && 'Worker' in window && !semantic && !semanticLoad;
  function loadSemantic(progress: Progress, signal: AbortSignal): Promise<void> {
    if (semantic) return Promise.resolve();
    if (semanticLoad) return semanticLoad;
    const current = (async () => {
      try {
        semantic = await (await import('./semantic.ts')).loadSemantic(kb, progress, signal);
        write('chat:semantic', '1'); view.hint('Smarter search is on.'); view.status('Smarter search is on');
      } catch { if (!signal.aborted) view.hint(COPY.notice.semanticFailed); }
    })().finally(() => { if (semanticLoad === current) semanticLoad = undefined; options.changed(); });
    semanticLoad = current; return current;
  }
  const wait = (ready: Promise<Generator | undefined>, signal?: AbortSignal) => {
    if (!signal) return ready;
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise<Generator | undefined>(resolve => {
      const abort = () => { cancelPreparation?.(); resolve(undefined); };
      signal.addEventListener('abort', abort, { once: true });
      void ready.then(resolve).finally(() => signal.removeEventListener('abort', abort));
    });
  };
  function local(signal?: AbortSignal): Promise<Generator | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined);
    if (device) return Promise.resolve(device.generator);
    if (preparing) return wait(preparing, signal);
    const control = new AbortController();
    let complete!: (generator?: Generator) => void;
    const current = new Promise<Generator | undefined>(resolve => { complete = resolve; });
    preparing = current;
    let settled = false;
    const finish = (generator?: Generator) => {
      if (settled) return;
      settled = true; dialog.removeEventListener('close', cancel);
      if (preparing === current) { preparing = undefined; cancelPreparation = undefined; }
      complete(generator); options.changed();
    };
    const cancel = () => {
      if (settled) return;
      control.abort(); finish(); view.cancelConsent();
      if (options.mode() === 'device') options.select('quotes');
    };
    cancelPreparation = cancel; dialog.addEventListener('close', cancel, { once: true });
    void (async () => {
      try {
        const { createBuiltin, createWebgpu, removeModel } = await import('./device.ts');
        if (control.signal.aborted) return;
        const offer = options.offer();
        if (offer.builtin) { device = { generator: createBuiltin() }; finish(device.generator); return; }
        if (!offer.webgpu) { finish(); return; }
        const key = `chat:device:${LOCAL_LLM.id}:${LOCAL_LLM.revision}:${offer.webgpu}`;
        const model = candidate ??= createWebgpu(offer.webgpu, dialog);
        const load = async (progress: Progress, consentSignal: AbortSignal) => {
          const abort = () => control.abort();
          consentSignal.addEventListener('abort', abort, { once: true });
          if (consentSignal.aborted) abort();
          try {
            await model.load(progress, control.signal);
            if (control.signal.aborted || settled) return;
            device = model; write(key, '1');
            view.hint('', { label: COPY.device.remove, run() {
              options.stop(); model.dispose(); device = undefined; write(key, '');
              void removeModel().catch(() => {}); options.select('quotes');
            } });
            finish(device.generator);
          } catch {
            if (settled) return;
            if (control.signal.aborted) { finish(); if (options.mode() === 'device') options.select('quotes'); }
            else { finish(); options.failed(); }
          } finally { consentSignal.removeEventListener('abort', abort); }
        };
        if (read(key)) void load(() => {}, control.signal);
        else view.consent(COPY.device, load, () => {
          control.abort(); finish(); if (options.mode() === 'device') options.select('quotes');
        });
      } catch { if (!settled) { finish(); if (!control.signal.aborted) options.failed(); } }
    })();
    return wait(current, signal);
  }
  return {
    local, generator: () => device?.generator, semantic: () => semantic, canSearch,
    cancel() { cancelPreparation?.(); },
    offerSemantic() { if (canSearch()) view.consent(COPY.semantic, loadSemantic); },
    restoreSearch() { if (read('chat:semantic') && canSearch()) void loadSemantic(() => {}, new AbortController().signal); },
    opened() { candidate?.opened(); },
  };
}
