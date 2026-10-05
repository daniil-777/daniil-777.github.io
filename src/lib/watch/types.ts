export type LanguageMode = 'ai' | 'profile' | 'wellbeing';
export type WatchMotion = 'sweep' | 'tick';
export type InferenceBackend = 'wasm' | 'webgpu';

export interface WatchSettings {
  showPlane: boolean;
  showClouds: boolean;
  enableOnlineLearning: boolean;
  compact: boolean;
  /** Empty means the visitor's device time zone. */
  timeZone: string;
  phraseIntervalMs: number;
  languageMode: LanguageMode;
  inferenceBackend: InferenceBackend;
  motion: WatchMotion;
}

export interface ClockParts {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export interface ClockAngles {
  hour: number;
  minute: number;
  second: number;
}

export interface ClockSnapshot {
  epochMs: number;
  parts: ClockParts;
  angles: ClockAngles;
  /** Clockwise radians measured from twelve o'clock. */
  phase: number;
  label: string;
  timeZone: string;
}

export interface DialOptions {
  timeZone?: string;
  motion?: WatchMotion;
  now?: () => Date;
  onFrame?: (clock: ClockSnapshot, elapsedSeconds: number) => void;
  onResume?: () => void;
}

export interface DialController {
  setTimeZone(timeZone: string): void;
  setMotion(motion: WatchMotion): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}
