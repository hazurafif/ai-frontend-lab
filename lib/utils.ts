import type { UIMessage } from "ai";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { authHeaders, isAuthEndpoint, refreshAccessToken } from "./auth";
import { ChatbotError, type ErrorCode } from "./errors";
import type { ChatMessage } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatbotError(code as ErrorCode, cause);
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
    const { code, cause } = await response.json();
    throw new ChatbotError(code as ErrorCode, cause);
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

export function getTextFromMessage(message: ChatMessage | UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { type: "text"; text: string }).text)
    .join("");
}
