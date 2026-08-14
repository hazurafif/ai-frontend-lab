// Chat proxy route.
//
// Forwards GET /api/chat/notifications to the backend's /notifications
// endpoint (the user's most recent run lifecycle events, newest first —
// catch-up for the notification stream).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(request: Request) {
  return forwardBackendRequest(request, "/notifications");
}
