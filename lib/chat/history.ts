// Local (localStorage) sidebar history helpers shared by the chat UI.
// Signed-in users are server-only: the sidebar and the conversation cache
// come from the backend's /threads endpoints and never from localStorage.
// These helpers exist for the guest/anonymous fallback and for the one-time
// server-thread → sidebar-item conversion.
//
// Every key is namespaced per user (lib/storage.ts): the sidebar must never
// render another account's cached threads.

import { HISTORY_CHANGED_EVENT } from "@/lib/constants";
import { historyStorageKey } from "@/lib/storage";
import type { ServerThread } from "@/lib/threads";
import type { ChatHistoryItem } from "@/lib/types";

/** The persisted sidebar history for a scope, newest first; [] when empty/unavailable. */
export function loadHistory(scope: string): ChatHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(historyStorageKey(scope));
    return raw ? (JSON.parse(raw) as ChatHistoryItem[]) : [];
  } catch {
    return [];
  }
}

/** Replace the persisted sidebar history for a scope wholesale. */
export function saveHistory(scope: string, history: ChatHistoryItem[]) {
  try {
    window.localStorage.setItem(
      historyStorageKey(scope),
      JSON.stringify(history),
    );
  } catch {
    // storage unavailable — ignore
  }
}

/** Convert a server thread row to a sidebar history item. */
export function serverThreadToHistoryItem(
  thread: ServerThread,
): ChatHistoryItem {
  return {
    id: thread.thread_id,
    title: thread.title || "New chat",
    createdAt: thread.created_at,
    shareToken: thread.share_token ?? null,
  };
}

/**
 * Apply a server-generated title (auto-title from the followup endpoint) to
 * the local history row and notify the sidebar. No-op when the row is
 * missing, the title is empty/unchanged, or it is the generic placeholder.
 */
export function updateHistoryTitle(
  scope: string,
  chatId: string,
  title: string,
) {
  const trimmed = title.trim();
  if (!trimmed || trimmed === "New chat") {
    return;
  }
  const history = loadHistory(scope);
  let changed = false;
  const next = history.map((chat) => {
    if (chat.id !== chatId || chat.title === trimmed) {
      return chat;
    }
    changed = true;
    return { ...chat, title: trimmed };
  });
  if (!changed) {
    return;
  }
  saveHistory(scope, next);
  window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
}
