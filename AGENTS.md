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
  `BACKEND_URL` (`.env.local`, default `http://localhost:8000`).
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
components/
  chat/                # app UI: shell, shell-route, messages, message, sidebar, history, input
  ai-elements/         # message primitives, tool-card, subagent-card, shimmer, model-selector
  ui/                  # shadcn/ui components (source, never edit registry files by hand — use CLI)
hooks/
  use-active-chat.tsx  # useChat wiring + localStorage persistence + edit/delete (ActiveChatContext)
  use-messages.tsx     # scroll behavior
  use-scroll-to-bottom.tsx
lib/
  types.ts             # ChatMessage = UIMessage<MessageMetadata>
  models.ts            # chatModels list (id/name/description) — sync with backend DEEPAGENTS_MODEL
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
- HITL interrupts surface as `error` chunks (toast) — resume is not wired yet.
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
  tool changes after `POST /agent/tools/reconnect`). The remaining settings
  (model, prompt, toggles) are still local-only until backend `/settings`
  endpoints exist.
- Layout: vertical `Tabs` (left nav) + fixed-height content panel
  (`h-[calc(100dvh-10.5rem)] overflow-y-auto`) so switching tabs never
  changes the page layout.

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
