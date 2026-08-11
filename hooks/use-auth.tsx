"use client";

// Auth state for the whole app: JWT in localStorage, user fetched from the
// backend, login/logout actions. Mount-gated so the server render (signed
// out) matches the client's first render.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type AuthUser,
  clearStoredToken,
  fetchWithAuth,
  getStoredToken,
  setStoredToken,
} from "@/lib/auth";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetchWithAuth("/api/auth/me", { cache: "no-store" });
  if (!res.ok) {
    const error = new Error(`me failed: ${res.status}`) as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
  return (await res.json()) as AuthUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  // Validate a stored token on first mount: clear it when the backend
  // rejects it (expired/invalid), keep the session when it succeeds.
  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setStatus("unauthenticated");
      return;
    }

    // Optimistically treat a stored token as a session. Only a 401 (token
    // rejected by the backend) signs the user out; transient network/5xx
    // failures keep the session so the app still works offline.
    setStatus("authenticated");
    fetchMe()
      .then((me) => {
        if (!cancelled) {
          setUser(me);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if ((error as { status?: number }).status === 401) {
          clearStoredToken();
          setUser(null);
          setStatus("unauthenticated");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const body = new URLSearchParams({ username, password });
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      let detail = "Sign in failed. Please try again.";
      try {
        const data = (await res.json()) as { detail?: string };
        if (data.detail) {
          detail = data.detail;
        }
      } catch {
        // non-JSON error body — keep the default message
      }
      if (res.status === 401) {
        detail = "Incorrect username or password.";
      }
      throw new Error(detail);
    }

    const { access_token } = (await res.json()) as { access_token: string };
    setStoredToken(access_token);

    setUser({ username });
    setStatus("authenticated");

    // Best-effort: hydrate the full profile (email, full name).
    fetchMe()
      .then((me) => {
        if (me) {
          setUser(me);
        }
      })
      .catch(() => {
        // profile is optional — the session is already established
      });
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === "authenticated",
      login,
      logout,
    }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
