# AGENTS.md

Project conventions for AI agents and humans working in this repository.

## Project overview

AI Frontend Lab: a frontend-only AI chat application (Next.js + Vercel AI SDK)

## Commands

```bash
pnpm dev              # dev server (Next.js 16 + Turbopack), http://localhost:3000
pnpm build            # production build
pnpm start            # serve production build
pnpm check            # biome check (lint + format + organize imports)
pnpm fix              # biome check --write (auto-fix)
npx tsc --noEmit      # type check (biome does NOT type check — run both)
```

- **Before every commit:** `pnpm check`, `npx tsc --noEmit`, and a manual
  smoke test in the browser.
- **Backend:** the chat proxy expects the FastAPI backend at
  `BACKEND_URL` (`.env.local`, default `http://localhost:8000`). The backend
  source lives in the sibling repo `../ai-backend-lab` — **read-only**:
  never edit it, use it only as a reference to check the latest backend API
  (routes, chunk shapes, tool names) when working on the frontend contract.
- **Dev-server cache corruption:** Turbopack's HMR cache breaks after
  runtime errors during Fast Refresh (stale `X is not defined` errors that
  persist after the code is fixed). Fix: `pkill -f "next dev"; rm -rf .next; pnpm dev`.
  Check `/tmp/aifrontend.log` for browser errors.

## Stack (do not mix up)

- **Next.js 16.2.10** App Router + Turbopack, **React 19**, TypeScript, Tailwind v4.
- **Package manager: pnpm** (never npm/yarn). Lockfile: `pnpm-lock.yaml`.
- **shadcn/ui** preset `maia` (components.json: `style: radix-maia`,
  `base: radix`, icons: lucide). Official shadcn skills live in
  `.agents/skills/shadcn/` — **read SKILL.md and follow its rules**
  (styling, forms, composition, chat) when touching UI.
- **Vercel AI SDK v7** (`ai` 7.x + `@ai-sdk/react` 4.x): `useChat` +
  `DefaultChatTransport` speaking the AI SDK data-stream protocol.

### UI primitive libraries — important nuance

| Library                     | Used by                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `radix-ui` (single package) | alert-dialog, badge, button, button-group, collapsible, dialog, dropdown-menu, hover-card, label, popover, scroll-area, select, separator, sheet, sidebar, switch, tabs, tooltip |
| `@base-ui/react`            | **combobox only**                                                                                                                                                                |
| `cmdk`                      | command                                                                                                                                                                          |
| plain React                 | field (FieldGroup/Field), input, input-group, table, textarea, skeleton, spinner                                                                                                 |

- Most components use `radix-ui`; **the combobox is Base UI** and has a
  different API (Base UI `Combobox.Item` must NOT be wrapped in `ComboboxLabel`
  — `ComboboxLabel` is a group header that requires `<Combobox.Group>`; items
  and `ComboboxEmpty` are fine directly in `ComboboxList`). `asChild` (radix)
  vs `render` (Base UI) — check the file before composing.
- **tabs.tsx is locally patched:** radix only sets `data-orientation` and
  `data-state`, but the shadcn styles key off `data-vertical`/`data-horizontal`
  and `data-active`. The patch sets `data-horizontal`/`data-vertical` on the
  Root and uses `data-[state=active]` for the active trigger. Don't revert to
  the registry version without keeping this.
- Check `components/ui/` before importing — components are added as source
  code here, not imported from a package.

## Project structure

```
app/
  (chat)/              # route group: sidebar shell layout + pages
    layout.tsx         # SidebarProvider + ActiveChatProvider + AppSidebar + ChatShellRoute
    page.tsx           # "/" — renders null (ChatShellRoute provides the UI)
    chat/[id]/page.tsx # conversation route — renders null
    settings/page.tsx  # /settings — vertical tabs: General | Model | Skills | Tools
  api/
    chat/route.ts      # proxy POST/GET/DELETE /api/chat → BACKEND_URL + BACKEND_CHAT_PATH
    health/route.ts    # proxy GET /api/health → backend /health (live settings state)
    models/route.ts    # GET/POST /api/models → {base}/models of a completion source (env source or {provider, baseUrl, apiKey} connection body)
components/
  chat/                # app UI: shell, shell-route, messages, message, sidebar, history, input
  ai-elements/         # message primitives, tool-card, subagent-card, shimmer, model-selector
  ui/                  # shadcn/ui components (source, never edit registry files by hand — use CLI)
hooks/
  use-active-chat.tsx  # useChat wiring + localStorage persistence + edit/delete (ActiveChatContext)
  use-available-models.ts # fetches /api/models using the saved modelConnection (settings) or the env source; null → fall back to chatModels
  use-messages.tsx     # scroll behavior
  use-scroll-to-bottom.tsx
lib/
  types.ts             # ChatMessage = UIMessage<MessageMetadata>
  models.ts            # chatModels list (id/name/description) — sync with backend DEEPAGENTS_MODEL; chatModelsFromSource(prefix, raw /v1/models ids) → `provider:model` ids; COMPLETION_PROVIDERS presets (default/openai/gemini/custom)
  settings.ts          # settings state + localStorage persistence + health types; modelConnection selects the completion source (null = server env)
  settings.ts          # settings state + localStorage persistence + health types
  constants.ts         # localStorage keys
  utils.ts             # cn, getTextFromMessage, sanitizeText, generateUUID, ...
```

- `(chat)/layout.tsx` renders `ChatShellRoute` (chat UI) **only** on `/` and
  `/chat/[id]`; other pages (settings) render their own content. Never mount
  `ChatShell` globally.
- Route group is `app/(chat)/` — new pages go inside it to inherit the shell.

## Chat architecture & backend contract

- `useChat` (in `use-active-chat.tsx`) sends to `/api/chat` (proxied to
  backend): `{ id: <chat uuid>, messages: UIMessage[], selectedChatModel }`.
  The chat id is reused as the backend thread id.
- Backend responds with the AI SDK data-stream protocol: SSE `data: <json>`
  chunks — `start` (unique `messageId` per response), `text-start/delta/end`,
  `tool-input-start/delta/available`, `tool-output-available/error`, `custom`
  (`kind: "app.subagent"`), `error`, `finish`, `[DONE]`.
- Tool calls become typed `tool-<name>` UI parts (state: input-streaming →
  input-available → output-available/error) → rendered by
  `components/ai-elements/tool-card.tsx`. Subagents arrive as `custom` parts
  → `components/ai-elements/subagent-card.tsx`.
- **FastMCP prefab apps:** tools marked `app=True` return their UI as a
  `structuredContent` envelope (`{view, state, _meta}`); via langchain's
  MCP adapter it arrives in `tool-output-available` as
  `output.artifact.structured_content`. `lib/prefab.ts` detects it
  (`extractPrefabPayload`) and `components/ai-elements/prefab-app.tsx`
  renders it with the official Prefab renderer (pinned on jsDelivr — keep
  `PREFAB_RENDERER_VERSION` in sync with the servers' `prefab-ui` package)
  inside a sandboxed iframe speaking the MCP Apps postMessage protocol
  (`ui/initialize` → `ui/notifications/tool-result` → `size-changed`).
  Prefab outputs render as an **inline app block** in the message flow
  (`PrefabAppCard` + `ToolPart` routing in `components/chat/message.tsx`),
  not inside the collapsible tool card — the MCP Apps extension's intended
  presentation. App-initiated `tools/call` (interactive apps, e.g.
  FastMCPApp backends) is forwarded by the host through
  `app/api/mcp/[[...path]]` to the backend's `POST /mcp/tools/call` proxy
  and the CallToolResult is handed back to the renderer verbatim; unknown
  tools surface as `isError`. Backend contract: `{name, arguments,
  server_hint?}` → `{content, structuredContent, isError}` (404/502 on
  failures). Note: Next dev enables React StrictMode by default — the host's
  AbortController is created inside the effect (per setup) so StrictMode's
  setup→cleanup→setup can't abort it, and tool-result re-pushes compare
  envelope CONTENT (JSON), not object reference (chat re-creates parts).
- **GenUI (OpenUI Lang):** assistant text that is (or looks like) OpenUI
  Lang — starts with a statement (`root = ...`, `$var = ...`) or a fenced
  ```` ```openui ```` block — is rendered by
  `components/ai-elements/genui.tsx` through `@openuidev/react-lang`'s
  `Renderer` + the **merged** library in `lib/genui-library.ts`
  (general-purpose `openuiLibrary` incl. `Stack`/`Modal` + chat-only
  blocks; shared names prefer general; root `Stack`). Everything else
  (prose) keeps the Streamdown markdown pipeline — the fallback also
  demotes ```` ```openui ```` fences to unlabeled ones so Shiki never sees
  the unknown `openui` grammar. Parse failures fall back to markdown.
  Interactive actions: `@ToAssistant("...")` → `sendMessage` (via
  `ActiveChatContext`), `@OpenUrl` → `window.open`. No `Query()`/
  `Mutation()` client-side (no toolProvider) — the model must only render
  data already in context. **Version sync (do not drift):** the backend
  system prompt MUST be generated from this same merged library — run
  `node scripts/tools/genui-spec.mjs` (writes `genui-spec/` artifacts,
  pins `GENUI_LIBRARY_VERSION` in `lib/genui-library.ts`) and ship the
  regenerated `system-prompt.txt` to the backend whenever
  `@openuidev/react-ui` bumps.
- HITL interrupts arrive as `custom` parts with `kind: "app.interrupt"`
  (backend nests `threadId`/`interrupts` under `providerMetadata.app` — flat
  fields fail the strict `uiMessageChunkSchema` and kill the stream) →
  `components/ai-elements/interrupt-card.tsx` (approve/reject/respond).
  Resuming calls `regenerate({ messageId, body: { decision } })` — the
  transport merges `decision` into the body, the backend resumes the paused
  thread via `/api/chat`. Stopping generation also POSTs
  `/api/chat/threads/{id}/cancel` so the server-side run actually aborts.
- History: sidebar merges `GET /api/chat/threads` with the localStorage
  cache (server wins); delete/rename call `DELETE/PATCH /api/chat/threads/{id}`;
  opening a chat with an empty local cache rehydrates messages from
  `GET /api/chat/threads/{id}/messages` (LangGraph dumps → UIMessages via
  `serverMessagesToChatMessages` in `lib/threads.ts`).
- **Hydration rule:** anything read from localStorage (chat history, messages,
  settings) or fetched client-side (health) must be **mount-gated**
  (`useState(false)` + `useEffect(() => setMounted(true))`) so the server
  render (empty) matches the client's first render. Skipping this produces
  hydration-mismatch errors.

## Settings page

- `/settings` is a **client-side page**: values persist to localStorage
  (`app-settings`) and initial values load from `/api/health`. Skills and
  MCP tool servers are **live** — they sync to the backend's `/agent/skills`
  and `/agent/tools` CRUD via the `app/api/agent/[[...path]]` proxy (backend
  persists them in the LangGraph store; skill changes apply on the next run,
  tool changes after `POST /agent/tools/reconnect`). The web-search toggle is
  also live — it is sent as `enableSearch` in every `/api/chat` request body
  (backend overrides `SEARXNG_ENABLED` per request). The **execute tool**
  (enabled/max timeout/inherit env), the **connection policy**
  (`connections.fallback_env`), and the **HITL gate** (`hitl.interrupt_on` —
  which tools pause for human approval) are live too — admin-only
  `GET|PUT /settings`
  proxied at `app/api/settings/` (DB `app_settings` table wins over .env;
  `source: db|env` in the response drives the badges; every mutation rebuilds
  the backend's agent graphs, so changes apply on the next run). Saved
  provider **connections** (llm/embeddings/mcp/weaviate/searxng, one default
  per kind, write-only tokens) are managed in the Model tab via
  `app/api/connections` → backend `/connections`; without a default `llm`
  connection the agent fails loudly unless `.env` fallback is enabled. The
  **default model** (backend `llm_model_name()`) is just the default `llm`
  connection's `extra.model` — there is no dedicated endpoint, so the
  Model tab lets admins pick one per row (hover "Set default" in the
  available-models list) which saves through `PUT /connections/{name}`
  with `extra.model` set and mirrors the result into the local
  `settings.model`. Non-admins see the current default as a "Default"
  badge only. The remaining settings (model, prompt) are still local-only
  until backend `/settings` endpoints exist. Note: the knowledge-base tab
  calls `/api/agent/knowledge-bases`, which the backend has **not**
  implemented yet — those fetches 404 until the backend adds the endpoints.
- `/agent/*` endpoints are **admin-only** on the backend, so the Skills and
  Tools tabs are admin-gated in the UI (same as Users).
- Tabs: General | Model | Skills | Tools | Account (+ Users for admins).
  Account shows the profile and self-service password change
  (`POST /api/auth/users/me/password`); Users (admin-only, gated on
  `user.role`) manages accounts via `lib/users.ts`
  (`GET/POST /api/auth/users`, `PATCH/DELETE /api/auth/users/{username}`).
- Layout: vertical `Tabs` (left nav) + fixed-height content panel
  (`h-[calc(100dvh-10.5rem)] overflow-y-auto`) so switching tabs never
  changes the page layout.

## Auth

- Login/register pages live outside the `(chat)` route group
  (`app/login`, `app/register`). Tokens: access + refresh JWTs in
  localStorage (`app-auth-token`, `app-refresh-token`). `fetchWithAuth`
  auto-refreshes on 401 (single retry via `POST /api/auth/refresh`) and
  `use-auth` tries a refresh before signing out on mount.

## Conventions

- **Code style:** biome (line width, imports, organize). Type hints on all
  public functions; `"use client"` on any file using hooks/events.
- **shadcn skill rules apply** (`.agents/skills/shadcn/SKILL.md`): semantic
  colors only (`bg-card`, `text-muted-foreground`…), `gap-*` not `space-y-*`,
  `size-*` for equal dims, `cn()` for conditional classes, `FieldGroup` +
  `Field` for forms, `data-icon` on icons inside buttons, no raw `dark:`
  overrides.
- **Adding UI components:** use the CLI `pnpm dlx shadcn@latest add <name>`.
  Read `.agents/skills/shadcn/SKILL.md` first. After adding, review the file
  (imports, composition) and run `pnpm check` + `npx tsc --noEmit`.
- **Icons:** lucide-react only (`iconLibrary: lucide`).
- **New AI SDK protocol work:** the chunk schemas are in
  `node_modules/ai/dist/index.js` (`uiMessageChunkSchema`) — verify chunk
  field names there before emitting/consuming new chunk types.

## Git workflow

- Conventional commits (`feat(settings): ...`), imperative subject ≤ 72 chars.
- `.env.local` and `.env` are gitignored — never commit them.
- Commit only files belonging to the change; keep the working tree clean.
