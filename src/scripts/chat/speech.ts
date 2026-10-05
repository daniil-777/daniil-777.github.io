/** A classic worker keeps Whistle's synchronous CPU inference off the UI thread. */
import { WHISTLE, type VoiceReply } from '../../lib/chat/voice.ts';

export function createSpeech() {
  const worker = new Worker(WHISTLE.worker);
  let id = 0;
  let stopped = false;
  let pending: ((error: Error) => void) | undefined;

  function request<T extends VoiceReply['type']>(
    message: { type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array<ArrayBuffer> },
    expected: T,
    signal: AbortSignal,
    progress: (loaded: number, total: number) => void = () => {},
  ): Promise<Extract<VoiceReply, { type: T }>> {
    return new Promise((resolve, reject) => {
      if (stopped || signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
      let timer = 0;
      const finish = (error?: Error, reply?: Extract<VoiceReply, { type: T }>) => {
        window.clearTimeout(timer);
        worker.removeEventListener('message', receive);
        worker.removeEventListener('error', failed);
        worker.removeEventListener('messageerror', failed);
        signal.removeEventListener('abort', cancel);
        pending = undefined;
        if (error) reject(error);
        else resolve(reply!);
      };
      const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
      const failed = () => finish(new Error('Voice input could not run in this browser. Please try typing.'));
      const watch = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => finish(new Error('Voice input took too long. Please try again.')), expected === 'ready' ? 30_000 : 60_000);
      };
      const receive = ({ data }: MessageEvent<VoiceReply>) => {
        if (data.type === 'progress' && expected === 'ready') {
          watch();
          progress(data.loaded, data.total);
        } else if (data.type === 'error') finish(new Error(data.message));
        else if (data.type === expected && (data.type !== 'transcript' || ('id' in message && data.id === message.id))) {
          finish(undefined, data as Extract<VoiceReply, { type: T }>);
        }
      };
      pending = (error) => finish(error);
      worker.addEventListener('message', receive);
      worker.addEventListener('error', failed);
      worker.addEventListener('messageerror', failed);
      signal.addEventListener('abort', cancel, { once: true });
      watch();
      try {
        worker.postMessage(message, 'audio' in message ? [message.audio.buffer] : []);
      } catch {
        failed();
      }
    });
  }

  return {
    load: (signal: AbortSignal, progress: (loaded: number, total: number) => void) => request({ type: 'load' }, 'ready', signal, progress).then(() => {}),
    transcribe: (audio: Float32Array<ArrayBuffer>, signal: AbortSignal) => request({ type: 'transcribe', id: ++id, audio }, 'transcript', signal).then((reply) => reply.text),
    dispose() {
      stopped = true;
      pending?.(new DOMException('Cancelled', 'AbortError'));
      worker.terminate();
    },
  };
}

export type Speech = ReturnType<typeof createSpeech>;
