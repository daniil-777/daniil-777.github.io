/** Messages cross a dedicated worker; inference never runs in the clock loop. */
export type LanguageMode = 'ai' | 'profile' | 'wellbeing';
export interface ContextFact { id: string; text: string }
export interface GenerationRequest {
  requestId: string;
  mode: LanguageMode;
  question?: string;
  factIds: string[];
  /** Resolved by the caller from the currently reviewed public pack. */
  facts: ContextFact[];
  maxNewTokens: number;
}
export interface TokenEvent { requestId: string; tokenId: number; tokenText: string }
export type LanguageCommand =
  | { type: 'load'; requestId: string; manifestUrl: string }
  | { type: 'generate'; request: GenerationRequest }
  | { type: 'cancel'; requestId: string }
  | { type: 'dispose'; requestId: string };
export type LanguageEvent =
  | { type: 'status'; requestId: string; status: 'loading' | 'ready' | 'unavailable' | 'disposed'; detail?: string }
  | ({ type: 'token' } & TokenEvent)
  | { type: 'complete'; requestId: string; text: string; tokens: number; firstTokenMs: number; totalMs: number; finishReason: 'eos' | 'limit' }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string };
export interface ModelManifest {
  schemaVersion: 1;
  version: string;
  releaseStatus: 'released' | 'experimental' | 'unavailable';
  reason?: string;
  trained: boolean;
  runtimeVersion: '1.23.0';
  dtype: 'fp32';
  contextLength: 256;
  architecture: { layers: number; width: number; ffn: number; heads: number; kvHeads: number; headDim: number; vocab: number; parameters: number };
  model?: { url: string; sha256: string; bytes: number };
  tokenizer?: { url: string; sha256: string; bytes: number };
  wasmBaseUrl?: string;
  runtimeAssets?: { url: string; sha256: string; bytes: number }[];
  dataVersion: string;
  quality: Record<string, unknown>;
}
