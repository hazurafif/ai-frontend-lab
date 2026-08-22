# Migration: Next.js → Vite + React Router

**Status: DONE (pending browser smoke test)** — tracking doc for the framework swap. Keep it updated as
the migration proceeds; it is the single source of truth for what changed and why.

## Goal

Replace Next.js 16 (App Router + Turbopack) with **Vite + React 19 + React Router
v7**. Same features, same look, same behavior — different build/runtime.

- `pnpm dev` → Vite dev server (still proxies `/api/*` → `BACKEND_URL`)
- `pnpm build` → static bundle in `dist/` (no server runtime)
- `pnpm start` → `vite preview` for local QA; Docker runs the static bundle
  behind nginx which also proxies `/api/*` (see `nginx.conf`)

## Why it works

The app was already a "thin proxy to your backend" architecture: every backend
call went through a Next route handler that just forwards to `BACKEND_URL`. The
27k lines of components/hooks/lib are plain React. Only ~12 files touched Next
routing/env APIs. The one server-side secret (`MODELS_API_KEY`) is removable
because the settings→connections flow replaces the env source.

## Decisions (recorded so they don't get re-litigated)

1. **API layer = Vite dev proxy + nginx in prod**, with a path rewrite table
   mirroring the old Next route targets (see table below). No CORS required —
   the browser still talks same-origin `/api/*`.
2. **`/api/models` moves fully client-side** (`lib/models-client.ts`):
   - POST with a saved connection → direct `fetch({baseUrl}/models)` — the key is
     client-provided, so it was never a secret.
   - GET fallback → `GET /connections` → default `llm` connection's base_url →
     direct `/models` fetch (mirrors the Next `modelsFromBackendConnection`).
   - The `MODELS_BASE_URL` / `MODELS_API_KEY` env-source branch is **dropped**
     (documented in `.env.example` + README). It was never set in local dev and
     the connections flow supersedes it.
3. **Sidebar collapsed-state cookie → localStorage** (`components/ui/sidebar.tsx`).
   No more server `cookies()`.
4. **No React StrictMode** (Vite default). The prefab-app AbortController
   dance still works (it was written to survive double-invoke; single-invoke is
   a subset). `router.refresh()` calls (login/register) are dropped — in a SPA
   the navigate re-renders everything with fresh state.
5. **PWA stays** — Serwist's Vite plugin (`@serwist/vite`) builds the same
   `sw.ts` worker; offline fallback is now a React Router route `/offline`.
6. **Mount-gating stays** where present (harmless without SSR, still guards the
   first render flash). Removing it everywhere is a separate cleanup.
7. **Fonts**: Geist via `@fontsource-variable/geist` + `-mono` (bundled, works
   offline/PWA), CSS vars `--font-geist{,mono}` preserved.
8. **React Compiler dropped** (perf-only optimization; `@vitejs/plugin-react`
   v6 is oxc-based and would need `oxc-transform-react`). Revisit if the
   memoization profile regresses.
8. **OG/social**: static `og-image` meta tags in `index.html` (the old
   `app/(chat)/opengraph-image.png` convention was server-rendered per-page;
   no dynamic OG in a static SPA).

## API path mapping (Next route → backend target)

This table is the rewrite source of truth. Implemented once in
`vite.config.ts` (`rewriteApiPath`) and once for prod in `nginx.conf`.

| Browser path (client code keeps these) | Backend target |
|---|---|
| `/api/chat` (POST/GET/DELETE) | `{BACKEND_CHAT_PATH}` (default `/api/chat`) |
| `/api/chat/threads[...]` | `/threads[...]` (strip `/api/chat`) |
| `/api/chat/notifications[...]` | `/notifications[...]` (strip `/api/chat`) |
| `/api/auth/login` | `/login` |
| `/api/auth/refresh` | `/refresh` |
| `/api/auth/register` | `/register` |
| `/api/auth/me` | `/users/me` |
| `/api/auth/users[...]` | `/users[...]` (strip `/api/auth`) |
| `/api/auth/allowed-models` | `/allowed-models` |
| `/api/agent[...]` `/api/agents[...]` `/api/skills[...]` `/api/knowledge[...]` `/api/mcp[...]` | strip `/api` |
| `/api/connections[...]` `/api/settings[...]` `/api/health` | strip `/api` |
| `/api/preferences` | `/users/me/preferences` |
| `/api/setup` GET / POST | GET `/users/me/setup`, POST `/users/me/onboarding` |
| `/api/share/shared/<token>` | `/shared/<token>` (public) |
| `/api/share/<chat_id>` | `/threads/<chat_id>/share` (owner) |
| `/api/models` | **client-side** (`lib/models-client.ts`) — no proxy |

Verify against backend (read-only ref `../ai-backend-lab`): `routes.py` mounts
all routers at root; chat endpoints at `/api/chat`, `/threads/*`, `/notifications/*`;
`/connections/models` aggregated; CORS exists but is not needed.

## File plan

### New
- `vite.config.ts` — react plugin + react-compiler, `@tailwindcss/vite`,
  `@` alias → root, `base` from `VITE_BASE_PATH`, dev `/api` proxy + rewrite
- `index.html` — root HTML: meta/OG tags, fonts, theme-color script, manifest
- `src/main.tsx` — mounts `<RouterProvider>` inside Theme/Auth/Tooltip/Serwist providers
- `src/router.tsx` — route tree (login, register, shell layout, `/`, `/chat/:id`,
  `/settings`, `/share/:shareId`, `/offline`, `*` → redirect `/`)
- `src/pages/*` — ports of the removed `app/` pages (login, register, share,
  offline, shell-layout)
- `src/globals.css` — moved from `app/globals.css`
- `src/vite-env.d.ts` — Vite client types
- `lib/env.ts` — `BASE_PATH` (replaces `NEXT_PUBLIC_BASE_PATH`)
- `lib/models-client.ts` — client-side `/api/models` port
- `sw.ts` (root) — moved from `app/sw.ts`, imports `@serwist/vite/worker`
- `public/manifest.webmanifest` — static port of `app/manifest.ts`
- `nginx.conf` + `Dockerfile` — static serve + prod API proxy
- `docs/migration.md` (this file)

### Modified (react-router ports — mechanical)
- `hooks/use-active-chat.tsx` — `usePathname`/`useRouter` → `useLocation`/`useNavigate`; `BASE_PATH` from `lib/env.ts`
- `lib/chat/chat-store.tsx` — `useRouter` → `useNavigate`
- `components/chat/app-sidebar.tsx` — `Link`/`usePathname`/`useRouter`
- `components/chat/shell-route.tsx` — `usePathname` → `useLocation()`
- `components/chat/onboarding.tsx` — `useRouter` → `useNavigate`
- `components/chat/sidebar-history.tsx` — `usePathname`/`useRouter`
- `components/chat/sidebar-history-item.tsx` — `Link` → `Link to`
- `components/auth/auth-gate.tsx` — `useRouter` → `useNavigate`
- `components/auth/login-form.tsx` — `useRouter`/`useSearchParams` → `useNavigate`/`useSearchParams`
- `components/auth/register-form.tsx` — `useRouter` → `useNavigate`
- `lib/share.ts` — `BASE_PATH`
- `lib/chat/sieve.ts` (`lib/chat/sse.ts`?) — confirm no next usage
- `hooks/use-available-models.ts` — legacy fallback → `lib/models-client.ts`
- `components/ui/sidebar.tsx` — cookie → localStorage
- `tsconfig.json` — drop next plugin/includes; add `vite/client`
- `package.json`, `.gitignore` (`.next` → `dist`), `.env.example`, `README.md`

### Deleted
- `app/` (all pages, layouts, 33 API route handlers, sw.ts, manifest.ts)
- `next.config.ts`, `postcss.config.mjs`, `next-env.d.ts`, `vercel.json`

## Checklist / status

- [x] Phase 0 — this doc written
- [x] Phase 1 — scaffold: package deps, vite.config, index.html, tsconfig, main/router, globals.css, env, manifest, icons
- [x] Phase 2 — router ports (12 component/lib files)
- [x] Phase 3 — models client-side (`/api/models`), drop env-source
- [x] Phase 4 — Serwist (sw.ts + plugin + offline route)
- [x] Phase 5 — delete Next scaffolding, update Dockerfile/nginx/compose/README/AGENTS
- [x] Phase 6 — verify: `pnpm check` (0 errors), `npx tsc --noEmit`, `pnpm dev` + curl smoke (all rewrites 401/404 as expected, not 404-on-API), `pnpm build` (390 precache entries), `pnpm start` preview smoke
- [x] Phase 7 — commits (WIP + migration, `8759ff2`, `0121396`)
- [x] Phase 8 — post-merge cleanup: stripped `"use client"` pragmas (68 files),
  removed dead mount gates (auth-gate, login, register, settings, app-sidebar,
  sidebar-history), kept shell/messages gates (CSR-visible purpose), set
  `components.json rsc: false`, dropped the unused `postcss` devDep
- [ ] **Browser smoke test still pending** (login → chat → settings → share; PWA offline)

## Verification notes

- **Dev smoke**: backend must be running (`uv run uvicorn app.main:app --port 8000`
  in `../ai-backend-lab`); `pnpm dev`; then `curl http://localhost:5173/` (HTML),
  `curl http://localhost:5173/api/health` (proxied JSON), `curl
  http://localhost:5173/login` (SPA fallback serves index.html).
- **Type check**: `npx tsc --noEmit` — biome does not type check.
- **Prod**: `pnpm build && pnpm start` (vite preview); Docker build+run for nginx path.
- **SSE**: notification stream + chat stream must survive the dev proxy (http-proxy
  passes `text/event-stream` through — verify no buffering).
- **Known diffs vs Next** (accept in v1): no per-share dynamic OG images; sidebar
  collapsed state is per-browser localStorage, not server cookie; offline page at
  `/offline` instead of `/~offline`; no `router.refresh()` (redundant in SPA).