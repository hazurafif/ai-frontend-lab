# AI Frontend Lab — Chat UI

A frontend-only AI chat application, based on the [Vercel AI Chatbot](https://github.com/vercel/chatbot) template, with **all backend concerns removed** (auth, database, rate limiting, file uploads, artifacts) and replaced by a thin proxy to **your own backend**.

## What's included

- Chat UI: message list, streaming, stop/regenerate, copy, edit-message, thinking indicator, reasoning blocks, markdown rendering
- Sidebar: new chat, history grouped by date, delete chat / delete all, dark/light toggle
- Model selector (the selected model id is sent to your backend as `selectedChatModel`)
- Chat history persisted in **localStorage** (no server needed)
- `POST/GET/DELETE /api/chat` → proxied to your backend, AI SDK streaming protocol passes through untouched

## Removed from the original template

- NextAuth auth, guest login, `proxy.ts` middleware
- Postgres/Drizzle schema, queries, migrations, Redis rate limiting
- Vercel Blob uploads, AI Gateway, telemetry (OTel), botid
- Artifact system (document/code/image/sheet editor, console, weather tool, suggestions, votes, visibility)

## Setup

```bash
pnpm install
cp .env.example .env.local   # then set BACKEND_URL to your backend
pnpm dev
```

### Backend contract

Your backend receives AI SDK chat requests at `BACKEND_URL + BACKEND_CHAT_PATH` (default `http://localhost:8787/api/chat`) with a JSON body:

```json
{
  "id": "chat-uuid",
  "messages": [{ "id": "...", "role": "user", "parts": [{ "type": "text", "text": "hi" }] }],
  "selectedChatModel": "gpt-4o-mini"
}
```

It should respond with the [AI SDK data stream protocol](https://ai-sdk.dev/docs/ai-sdk-protocol) (e.g. built with the `ai` package's `streamText`). Anything your backend emits is rendered: text deltas, reasoning, file parts (images render inline), and tool parts (rendering hooks are intentionally left out — add them as needed).

## Project structure

```
app/
  (chat)/          # chat layout + routes (/, /chat/[id])
  api/chat/        # proxy route -> your backend
components/
  chat/            # shell, messages, input, sidebar, history (localStorage)
  ai-elements/     # message, model-selector, shimmer
  ui/              # shadcn/ui components
hooks/
  use-active-chat  # useChat wiring + localStorage persistence + edit/delete
lib/
  models.ts        # model list sent to your backend
  constants.ts     # localStorage keys
```

## Skills

The official [shadcn skills](https://ui.shadcn.com/docs/skills) are installed at `.agents/skills/` (used by pi, Claude Code, Cursor, and other agent harnesses).
