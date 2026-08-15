// Local (localStorage) sidebar history helpers shared by the chat UI.
// Server threads (lib/threads.ts) are the source of truth when signed in;
// this mirror keeps the sidebar usable offline and in guest mode.
//
// Every key is namespaced per signed-in user (lib/storage.ts): the sidebar
// must never render another account's cached threads. The legacy (shared,
// pre-scoping) keys are the guest namespace only and are never claimed into
// a signed-in scope — see scrubLocalCacheOnce for how pre-existing mixed
// caches get healed instead.

import { HISTORY_CHANGED_EVENT } from "@/lib/constants";
import {
  GUEST_SCOPE,
  historyStorageKey,
  isHistoryScrubbed,
  markHistoryScrubbed,
  messagesStorageKey,
} from "@/lib/storage";
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
 * One-time per-scope cleanup of a signed-in cache. Before account scoping,
 * ALL sessions shared one localStorage namespace (`chat-history`,
 * `chat-messages:<id>`), so caches from that era can contain other
 * accounts' thread rows — and a short-lived build briefly claimed that
 * shared cache into whichever account signed in first. This heals both:
 * the first successful server fetch for a scope treats the server list as
 * authoritative — local-only history rows and the message caches of
 * threads the server doesn't list are dropped — and the scope is marked
 * scrubbed so it never runs again (rows saved afterwards are legitimately
 * the current user's own).
 *
 * Note: the backend currently caps GET /threads at 10 rows, so this pass
 * may also drop the user's own older local-only rows. They remain on the
 * server, and a backend fix to the list limit repopulates the sidebar.
 *
 * Returns true when this call performed the scrub.
 */
export function scrubLocalCacheOnce(
  scope: string,
  threads: ServerThread[],
): boolean {
  if (scope === GUEST_SCOPE || isHistoryScrubbed(scope)) {
    return false;
  }
  const serverIds = new Set(threads.map((t) => t.thread_id));
  saveHistory(scope, threads.map(serverThreadToHistoryItem));
  // Drop message caches of threads the server doesn't list (other accounts'
  // / guest threads from the shared-cache era).
  try {
    const prefix = messagesStorageKey(scope, "");
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const chatId = key.slice(prefix.length);
        if (!serverIds.has(chatId)) {
          window.localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // storage unavailable — the history-list scrub still stands
  }
  markHistoryScrubbed(scope);
  return true;
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
