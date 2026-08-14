export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";

// localStorage keys used for client-side chat persistence
export const HISTORY_STORAGE_KEY = "chat-history";
export const CHAT_STORAGE_PREFIX = "chat-messages:";

// localStorage key for the JWT returned by the backend /login endpoint
export const AUTH_TOKEN_KEY = "app-auth-token";

// localStorage key for the last conversation the user opened
// (`/chat/<id>`). Navigation back from /settings restores this thread
// instead of landing on a blank new chat (the / route always starts new).
export const LAST_ACTIVE_CHAT_KEY = "app-last-active-chat";

// localStorage key for the refresh token (exchanged for a fresh access
// token via POST /api/auth/refresh when the access token expires)
export const REFRESH_TOKEN_KEY = "app-refresh-token";

// Fired on window when the chat history list changes (new/renamed/deleted chats)
export const HISTORY_CHANGED_EVENT = "chat-history-updated";

// Fired on window whenever settings are saved, so live consumers (the chat
// input's model selector) can pick up changes without a page reload.
export const SETTINGS_CHANGED_EVENT = "app-settings-updated";

// Fired on window whenever a run lifecycle event lands for any thread
// (notification stream, attach-stream terminal) — live consumers (the usage
// widget) refresh cheap state without a full page reload.
export const THREAD_ACTIVITY_EVENT = "chat-thread-activity";

// localStorage key prefix for the notification-stream cursor (last seen
// event seq), per user: `app-notification-seq:<username>`. Passed as
// `?since=` on reconnect so missed events are replayed, not lost.
export const NOTIFICATION_SEQ_PREFIX = "app-notification-seq:";
