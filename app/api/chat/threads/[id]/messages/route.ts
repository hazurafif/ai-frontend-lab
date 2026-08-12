// Chat proxy route.
//
// Forwards GET /api/chat/threads/{id}/messages to the backend's
// /threads/{id}/messages endpoint (the thread's persisted messages).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(
    request,
    `/threads/${encodeURIComponent(id)}/messages`,
  );
}
