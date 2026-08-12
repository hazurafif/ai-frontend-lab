// Client-side share service.
//
// Talks to the /api/share proxy, which maps onto the backend (ai-backend-lab):
//
//   POST /api/share/<chat_id>   -> 201 { share_token, url }   (idempotent)
//   GET  /api/share/<chat_id>   -> 200 { share_token, url } | 404 when not shared
//   DELETE /api/share/<chat_id> -> 204 (revoke share link)
//
// The backend already stores the thread, so no message payload is needed.
// The `url` returned by the backend points at the API host; the frontend
// builds its own public URL (/share/<share_token>), served by this app.

import { authHeaders } from "@/lib/auth";
import { ChatbotError, type ErrorCode } from "@/lib/errors";

export type ShareResult = {
  shareToken: string;
  /** Public, copyable URL for the shared chat (served by this app). */
  url: string;
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export async function createChatShare(chatId: string): Promise<ShareResult> {
  const response = await fetch(`${BASE_PATH}/api/share/${chatId}`, {
    method: "POST",
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      code?: string;
      detail?: string;
      message?: string;
    } | null;
    const code =
      (body?.code as ErrorCode) ??
      (response.status === 404 ? "not_found:share" : "bad_request:share");
    throw new ChatbotError(code, body?.detail ?? body?.message);
  }

  const data = (await response.json().catch(() => null)) as {
    share_token?: string;
  } | null;
  const shareToken = data?.share_token;

  if (!shareToken) {
    throw new ChatbotError(
      "bad_request:share",
      "The share backend did not return a share token.",
    );
  }

  return {
    shareToken,
    url: `${window.location.origin}${BASE_PATH}/share/${shareToken}`,
  };
}

/** Revoke a chat's share link (idempotent: 404 is treated as success). */
export async function revokeChatShare(chatId: string): Promise<void> {
  const response = await fetch(`${BASE_PATH}/api/share/${chatId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (response.ok || response.status === 404) {
    return;
  }

  const body = (await response.json().catch(() => null)) as {
    code?: string;
    detail?: string;
    message?: string;
  } | null;
  throw new ChatbotError(
    (body?.code as ErrorCode) ?? "bad_request:share",
    body?.detail ?? body?.message,
  );
}
