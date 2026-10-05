/** Cactus Whistle, released October 2, 2026. All assets are served by this site. */
export const WHISTLE = {
  base: '/vendor/whistle/2026-10-02',
  worker: '/chat/whistle.worker.js',
  bytes: 17_885_885,
  sampleRate: 16_000,
  seconds: 30,
  engineRevision: 'c7c415a3d1b3d929014bc6e866d51ebb971f7089',
  modelRevision: 'b358ddadd89b7a713b5aa131f23032d3cca1b251',
} as const;

export type VoiceReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'transcript'; id: number; text: string }
  | { type: 'error'; message: string };

/** decodeAudioData resamples to the OfflineAudioContext's 16 kHz rate. */
export function monoAudio(buffer: Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels' | 'getChannelData'>): Float32Array<ArrayBuffer> {
  if (buffer.sampleRate !== WHISTLE.sampleRate || buffer.numberOfChannels < 1) throw new Error('Unsupported recording format');
  const samples = Math.min(buffer.length, WHISTLE.sampleRate * WHISTLE.seconds);
  const mono = new Float32Array(samples);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < samples; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  for (let i = 0; i < samples; i++) mono[i] = Number.isFinite(mono[i]) ? Math.max(-1, Math.min(1, mono[i])) : 0;
  return mono;
}

/** Preserve the draft, insert at its selection, and respect the composer's character limit. */
export function insertTranscript(draft: string, transcript: string, start: number, end: number, max: number) {
  const text = transcript.trim();
  if (!text) return { value: draft, caret: start, truncated: false };
  const before = draft.slice(0, start);
  const after = draft.slice(end);
  const prefix = before && !/[\s([{]$/.test(before) ? ' ' : '';
  const suffix = after && !/^[\s.,!?;:)\]}]/.test(after) ? ' ' : '';
  const room = Math.max(0, max - before.length - after.length - prefix.length - suffix.length);
  let fitted = text.slice(0, room).trimEnd();
  // Avoid splitting an emoji or another character represented by a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(fitted)) fitted = fitted.slice(0, -1);
  if (!fitted) return { value: draft, caret: start, truncated: true };
  const insertion = prefix + fitted + suffix;
  return { value: before + insertion + after, caret: before.length + insertion.length, truncated: fitted.length < text.length };
}
