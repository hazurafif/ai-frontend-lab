// Per-user localStorage scoping for the chat caches.
//
// The sidebar history list, the per-thread message cache and the
// last-active-thread marker are stored in localStorage as an offline/guest
// fallback. They used to live under one shared namespace
// (`chat-history`, `chat-messages:<id>`, `app-last-active-chat`) no matter
// who was signed in — on a shared browser, account B saw account A's (and
// the anonymous guest's) cached threads and the sidebar rendered them all.
// Every cache key is therefore namespaced by the signed-in username, and
// anonymous sessions keep using the legacy keys as the fixed "guest" scope.
//
// The legacy keys are NEVER migrated into a signed-in scope: they contain a
// mix of every account's rows (plus guest rows), so claiming them would
// leak another account's threads into whoever claimed them. Signed-in
// scopes are no longer read at all — the sidebar and the conversation
// cache are server-only when authenticated — but the keys stay namespaced
// so nothing from one account can ever leak into another's UI.
//
// The notification-stream cursor (lib/chat/chat-store.tsx) already follows
// this scheme (`app-notification-seq:<username>`).

import {
  CHAT_STORAGE_PREFIX,
  HISTORY_STORAGE_KEY,
  LAST_ACTIVE_CHAT_KEY,
} from "@/lib/constants";

/** localStorage scope for anonymous sessions (also the legacy keys). */
export const GUEST_SCOPE = "guest";

/** The storage scope for a signed-in user: their username, or GUEST_SCOPE. */
export function storageScope(username: string | null | undefined): string {
  const name = username?.trim();
  return name ? name : GUEST_SCOPE;
}

/** localStorage key of the sidebar history list for a scope. */
export function historyStorageKey(scope: string): string {
  return scope === GUEST_SCOPE
    ? HISTORY_STORAGE_KEY
    : `${HISTORY_STORAGE_KEY}:${scope}`;
}

/** localStorage key of a thread's message cache for a scope. */
export function messagesStorageKey(scope: string, chatId: string): string {
  return scope === GUEST_SCOPE
    ? `${CHAT_STORAGE_PREFIX}${chatId}`
    : `${CHAT_STORAGE_PREFIX}${scope}:${chatId}`;
}

/** localStorage key of the last-opened thread marker for a scope. */
export function lastActiveStorageKey(scope: string): string {
  return scope === GUEST_SCOPE
    ? LAST_ACTIVE_CHAT_KEY
    : `${LAST_ACTIVE_CHAT_KEY}:${scope}`;
}
