// User preferences client: server-side per-user preferences (backend
// user_preferences table, migration 0007). The web-search toggle lives
// here now — the backend applies the stored value to every chat request
// unless the request carries an explicit enable_search override.

import { fetchWithAuth } from "@/lib/auth";

type PreferencesPayload = {
  enable_search?: boolean | null;
};

/**
 * Effective web-search preference: the stored per-user value, or null
 * when unset (backend then falls back to its SEARXNG_ENABLED config).
 * Returns null on any failure — callers fall back to their local cache.
 */
export async function fetchSearchPreference(): Promise<boolean | null> {
  try {
    const res = await fetchWithAuth("/api/preferences", { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as PreferencesPayload;
    return typeof data.enable_search === "boolean" ? data.enable_search : null;
  } catch {
    return null;
  }
}

/**
 * Persist the web-search preference; pass null to clear it (reverts to
 * the server default). Throws on failure so callers can surface errors.
 */
export async function updateSearchPreference(
  value: boolean | null,
): Promise<void> {
  const res = await fetchWithAuth("/api/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enable_search: value } satisfies PreferencesPayload),
  });
  if (!res.ok) {
    throw new Error(`preferences update failed: ${res.status}`);
  }
}
