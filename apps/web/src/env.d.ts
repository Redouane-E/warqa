/// <reference types="vite/client" />

/** apps/studio's version (vite.config.ts). */
declare const __STUDIO_VERSION__: string;
/** The repository's web address, for "desktop version" links (empty when unknown). */
declare const __WARQA_REPO__: string;

interface ImportMetaEnv {
  /** "1": build with the test-only scripted model always on. */
  readonly VITE_WARQA_FAKE?: string;
}
