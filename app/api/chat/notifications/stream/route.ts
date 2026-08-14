// Chat proxy route.
//
// Forwards GET /api/chat/notifications/stream to the backend's
// /notifications/stream SSE endpoint (one long-lived per-user connection
// with run lifecycle events; `?since=<seq>` replays events after the
// cursor). The Bearer token is forwarded so the backend scopes the stream
// to that user.

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(request: Request) {
  return forwardBackendRequest(request, "/notifications/stream");
}
