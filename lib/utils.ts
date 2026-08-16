import type { UIMessage } from "ai";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { authHeaders, isAuthEndpoint, refreshAccessToken } from "./auth";
import {
  ChatbotError,
  errorCodeFromStatus,
  isErrorCode,
  type ErrorCode,
  type Surface,
} from "./errors";
import type { ChatMessage } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parse a failed response body. The AI backend responds with FastAPI's
 * `{"detail": ...}` shape while the frontend error contract is
 * `{code, cause}` — accept both, and swallow bodies that aren't JSON
 * (empty 401s, proxy error pages).
 */
async function parseErrorBody(
  response: Response,
): Promise<{ code?: unknown; cause?: unknown }> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    return { code: body.code, cause: body.cause ?? body.detail };
  } catch {
    return {};
  }
}

/** Raise a ChatbotError, deriving a code from the status when the body has none. */
async function chatbotErrorFrom(
  response: Response,
  surface: Surface,
): Promise<ChatbotError> {
  const { code, cause } = await parseErrorBody(response);
  const normalized: ErrorCode = isErrorCode(code)
    ? code
    : errorCodeFromStatus(response.status, surface);
  return new ChatbotError(normalized, cause as string | undefined);
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw await chatbotErrorFrom(response, "api");
  }

  return response.json();
};

/**
 * fetch() wrapper for the chat transport: surfaces backend error bodies as
 * ChatbotError, maps offline failures to `offline:chat`, and — like
 * fetchWithAuth — refreshes an expired access token once and retries before
 * giving up. Without the retry, a stale token would let the backend
 * silently degrade the chat to a guest session (or, once the backend
 * requires auth, fail the request outright).
 */
export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error: unknown) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new ChatbotError("offline:chat");
    }
    throw error;
  }

  // The access token expired: try one refresh, then retry the request once.
  if (response.status === 401 && !isAuthEndpoint(input)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await fetch(input, {
        ...init,
        headers: authHeaders(init?.headers),
      });
    }
  }

  if (!response.ok) {
    throw await chatbotErrorFrom(response, "chat");
  }

  return response;
}

export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function sanitizeText(text: string) {
  return text.replace("<has_function_call>", "");
}

/**
 * Copy text to the clipboard with a fallback for insecure contexts (LAN /
 * plain HTTP — e.g. testing from a phone on the same Wi-Fi), where the
 * async Clipboard API is unavailable or rejected. Returns false when
 * nothing could be copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permissions policy / focus rejection — fall back below.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.zIndex = "-1";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function getTextFromMessage(message: ChatMessage | UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { type: "text"; text: string }).text)
    .join("");
}
