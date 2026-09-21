/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** "play" no build da Google Play; ausente (ou "site") no APK das GitHub Releases. Ver src/lib/distribuicao.ts. */
  readonly VITE_DISTRIBUICAO?: string;
}
