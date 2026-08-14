export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";

// localStorage keys used for client-side chat persistence
export const HISTORY_STORAGE_KEY = "chat-history";
export const CHAT_STORAGE_PREFIX = "chat-messages:";

// localStorage key for the JWT returned by the backend /login endpoint
export const AUTH_TOKEN_KEY = "app-auth-token";

// localStorage key for the refresh token (exchanged for a fresh access
// token via POST /api/auth/refresh when the access token expires)
export const REFRESH_TOKEN_KEY = "app-refresh-token";

// Fired on window when the chat history list changes (new/renamed/deleted chats)
export const HISTORY_CHANGED_EVENT = "chat-history-updated";

// Fired on window whenever settings are saved, so live consumers (the chat
// input's model selector) can pick up changes without a page reload.
export const SETTINGS_CHANGED_EVENT = "app-settings-updated";
