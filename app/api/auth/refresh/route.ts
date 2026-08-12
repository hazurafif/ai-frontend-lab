// Auth proxy route.
//
// Forwards POST /api/auth/refresh to the backend's /refresh endpoint
// (exchange a valid refresh token for a fresh access token).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function POST(request: Request) {
  return forwardBackendRequest(request, "/refresh");
}
