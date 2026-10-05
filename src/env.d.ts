interface ImportMetaEnv {
  /** Address of the Worker in worker/, without a trailing slash. Unset: the assistant only quotes the site. */
  readonly PUBLIC_CHAT_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Chrome's built-in language model (Prompt API). Not in TypeScript's DOM types yet. */
interface LanguageModelSession {
  clone(): Promise<LanguageModelSession>;
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

declare const LanguageModel:
  | {
      availability(options?: object): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
      create(options?: object): Promise<LanguageModelSession>;
    }
  | undefined;
