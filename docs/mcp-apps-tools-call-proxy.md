# MCP Apps `tools/call` proxy — feature definition

**Status:** backend implemented (ai-backend-lab `feat/add-mcp-tools-call-proxy`, POST /mcp/tools/call) · frontend implemented (this repo) · e2e verified
**Related:** `lib/prefab.ts`, `components/ai-elements/prefab-app.tsx` (frontend client support, done)

## 1. Goal

Make **interactive FastMCP prefab apps** work in the chat UI. Display-only apps
(charts, sortable/searchable tables, `SetState`/`Rx` client-side reactivity)
already work end-to-end — the envelope is self-contained and the renderer runs
it in a sandboxed iframe with zero server round-trips.

What's missing: apps that call **server tools** (`FastMCPApp` with
`@app.ui()` entry points + `@app.tool()` backend tools, forms, server-side
search, CRUD). When the user clicks such a button, the renderer sends
`tools/call` to the host (the chat UI) via postMessage; the UI has no route to
the MCP server — the connection lives in the backend process only. The host
currently answers with a JSON-RPC error.

## 2. Current wiring (verified in ai-backend-lab)

```
browser ── POST /api/chat ──▶ backend (FastAPI, :8000)
                                 │
                                 ├─ create_deep_agent(tools=[langchain StructuredTools…])
                                 │        ▲
                                 │        │ (services/mcp.py: MCPServers.connect())
                                 │   MultiServerMCPClient ── MCP streamable_http/stdio ──▶ FastMCP server(s)
                                 │        ▲
                                 └─ /agent/tools CRUD + /agent/tools/reconnect (only)
```

- MCP server config (URLs + **auth headers**) is backend-side state — never
  exposed to the browser.
- `mcp_servers.tools` / `mcp_servers.tools_by_server` hold the fetched tools
  and per-server attribution (services/mcp.py).
- Backend endpoints checked: `/agent/*` is skills/tools CRUD + reconnect only.
  **No `tools/call`, no MCP proxy — this is the gap.**

## 3. Protocol (what the renderer already speaks)

The renderer's `App` (from `@modelcontextprotocol/ext-apps`) sends JSON-RPC 2.0
over postMessage. Interactive flow:

```jsonc
// Renderer → Host (chat UI iframe host)
{ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": { "name": "<hash>_save_contact", "arguments": { "email": "a@b.c" } } }

// Host → Renderer on success
{ "jsonrpc": "2.0", "id": 7,
  "result": { "content": [{ "type": "text", "text": "Saved" }],
              "structuredContent": null, "isError": false } }

// Host → Renderer on failure
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32001, "message": "…" } }
```

- Tool names are **hashed** (`<hash>_save_contact`, hash derived from app name
  + backend tool name). The FastMCP **server** resolves the hash through its
  provider chain (`get_tool_by_hash`); the proxy just forwards the name.
- App-only backend tools are tagged `meta["fastmcp"]["app"]` and
  `meta["ui"]["visibility"]: ["app"]` — not in the agent's tool list, but the
  hashed `tools/call` reaches them.
- The envelope's `_meta.fastmcp.toolNames` (when present) maps hashed names →
  registered names — useful for routing/audit.

## 4. Backend feature (the main addition)

### 4.1 Endpoint

```
POST /mcp/tools/call          (mounted under the existing /api/v1 router)
Auth: Depends(get_current_user)   — same trust level as /api/chat: any
                                    authenticated user, not admin-only
```

### 4.2 Request

```jsonc
{
  "name": "<hash>_save_contact",   // required — hashed backend tool name
  "arguments": { "email": "a@b.c" }, // required — JSON object (may be {})
  "server_hint": "contacts"        // optional — server name hint from the
                                   // frontend (derived from the entry tool's
                                   // server attribution) to skip fan-out
}
```

### 4.3 Response

Passthrough of the MCP `CallToolResult`, normalized to JSON:

```jsonc
200:
{
  "content": [ { "type": "text", "text": "Saved" } ],   // list of content blocks
  "structuredContent": { "view": … } | null,             // prefab envelopes pass through
  "isError": false
}

4xx/5xx (incl. upstream isError): { "detail": "…" }       // standard FastAPI error shape
```

### 4.4 Routing (resolve which server)

1. If `server_hint` names a configured server → try it first.
2. Otherwise, iterate the configured servers (`mcp_servers.names`):
   - call `tools/call` with the hashed name;
   - a server that doesn't know the tool answers with an MCP
     `-32602`/tool-not-found error → try the next;
   - first non-not-found result wins.
3. No server matched → `404 { "detail": "Tool <name> not found on any MCP server" }`.

Hash collisions between servers require the same (app, tool) pair — acceptably
rare; `server_hint` makes it deterministic when it matters.

### 4.5 Implementation sketch

```python
# src/app/api/v1/endpoints/mcp.py (new)
@router.post("/tools/call")
async def call_tool(body: ToolCallIn, _: dict = Depends(get_current_user)):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    from mcp.shared.exceptions import McpError

    servers = mcp_servers.names  # mcp_servers = MCPServers() singleton (services/mcp.py)
    candidates = ([body.server_hint] if body.server_hint in servers else []) + \
                 [s for s in servers if s != body.server_hint]

    for server in candidates:
        conn = mcp_servers._config[server]           # url/command/args/env/headers
        if conn["transport"] == "stdio":
            # StdioServerParameters + stdio_client — spawn per call, or reuse a
            # long-lived session per server (preferred: cache ClientSession in
            # MCPServers, see 4.6)
            ...
        else:
            async with streamablehttp_client(conn["url"], headers=conn.get("headers")) as (r, w, _):
                async with ClientSession(r, w) as s:
                    await s.initialize()
                    try:
                        result = await s.call_tool(body.name, body.arguments)
                    except McpError as exc:
                        if _is_tool_not_found(exc):   # -32602 / "Unknown tool"
                            continue
                        raise HTTPException(502, detail=str(exc))
                    return {
                        "content": [b.model_dump(exclude_none=True) for b in result.content],
                        "structuredContent": result.structuredContent,
                        "isError": result.isError,
                    }
    raise HTTPException(404, detail=f"Tool {body.name} not found on any MCP server")
```

> Note: `streamablehttp_client` yields 3 values in mcp ≥ 1.29 (`read, write,
> get_session_id`). Check the installed SDK's signature.

### 4.6 Sessions (recommended, not required for v1)

Creating a connection per call is wasteful and breaks servers with
in-memory state expectations. Prefer caching one `ClientSession` per server on
`MCPServers` (created lazily on first call, reused, closed in `close()`).
`MultiServerMCPClient.get_session(server_name)` already does this for
`streamable_http` — reuse the existing `MultiServerMCPClient` instance instead
of hand-rolling sessions:

```python
client = MultiServerMCPClient(mcp_servers._config)   # one instance, cached
session = await client.get_session(server_name)      # cached, multiplexed
result = await session.call_tool(body.name, body.arguments)
```

Concurrent agent runs + UI calls share the session — fine (JSON-RPC is
multiplexed). Stdio servers: `get_session` also supports them via the same
config keys.

### 4.7 Validation & errors

- `name` must match `^[a-z0-9_-]{1,64}$` (hashed names are `[a-f0-9]{8,}_tool`).
- `arguments` must be a JSON object.
- Upstream `isError: true` → still return 200 with `isError: true` (the
  renderer handles error content blocks) — only transport failures are HTTP
  errors.
- Log the call (`server`, `name`, `user`, duration) — audit trail.

## 5. Frontend changes (done)

1. **the `/api/mcp/*` proxy rewrite** (vite.config.ts / nginx — formerly `app/api/mcp/[[...path]]/route.ts`):
   maps `/api/mcp/*` → `/mcp/*` on `BACKEND_URL`, forwards headers (JWT
   included), streams the response; 503 when the backend is unreachable.
2. **`components/ai-elements/prefab-app.tsx`** — advertises
   `hostCapabilities: { serverTools: {} }` in `ui/initialize`; the
   `tools/call` branch POSTs `/api/mcp/tools/call` with `{ name, arguments }`
   via `fetchWithAuth` (AbortController tied to unmount) and replies to the
   renderer with `result: <backend JSON>` — unknown tools surface as
   `isError: true` passthrough, proxy failures as a JSON-RPC `-32000` error.
3. **`lib/prefab.ts`** — unchanged (payload shape unchanged).
4. Verified e2e (playwright): quiz FastMCPApp — click an answer → hashed
   `tools/call` → proxy → backend → MCP server → `on_success` SetState
   updates the score badge in the renderer; unknown tool → `isError`.

## 6. Test plan

1. **Backend unit/integration** (ai-backend-lab): FastMCPApp test server with a
   stateful backend tool (e.g. `save_contact` appending to a list); call the
   new endpoint directly with the hashed name; assert content +
   `structuredContent` passthrough; assert tool-not-found → 404; assert
   upstream `isError` → 200 + `isError: true`; auth required.
2. **Browser e2e** (this repo, playwright — see `/tmp/prefab-test` pattern):
   render a FastMCPApp prefab envelope in the chat card, click the submit
   button, assert the renderer's state updates from the server response
   (proves: postMessage → proxy → MCP server → back → UI).
3. **Regression:** display-only prefab apps still render with zero
   `tools/call`; plain text tool outputs unchanged.

## 7. Out of scope (v1)

- `resources/read` proxying from apps (spec-optional; renderer doesn't need it
  for prefab).
- `ui/update-model-context` / `ui/message` (app → model round-trips).
- Display-mode switching, open-links capability.
- MCP-UI `@mcp-ui/client` integration (not needed — host protocol is already
  implemented in `prefab-app.tsx`).
