// Client-side auth helpers.
//
// The backend issues a JWT at POST /login (OAuth2 password form) and protects
// /api/chat, /agent/* and /users/me with it. The token is stored in
// localStorage and attached as an `Authorization: Bearer ...` header to every
// backend call; the /api/* proxies forward request headers verbatim.

import { AUTH_TOKEN_KEY } from "@/lib/constants";

export type AuthUser = {
  username: string;
  email?: string | null;
  full_name?: string | null;
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
  } catch {
    // ignore
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

/** fetch() wrapper that attaches the stored Bearer token. */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, { ...init, headers: authHeaders(init?.headers) });
}
