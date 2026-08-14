// Chat proxy route.
//
// Forwards GET /api/chat/threads/{id}/stream to the backend's
// /threads/{id}/stream SSE endpoint — attach a live stream to a thread
// with an active run (same event contract as POST /chat). The backend
// 409s when the thread has no active run (or it just finished); the client
// falls back to GET /threads/{id}/messages in that case.

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(
    request,
    `/threads/${encodeURIComponent(id)}/stream`,
  );
}
