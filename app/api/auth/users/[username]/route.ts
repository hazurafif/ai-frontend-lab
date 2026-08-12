// Auth proxy route (admin).
//
// Forwards PATCH/DELETE /api/auth/users/{username} to the backend's
// /users/{username} endpoints (change role/disabled state / delete a user).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  return forwardBackendRequest(
    request,
    `/users/${encodeURIComponent(username)}`,
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  return forwardBackendRequest(
    request,
    `/users/${encodeURIComponent(username)}`,
  );
}
