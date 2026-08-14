// Local (localStorage) sidebar history helpers shared by the chat UI.
// Server threads (lib/threads.ts) are the source of truth when signed in;
// this mirror keeps the sidebar usable offline and in guest mode.

import { HISTORY_CHANGED_EVENT, HISTORY_STORAGE_KEY } from "@/lib/constants";
import type { ChatHistoryItem } from "@/lib/types";

/** The persisted sidebar history, newest first; [] when empty/unavailable. */
export function loadHistory(): ChatHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatHistoryItem[]) : [];
  } catch {
    return [];
  }
}

/** Replace the persisted sidebar history wholesale. */
export function saveHistory(history: ChatHistoryItem[]) {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // storage unavailable — ignore
  }
}

/**
 * Apply a server-generated title (auto-title from the followup endpoint) to
 * the local history row and notify the sidebar. No-op when the row is
 * missing, the title is empty/unchanged, or it is the generic placeholder.
 */
export function updateHistoryTitle(chatId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed || trimmed === "New chat") {
    return;
  }
  const history = loadHistory();
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
  saveHistory(next);
  window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
}
