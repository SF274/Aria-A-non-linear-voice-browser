/**
 * Ambient type declarations for Web Speech API.
 *
 * TypeScript's DOM lib includes SpeechRecognitionEvent and related *event*
 * interfaces but does NOT include SpeechRecognition as a constructible class
 * on the global Window (this was added in Chrome 25, not yet in lib.dom.d.ts
 * for older targets). We declare just what the extension needs.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
 */

declare class SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  /** Chrome-specific on-device recognition flag (Chrome 139+). */
  processLocally?: boolean;

  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;

  start(): void;
  stop(): void;
  abort(): void;

  /** Chrome 139+: check on-device model availability. */
  static available(options: { langs: string[]; processLocally: boolean }): Promise<
    "available" | "downloadable" | "downloading" | "unavailable" | string
  >;
  /** Chrome 139+: trigger model download. */
  static install(options: { langs: string[]; processLocally: boolean }): Promise<void>;
}

declare const webkitSpeechRecognition: typeof SpeechRecognition;

/**
 * Vite-injected compile-time environment flag.
 * `import.meta.env.DEV` is true during development builds and false in production.
 * Declared here so TypeScript accepts it without vite/client in every lib.
 */
interface ImportMeta {
  readonly env: {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: string;
    readonly [key: string]: unknown;
  };
}

/**
 * Vite `define` constant (SPEC §17.3): true in dev/test builds, false in
 * production. Declared here so TypeScript accepts `typeof __ECHO_DEV__`
 * without errors. Vite replaces references at bundle time.
 */
declare const __ECHO_DEV__: boolean;

