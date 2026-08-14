// Server-side thread API (proxied to the backend /threads endpoints) and
// conversion helpers between backend payloads and the client's UI state.
//
// Threads live in the backend's LangGraph store, scoped per user. The
// sidebar history and the message cache are still mirrored to localStorage
// (offline fallback + guest mode); these functions read/write the server so
// conversations survive across browsers and devices.

import { fetchWithAuth } from "@/lib/auth";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

export type ServerThread = {
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string | null;
  /** Public share token; present when the thread has a share link. */
  share_token?: string | null;
};

async function threadFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithAuth(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Backend unreachable.");
  }
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(detail);
  }
  return res;
}

/** The current user's threads, newest first. */
export async function fetchThreads(): Promise<ServerThread[]> {
  const res = await threadFetch("/api/chat/threads");
  return (await res.json()) as ServerThread[];
}

// GET /threads/{id}/usage (backend `ThreadUsageOut`): session context +
// cumulative token usage for one thread. `context` is the last run's input
// tokens vs the model's context window (null before the first run / when
// the provider reports no usage / window unknown).
export type ThreadUsage = {
  thread_id: string;
  agent: string | null;
  model: string | null;
  messages: { count: number; characters: number };
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    runs: number;
  } | null;
  context: {
    current_input_tokens: number;
    context_window: number | null;
    utilization: number | null;
    remaining_tokens: number | null;
  } | null;
  active_run: boolean;
};

/** Context + usage report of a thread; null when the thread has no report yet. */
export async function fetchThreadUsage(
  threadId: string,
): Promise<ThreadUsage | null> {
  const res = await threadFetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}/usage`,
  );
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as ThreadUsage;
}

/** Delete a thread server-side (checkpoint, history rows, metadata). */
export async function deleteThread(threadId: string): Promise<void> {
  await threadFetch(`/api/chat/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
}

/** Rename a thread; returns the updated thread. */
export async function renameThread(
  threadId: string,
  title: string,
): Promise<ServerThread> {
  const res = await threadFetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  );
  return (await res.json()) as ServerThread;
}

/** Abort the thread's active run server-side. 409 = no active run (fine). */
export async function cancelThread(threadId: string): Promise<void> {
  await threadFetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}/cancel`,
    { method: "POST" },
  );
}

/** The thread's persisted messages (LangGraph message dumps). */
export async function fetchThreadMessages(
  threadId: string,
): Promise<ServerMessage[]> {
  const res = await threadFetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}/messages`,
  );
  if (!res.ok) {
    return [];
  }
  return (await res.json()) as ServerMessage[];
}

/**
 * A message as persisted by the backend (LangGraph message dumps):
 * `{type: "human" | "ai" | "tool", content, tool_calls?, tool_call_id?}`.
 */
export type ServerMessage = {
  type?: string;
  content?: unknown;
  tool_calls?: { id?: string; name?: string; args?: unknown }[];
  tool_call_id?: string;
  name?: string;
  // OpenAI-compatible models store reasoning under additional_kwargs.
  additional_kwargs?: Record<string, unknown>;
};

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }
        if (
          block &&
          typeof block === "object" &&
          "text" in block &&
          typeof block.text === "string"
        ) {
          return block.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Reasoning text persisted with an AI message (thinking/reasoning blocks). */
function reasoningFromMessage(msg: ServerMessage): string {
  // OpenAI-compatible: additional_kwargs.reasoning_content (string or parts).
  const kwargs = msg.additional_kwargs;
  const kwText = kwargs?.reasoning_content;
  if (typeof kwText === "string" && kwText.trim()) {
    return kwText;
  }
  if (Array.isArray(kwText)) {
    const joined = kwText
      .filter((part): part is string => typeof part === "string")
      .join("");
    if (joined.trim()) {
      return joined;
    }
  }
  // Content blocks shaped {type: "reasoning" | "thinking", text}.
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }
        const b = block as { reasoning?: unknown; thinking?: unknown };
        const text = b.reasoning ?? b.thinking;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

/**
 * Convert persisted backend messages to UIMessages so a conversation can be
 * rehydrated from the server (new device / cleared cache). Tool results are
 * matched to their tool calls by `tool_call_id`; messages the UI cannot
 * render (system, etc.) are skipped.
 */
export function serverMessagesToChatMessages(
  server: ServerMessage[],
): ChatMessage[] {
  const toolOutputs = new Map<string, string>();
  for (const msg of server) {
    if (msg.type === "tool" && msg.tool_call_id) {
      toolOutputs.set(msg.tool_call_id, contentToText(msg.content));
    }
  }

  const messages: ChatMessage[] = [];
  for (const msg of server) {
    if (msg.type === "human") {
      messages.push({
        id: generateUUID(),
        role: "user",
        parts: [{ type: "text", text: contentToText(msg.content) }],
      });
    } else if (msg.type === "ai") {
      const parts: ChatMessage["parts"] = [];
      const reasoning = reasoningFromMessage(msg);
      if (reasoning) {
        parts.push({ type: "reasoning", text: reasoning });
      }
      const text = contentToText(msg.content);
      if (text) {
        parts.push({ type: "text", text });
      }
      for (const call of msg.tool_calls ?? []) {
        const toolCallId = call.id ?? generateUUID();
        const output = toolOutputs.get(toolCallId);
        // The SDK's tool part union is keyed by a typed tools map; the app
        // renders these via ToolCard's own ToolUIPart shape (see message.tsx),
        // so cast the dynamic tool name through the SDK type.
        parts.push({
          type: `tool-${call.name ?? "unknown"}`,
          toolCallId,
          toolName: call.name ?? "unknown",
          state: output !== undefined ? "output-available" : "input-available",
          input: call.args ?? {},
          ...(output !== undefined ? { output } : {}),
        } as unknown as ChatMessage["parts"][number]);
      }
      messages.push({ id: generateUUID(), role: "assistant", parts });
    }
    // "tool" messages are folded into the preceding ai message's tool parts.
  }
  return messages;
}
