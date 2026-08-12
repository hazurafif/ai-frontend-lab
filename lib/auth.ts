// Client-side auth helpers.
//
// The backend issues a JWT at POST /login (OAuth2 password form) and protects
// /api/chat, /agent/* and /users/me with it. The token is stored in
// localStorage and attached as an `Authorization: Bearer ...` header to every
// backend call; the /api/* proxies forward request headers verbatim.
//
// The backend also issues a refresh token; when the access token expires
// (401), fetchWithAuth exchanges it at POST /refresh and retries the request
// once, so sessions survive longer than the access token TTL.

import { AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY } from "@/lib/constants";

export type AuthUser = {
  username: string;
  email?: string | null;
  full_name?: string | null;
  role?: "user" | "admin";
  disabled?: boolean | null;
};

/** Token helpers — localStorage guarded so they are SSR-safe. */

export function getStoredToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string) {
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // storage unavailable — the session just won't survive a reload
  }
}

export function clearStoredToken() {
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredRefreshToken(token: string) {
  try {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

/**
 * Exchange the stored refresh token for a fresh access token. Returns the
 * new access token (also stored) or null when no refresh token exists or
 * the backend rejects it.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    return null;
  }
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      return null;
    }
    setStoredToken(data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
}

/** Headers for a backend call; adds the Bearer token when one is stored. */
export function authHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function isAuthEndpoint(input: RequestInfo | URL): boolean {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return url.includes("/api/auth/login") || url.includes("/api/auth/refresh");
}

/** fetch() wrapper that attaches the stored Bearer token. */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let res = await fetch(input, {
    ...init,
    headers: authHeaders(init?.headers),
  });

  // The access token expired: try one refresh, then retry the request.
  if (res.status === 401 && !isAuthEndpoint(input)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await fetch(input, {
        ...init,
        headers: authHeaders(init?.headers),
      });
    }
  }
  return res;
}

/** Self-service password change: verify the old password, store the new one. */
export async function changeOwnPassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetchWithAuth("/api/auth/users/me/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      old_password: oldPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    let detail = "Password change failed. Please try again.";
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) {
        detail = data.detail;
      }
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(detail);
  }
}
