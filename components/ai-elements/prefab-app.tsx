
import { AppWindowIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fetchWithAuth } from "@/lib/auth";
import { prefabRendererHtml, type PrefabPayload } from "@/lib/prefab";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "./tool-card";

/** Host-side implementation of the MCP Apps extension (SEP-1865) postMessage
 * protocol, speaking to the official Prefab renderer:
 *
 *   1. Renderer (in the sandboxed iframe) sends `ui/initialize`
 *   2. Host replies with `McpUiInitializeResult` (capabilities + context)
 *   3. Renderer confirms with `ui/notifications/initialized`
 *   4. Host pushes the tool result via `ui/notifications/tool-result`
 *   5. Renderer reports content size via `ui/notifications/size-changed`
 *
 * Interactive apps call their server tools through `tools/call` messages,
 * which the host forwards to the backend's POST /mcp/tools/call proxy (the
 * backend owns the MCP connection — auth headers never leave it). The
 * response is passed back to the renderer verbatim as the JSON-RPC result.
 */

const PROTOCOL_VERSION = "2026-01-26";
const MAX_HEIGHT = 720;
const MIN_HEIGHT = 160;
const INITIAL_HEIGHT = 360;
const INIT_TIMEOUT_MS = 15_000;

type PrefabStatus = "loading" | "ready" | "error";

function clampHeight(height: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));
}

/** Reply helper + the tools/call forwarder (module-level, no closure deps). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Forward a renderer `tools/call` request to the backend MCP proxy and post
 * the CallToolResult back to the iframe. The tool name arrives in FastMCP's
 * hashed app-tool form (`<hash>_<name>`) and passes through untouched — the
 * FastMCP server resolves the hash.
 */
async function forwardToolCall(
  message: { id?: unknown; params?: unknown },
  post: (message: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const replyError = (code: number, errorMessage: string) => {
    post({
      jsonrpc: "2.0",
      id: message.id,
      error: { code, message: errorMessage },
    });
  };

  const params = isJsonObject(message.params) ? message.params : {};
  const name = typeof params.name === "string" ? params.name : "";
  const arguments_ = isJsonObject(params.arguments) ? params.arguments : {};
  if (!name) {
    replyError(-32602, "tools/call requires a string `name`");
    return;
  }

  let res: Response;
  try {
    res = await fetchWithAuth("/api/mcp/tools/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: arguments_ }),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return; // host unmounted — drop silently
    }
    replyError(-32000, "MCP backend unreachable");
    return;
  }

  if (!res.ok) {
    // 404 = tool not found on any server, 502 = upstream transport failure,
    // 503 = proxy itself offline. Prefer the backend's detail when present.
    let detail = `MCP proxy error (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch {
      // non-JSON error body — keep the status-based message
    }
    replyError(-32000, detail);
    return;
  }

  const result = (await res.json()) as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
  };
  post({
    jsonrpc: "2.0",
    id: message.id,
    result: {
      content: Array.isArray(result.content) ? result.content : [],
      structuredContent: result.structuredContent ?? null,
      isError: result.isError === true,
    },
  });
}

export function PrefabApp({ payload }: { payload: PrefabPayload }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const payloadRef = useRef(payload);
  const readyRef = useRef(false);
  // JSON of the envelope last handed to the renderer. The chat re-creates
  // part objects on every message update, so `payload` reference changes
  // constantly — re-pushing on reference alone would reset the app's
  // client-side state on every render (clicks would appear dead).
  const pushedJsonRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PrefabStatus>("loading");
  const [height, setHeight] = useState(INITIAL_HEIGHT);

  useEffect(() => {
    payloadRef.current = payload;
    // Only re-push when the envelope CONTENT actually changed (e.g. a
    // regenerated response updated this part's output in place).
    if (!readyRef.current) {
      return;
    }
    const nextJson = JSON.stringify(payload.json);
    if (nextJson !== pushedJsonRef.current) {
      pushedJsonRef.current = nextJson;
      iframeRef.current?.contentWindow?.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            content: [{ type: "text", text: "[Rendered Prefab UI]" }],
            structuredContent: payload.json,
            isError: false,
          },
        },
        "*",
      );
    }
  }, [payload]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    let initialized = false;
    // Created per setup, NOT via useRef: dev StrictMode runs effects as
    // setup -> cleanup -> setup, and an aborted controller from the first
    // cleanup would make every forwarded tools/call fetch throw AbortError
    // (buttons appear dead).
    const abortController = new AbortController();

    const post = (message: unknown) => {
      iframe.contentWindow?.postMessage(message, "*");
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) {
        return;
      }
      const data = event.data;
      if (typeof data !== "object" || data === null || data.jsonrpc !== "2.0") {
        return;
      }
      const message = data as {
        id?: unknown;
        method?: unknown;
        params?: unknown;
      };
      switch (message.method) {
        case "ui/initialize": {
          // Step 2 — negotiate with the renderer.
          post({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              // serverTools: the host can proxy tools/call to the backend's
              // /mcp/tools/call endpoint (interactive apps light up).
              hostCapabilities: { serverTools: {} },
              hostInfo: { name: "ai-frontend-lab", version: "0.1.0" },
              hostContext: {
                theme: document.documentElement.classList.contains("dark")
                  ? "dark"
                  : "light",
                displayMode: "inline",
                containerDimensions: { maxHeight: MAX_HEIGHT },
              },
            },
          });
          break;
        }
        case "ui/notifications/initialized": {
          // Step 4 — deliver the tool result once the app is up.
          readyRef.current = true;
          initialized = true;
          setStatus("ready");
          pushedJsonRef.current = JSON.stringify(payloadRef.current.json);
          post({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: {
              content: [{ type: "text", text: "[Rendered Prefab UI]" }],
              structuredContent: payloadRef.current.json,
              isError: false,
            },
          });
          break;
        }
        case "ui/notifications/size-changed": {
          const size = message.params as { width?: unknown; height?: unknown };
          if (typeof size?.height === "number") {
            setHeight(clampHeight(size.height));
          }
          break;
        }
        case "tools/call": {
          // Interactive app action — forward to the backend's MCP proxy and
          // hand the CallToolResult back to the renderer verbatim.
          void forwardToolCall(message, post, abortController.signal);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => {
      if (!initialized) {
        setStatus("error");
      }
    }, INIT_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
      abortController.abort();
      window.removeEventListener("message", onMessage);
      readyRef.current = false;
      // Graceful teardown (best-effort, fire-and-forget).
      post({ jsonrpc: "2.0", method: "ui/resource-teardown", params: {} });
    };
  }, []);

  return (
    <div className="flex flex-col">
      {status === "error" ? (
        <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-[12px] text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            Couldn&apos;t load the Prefab renderer (CDN unreachable or renderer
            failed to initialize).
          </span>
        </div>
      ) : (
        <div
          className={cn(
            "relative overflow-hidden rounded-lg border border-border/60 bg-white",
            status === "loading" && "animate-pulse",
          )}
          style={{ height }}
        >
          <iframe
            ref={iframeRef}
            title="Prefab app"
            className="absolute inset-0 size-full border-0"
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
            srcDoc={prefabRendererHtml()}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Inline chat block for FastMCP Prefab apps. Rendered directly in the
 * message flow (next to text, like a subagent card) instead of inside the
 * collapsible tool-result disclosure — the MCP Apps extension's intended
 * presentation: "the app lives inside the conversation".
 */
export function PrefabAppCard({
  part,
  prefab,
}: {
  part: ToolUIPart;
  prefab: PrefabPayload;
}) {
  const toolName = part.type.replace(/^tool-/, "");
  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/60 bg-card/50">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <AppWindowIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-[12px] font-medium text-foreground">
          {toolName}
        </span>
        <Badge className="ml-auto" variant="outline">
          app
        </Badge>
      </div>
      <div className="p-2.5">
        <PrefabApp payload={prefab} />
      </div>
    </div>
  );
}
