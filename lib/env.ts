// Framework env shims — replaces process.env.NEXT_PUBLIC_* (Next) with
// Vite's import.meta.env (VITE_*). Set VITE_BASE_PATH when deploying under a
// sub-path (e.g. "/demo"); vite.config.ts uses it as `base` + router basename.

/** Deploy base path ("" for root deployments). */
export const BASE_PATH: string = import.meta.env.VITE_BASE_PATH ?? "";
