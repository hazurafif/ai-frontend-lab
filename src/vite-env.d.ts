/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deploy base path (e.g. "/demo") — mirrors the old NEXT_PUBLIC_BASE_PATH. */
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
