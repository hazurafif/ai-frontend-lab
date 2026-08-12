// Auth proxy route.
//
// Forwards POST /api/auth/register to the backend's /register endpoint
// (creates a regular `user` account; no token is issued).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function POST(request: Request) {
  return forwardBackendRequest(request, "/register");
}
