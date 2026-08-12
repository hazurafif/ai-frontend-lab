// Chat proxy route.
//
// Forwards GET /api/chat/threads to the backend's /threads endpoint
// (the current user's threads, newest first). The Bearer token is
// forwarded so the backend scopes the list to that user.

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(request: Request) {
  return forwardBackendRequest(request, "/threads");
}
