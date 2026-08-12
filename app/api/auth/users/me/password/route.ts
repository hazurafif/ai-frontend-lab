// Auth proxy route.
//
// Forwards POST /api/auth/users/me/password to the backend's
// /users/me/password endpoint (self-service password change; the Bearer
// token is forwarded so the backend can validate the caller).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function POST(request: Request) {
  return forwardBackendRequest(request, "/users/me/password");
}
