/** Dictation is always an editable draft. Recording and transcription never submit a question. */
import { INPUT_MAX } from '../../data/chat.ts';
import { insertTranscript, monoAudio, WHISTLE } from '../../lib/chat/voice.ts';
import type { Speech } from './speech.ts';

type State = 'idle' | 'loading' | 'permission' | 'recording' | 'transcribing';

function icon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const capsule = document.createElementNS(svg.namespaceURI, 'rect');
  for (const [key, value] of Object.entries({ x: '9', y: '2.5', width: '6', height: '12', rx: '3' })) capsule.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3.5M8.5 21.5h7');
  svg.append(capsule, path);
  return svg;
}

function message(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Microphone access is blocked. Allow it in your browser’s site settings, then try again.';
    if (error.name === 'NotFoundError') return 'No microphone found. Connect one, then try again.';
    if (error.name === 'NotReadableError' || error.name === 'AbortError') return 'The microphone is unavailable. Close other apps using it, then try again.';
  }
  return error instanceof Error ? error.message : 'Voice input is unavailable. Please try typing.';
}

export function createVoice(form: HTMLFormElement, input: HTMLTextAreaElement, send: HTMLButtonElement, resize: () => void, announce: (text: string) => void) {
  const mic = document.createElement('button');
  mic.type = 'button';
  mic.className = 'chat__mic';
  mic.dataset.chatMic = '';
  mic.setAttribute('aria-describedby', 'chat-voice-note');
  mic.append(icon());
  const note = document.createElement('div');
  note.className = 'chat__voice';
  note.id = 'chat-voice-note';
  const label = document.createElement('span');
  label.className = 'chat__voice-label';
  const time = document.createElement('span');
  time.className = 'chat__voice-time';
  time.setAttribute('aria-hidden', 'true');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'chat__voice-cancel';
  cancel.textContent = 'Cancel';
  note.append(label, time, cancel);
  form.insertBefore(mic, send);
  form.append(note);

  const supported = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && 'MediaRecorder' in window && 'OfflineAudioContext' in window && 'Worker' in window && 'WebAssembly' in window;
  let state: State = 'idle';
  let busy = false;
  let generation = 0;
  let speech: Speech | undefined;
  let control: AbortController | undefined;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let chunks: Blob[] = [];
  let clock = 0;
  let limit = 0;
  let began = 0;
  let selection = { start: 0, end: 0 };

  function draw(next: State, text = '') {
    state = next;
    mic.dataset.state = next;
    const action = next === 'recording' ? 'Stop recording' : next !== 'idle' ? 'Cancel voice input' : 'Dictate a question';
    mic.setAttribute('aria-label', action);
    mic.setAttribute('aria-pressed', String(next === 'recording'));
    mic.title = supported ? `${action} · On this device` : 'Voice input needs HTTPS and a supported browser';
    mic.disabled = !supported || busy;
    input.readOnly = next !== 'idle';
    send.disabled = next !== 'idle';
    form.toggleAttribute('data-voice-active', next !== 'idle');
    label.textContent = text;
    note.hidden = !text;
    cancel.hidden = next === 'idle';
    time.hidden = next !== 'recording';
  }

  function releaseAudio() {
    window.clearInterval(clock);
    window.clearTimeout(limit);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }

  function disposeSpeech() {
    speech?.dispose();
    speech = undefined;
  }

  /** Invalidate async callbacks before stopping tracks (including a late permission grant). */
  function discard(text = '', focus = false) {
    generation++;
    control?.abort();
    control = undefined;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder = undefined;
    }
    releaseAudio();
    chunks = [];
    disposeSpeech();
    draw('idle', text);
    if (text) announce(text);
    if (focus && dialog.open) input.focus({ preventScroll: true });
  }

  const dialog = form.closest('dialog')!;
  const alive = (run: number) => run === generation && dialog.open && document.visibilityState !== 'hidden';

  async function transcribe(run: number, type: string) {
    releaseAudio();
    recorder = undefined;
    if (!alive(run)) return;
    draw('transcribing', 'Transcribing on your device…');
    announce('Recording stopped. Transcribing on your device.');
    const blob = new Blob(chunks, { type });
    chunks = [];
    try {
      const context = new OfflineAudioContext(1, 1, WHISTLE.sampleRate);
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      if (!alive(run)) return;
      const text = await speech!.transcribe(monoAudio(buffer), control!.signal);
      if (!alive(run)) return;
      control = undefined;
      if (!text) {
        draw('idle', 'No speech detected. Try again a little closer to the microphone.');
      } else {
        const result = insertTranscript(input.value, text, selection.start, selection.end, INPUT_MAX);
        input.value = result.value;
        input.setSelectionRange(result.caret, result.caret);
        resize();
        draw('idle', result.truncated ? 'Voice text reached the character limit. Review it before sending.' : 'Voice text added. Review it, then send.');
      }
      announce(label.textContent!);
      input.focus({ preventScroll: true });
    } catch (error) {
      if (alive(run)) discard(message(error), true);
    }
  }

  function finish() {
    if (state !== 'recording' || !recorder) return;
    window.clearInterval(clock);
    window.clearTimeout(limit);
    draw('transcribing', 'Transcribing on your device…');
    recorder.stop();
    // The browser delivers its last dataavailable before onstop. Stop the hardware now.
    releaseAudio();
  }

  async function start() {
    const full = input.value.length >= INPUT_MAX && input.selectionStart === input.selectionEnd;
    if (!supported || busy || full) {
      if (full) {
        draw('idle', 'The question is at its character limit. Shorten it before adding voice text.');
        announce(label.textContent!);
      }
      return;
    }
    const run = ++generation;
    control = new AbortController();
    const signal = control.signal;
    selection = { start: input.selectionStart, end: input.selectionEnd };
    draw('loading', 'Preparing voice input · 18 MB, cached for next time…');
    announce('Preparing on-device voice input. The microphone starts after loading.');
    try {
      if (!speech) {
        const { createSpeech } = await import('./speech.ts');
        if (!alive(run)) return;
        speech = createSpeech();
        await speech.load(signal, (loaded, total) => {
          if (alive(run)) label.textContent = `Preparing voice input · ${Math.round(loaded / total * 100)}%`;
        });
      }
      if (!alive(run)) return;
      draw('permission', 'Allow microphone access to start recording.');
      announce('Allow microphone access to start recording.');
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (!alive(run)) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder = recording;
      chunks = [];
      recording.ondataavailable = ({ data }) => { if (alive(run) && data.size) chunks.push(data); };
      recording.onstop = () => { if (alive(run)) void transcribe(run, recording.mimeType); };
      recording.onerror = () => { if (alive(run)) discard('The recording failed. Please try again.', true); };
      recording.start(250);
      began = performance.now();
      time.textContent = '0:00 / 0:30';
      draw('recording', 'Listening · tap the microphone to finish');
      announce('Recording. Up to 30 seconds. Press the microphone again to finish, or Cancel to discard.');
      clock = window.setInterval(() => {
        const seconds = Math.min(WHISTLE.seconds, Math.floor((performance.now() - began) / 1000));
        time.textContent = `0:${String(seconds).padStart(2, '0')} / 0:30`;
      }, 200);
      limit = window.setTimeout(finish, WHISTLE.seconds * 1000);
    } catch (error) {
      if (alive(run)) discard(message(error), true);
    }
  }

  mic.addEventListener('click', () => {
    if (state === 'recording') finish();
    else if (state !== 'idle') discard('Voice input cancelled.', true);
    else void start();
  });
  cancel.addEventListener('click', () => discard('Voice input cancelled.', true));
  dialog.addEventListener('close', () => discard());
  dialog.addEventListener('cancel', () => discard());
  window.addEventListener('pagehide', () => discard());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') discard(); });
  draw('idle');

  return {
    active: () => state !== 'idle',
    busy(on: boolean) {
      if (on && state !== 'idle') discard();
      busy = on;
      mic.disabled = !supported || on;
    },
    cancel: () => discard(),
  };
}
