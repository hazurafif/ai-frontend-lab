// Auth proxy route.
//
// Forwards GET /api/auth/users/me/allowed-models to the backend's
// /users/me/allowed-models endpoint — the caller's effective model
// restriction (role-aware: admins always see restricted=false). The
// frontend filters the model picker with this.

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(request: Request) {
  return forwardBackendRequest(request, "/users/me/allowed-models");
}
