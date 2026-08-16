// Chat proxy route.
//
// Forwards GET /api/chat/threads to the backend's /threads endpoint
// (the current user's threads, newest first) and DELETE to the same path
// (removes ALL of the current user's threads in one request). The Bearer
// token is forwarded so the backend scopes the calls to that user.

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(request: Request) {
  return forwardBackendRequest(request, "/threads");
}

export async function DELETE(request: Request) {
  return forwardBackendRequest(request, "/threads");
}
