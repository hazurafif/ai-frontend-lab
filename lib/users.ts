// Admin user management API (proxied to the backend /users endpoints).
// Only users with the `admin` role may call these; the backend enforces it.

import { type AuthUser, fetchWithAuth } from "@/lib/auth";

export type ManagedUser = AuthUser;

async function usersFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithAuth(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Backend unreachable.");
  }
  if (!res.ok && res.status !== 404) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(detail);
  }
  return res;
}

/** Admin: list all users (newest first, no password hashes). */
export async function fetchUsers(): Promise<ManagedUser[]> {
  const res = await usersFetch("/api/auth/users");
  return (await res.json()) as ManagedUser[];
}

/** Admin: create a user; the admin role may be granted directly. */
export async function createUser(payload: {
  username: string;
  password: string;
  email?: string | null;
  full_name?: string | null;
  role?: "user" | "admin";
}): Promise<ManagedUser> {
  const res = await usersFetch("/api/auth/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return (await res.json()) as ManagedUser;
}

/** Admin: change a user's role and/or disabled state. */
export async function updateUser(
  username: string,
  patch: { role?: "user" | "admin"; disabled?: boolean },
): Promise<ManagedUser> {
  const res = await usersFetch(
    `/api/auth/users/${encodeURIComponent(username)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
  return (await res.json()) as ManagedUser;
}

/** Admin: delete a user (their threads/history rows stay, orphaned). */
export async function deleteUser(username: string): Promise<void> {
  await usersFetch(`/api/auth/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}
