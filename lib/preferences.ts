// User preferences client: server-side per-user preferences (backend
// user_preferences table, migration 0007). The web-search toggle and the
// chat display toggles (hide thinking / hide tool calls) live here — the
// backend applies the stored values to every chat stream unless the request
// carries an explicit override.

import { fetchWithAuth } from "@/lib/auth";

export type PreferencesPayload = {
  enable_search?: boolean | null;
  hide_reasoning?: boolean | null;
  hide_tool_calls?: boolean | null;
  // Per-user enabled models (`provider:model` ids, as listed by
  // /connections/models): null = no restriction (every model enabled),
  // [] = none. The backend refuses chat when the effective model is not
  // in this list.
  enabled_models?: string[] | null;
};

export type UserPreferences = {
  // Effective web-search preference: stored value, or null when unset
  // (backend then falls back to its SEARXNG_ENABLED config).
  enableSearch: boolean | null;
  // Effective display preferences (default False = show).
  hideReasoning: boolean;
  hideToolCalls: boolean;
  // Effective enabled-models list; null = no restriction (all enabled).
  enabledModels: string[] | null;
};

function toUserPreferences(data: PreferencesPayload): UserPreferences {
  return {
    enableSearch:
      typeof data.enable_search === "boolean" ? data.enable_search : null,
    hideReasoning: Boolean(data.hide_reasoning),
    hideToolCalls: Boolean(data.hide_tool_calls),
    enabledModels: Array.isArray(data.enabled_models)
      ? data.enabled_models
      : null,
  };
}

/**
 * Effective per-user preferences. Returns null on any failure — callers
 * fall back to their local cache.
 */
export async function fetchPreferences(): Promise<UserPreferences | null> {
  try {
    const res = await fetchWithAuth("/api/preferences", { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    return toUserPreferences((await res.json()) as PreferencesPayload);
  } catch {
    return null;
  }
}

/**
 * Persist preference keys; pass null to clear a key (reverts to the server
 * default). The response carries the full effective state. Throws on
 * failure so callers can surface errors.
 */
export async function updatePreferences(
  patch: PreferencesPayload,
): Promise<UserPreferences> {
  const res = await fetchWithAuth("/api/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch satisfies PreferencesPayload),
  });
  if (!res.ok) {
    throw new Error(`preferences update failed: ${res.status}`);
  }
  return toUserPreferences((await res.json()) as PreferencesPayload);
}

/**
 * Effective web-search preference, or null when unset. Returns null on any
 * failure — callers fall back to their local cache.
 */
export async function fetchSearchPreference(): Promise<boolean | null> {
  const prefs = await fetchPreferences();
  return prefs?.enableSearch ?? null;
}

/**
 * Persist the web-search preference; pass null to clear it (reverts to
 * the server default). Throws on failure so callers can surface errors.
 */
export async function updateSearchPreference(
  value: boolean | null,
): Promise<void> {
  await updatePreferences({ enable_search: value });
}
